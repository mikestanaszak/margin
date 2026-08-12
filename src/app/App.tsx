import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import "./app.css";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { listen } from "@tauri-apps/api/event";
import { insertImage, MarkdownEditor, type MarkdownEditorHandle } from "../MarkdownEditor";
import type {
  ImportedImageResponse,
  NoteDocument,
  NoteSummary,
} from "./types";
import {
  NoteListItem,
  QuickSwitcher,
  ResizableSplit,
  ViewModeControl,
} from "../components";
import { CaptureComposer } from "../features/capture/CaptureComposer";
import {
  CascadingFolderOptions,
  CascadingNoteOptions,
  LibraryNavigation,
} from "../features/library/LibraryNavigation";
import { NoteList } from "../features/library/NoteList";
import { useLibrarySearch } from "../features/search/useLibrarySearch";
import {
  initialNoteSessionState,
  noteSessionReducer,
} from "../features/note-session/note-session";
import { MemoizedMarkdownPreview } from "../features/preview/MarkdownPreview";
import {
  extractOutlineItems,
  Outline,
  type OutlineItem,
} from "../features/preview/Outline";
import {
  TableDialog,
  TableEditorDialog,
} from "../features/preview/TableDialogs";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import {
  expandTemplate,
  TemplateEditorDialog,
  type NoteTemplate,
} from "../features/templates/TemplateEditorDialog";
import { isMac } from "../platform";
import {
  loadPalette,
  paletteStorageKey,
  type Palette,
} from "../theme-palettes";
import {
  clamp,
  fileStem,
  formatShortcut,
  hasUnsavedChanges,
  matchesShortcut,
  nativeShortcut,
  parseMarkdownTables,
  replaceMarkdownTable,
  titleFromBody,
  toggleTask,
} from "../note-utils";
import { native } from "../services/native";

type Filter = {
  type: "all" | "today" | "favorites" | "trash" | "folder";
  folder?: string;
};
type Conflict = { disk: NoteDocument; mine: NoteDocument; path: string };
type AppUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "error";

export async function restartInstalledUpdate(
  relaunchApp: () => Promise<void>,
  setState: (state: UpdateState) => void,
  setError: (message: string) => void,
): Promise<void> {
  setState("restarting");
  setError("");
  try {
    await relaunchApp();
  } catch (error) {
    setState("ready");
    setError(`Could not restart Margin: ${String(error)}`);
  }
}
type ShortcutId =
  | "newNote"
  | "search"
  | "switcher"
  | "save"
  | "view"
  | "sidebar"
  | "outline"
  | "quickCapture";
type Shortcuts = Record<ShortcutId, string>;
type RefreshRequest = { path: string; force: boolean };
const libraryKey = "markdown-notes.library-path";
const favoritesKey = "markdown-notes.pinned";
const themeKey = "markdown-notes.theme";
const shortcutsKey = "markdown-notes.shortcuts";
const quickImportDefaultKey = "markdown-notes.quick-import-default";
const templatesKey = "margin.templates";
const defaultTemplates: NoteTemplate[] = [
  {
    id: "daily",
    name: "Daily note",
    body: "# {{date}}\n\n## Priorities\n\n- [ ] \n\n## Notes\n\n",
  },
];
function loadTemplates(): NoteTemplate[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem(templatesKey) || "[]",
    ) as NoteTemplate[];
    return saved.length ? saved : defaultTemplates;
  } catch {
    return defaultTemplates;
  }
}
function todayTitle() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const libraryPaneWidthKey = "markdown-notes.library-pane-width";
const notePaneWidthKey = "markdown-notes.note-pane-width";
const outlinePaneWidthKey = "markdown-notes.outline-pane-width";
const updateLastCheckedKey = "margin.update-last-checked";
const updateSkippedVersionKey = "margin.update-skipped-version";
const legacySidebarShortcut = isMac ? "meta+\\" : "ctrl+\\";
const legacySidebarAltShortcut = isMac ? "meta+alt+b" : "ctrl+alt+b";

const defaultShortcuts: Shortcuts = {
  newNote: isMac ? "meta+n" : "ctrl+n",
  search: isMac ? "meta+k" : "ctrl+k",
  switcher: isMac ? "meta+p" : "ctrl+p",
  save: isMac ? "meta+s" : "ctrl+s",
  view: isMac ? "meta+e" : "ctrl+e",
  sidebar: isMac ? "meta+shift+b" : "ctrl+shift+b",
  outline: isMac ? "meta+shift+o" : "ctrl+shift+o",
  quickCapture: isMac ? "meta+alt+shift+space" : "ctrl+alt+shift+space",
};

function loadPaneWidth(key: string, fallback: number) {
  const saved = Number(localStorage.getItem(key));
  return Number.isFinite(saved) ? clamp(saved, 180, 520) : fallback;
}
function loadShortcuts(): Shortcuts {
  try {
    const saved = JSON.parse(
      localStorage.getItem(shortcutsKey) || "{}",
    ) as Partial<Shortcuts>;
    return {
      ...defaultShortcuts,
      ...saved,
      sidebar:
        saved.sidebar === legacySidebarShortcut ||
        saved.sidebar === legacySidebarAltShortcut
          ? defaultShortcuts.sidebar
          : saved.sidebar || defaultShortcuts.sidebar,
    };
  } catch {
    return defaultShortcuts;
  }
}
function normalizedFilePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function pathIsInLibrary(path: string, library: string) {
  const file = normalizedFilePath(path);
  const root = normalizedFilePath(library);
  return file === root || file.startsWith(`${root}/`);
}


/**
 * Coalesce library refreshes without losing a forced refresh behind a normal
 * poll. Every caller resolves only after the queue is drained, so a mutation
 * can immediately observe its own note/folder changes even before the native
 * filesystem watcher delivers an event.
 */
function createRefreshCoordinator(
  run: (request: RefreshRequest) => Promise<void>,
) {
  let inFlight: Promise<void> | null = null;
  let pending: RefreshRequest | null = null;
  return (request: RefreshRequest) => {
    if (pending?.path === request.path)
      pending = { ...pending, force: pending.force || request.force };
    else pending = request;
    if (!inFlight) {
      inFlight = (async () => {
        while (pending) {
          const next = pending;
          pending = null;
          await run(next);
        }
      })().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

export function App() {
  const [library, setLibrary] = useState<string | null>(null);
  const [libraryInitialized, setLibraryInitialized] = useState(false);
  const [libraryPaneWidth, setLibraryPaneWidth] = useState(() =>
    loadPaneWidth(libraryPaneWidthKey, 232),
  );
  const [notePaneWidth, setNotePaneWidth] = useState(() =>
    loadPaneWidth(notePaneWidthKey, 296),
  );
  const [outlinePaneWidth, setOutlinePaneWidth] = useState(() =>
    loadPaneWidth(outlinePaneWidthKey, 280),
  );
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [trashNotes, setTrashNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [noteSession, dispatchNoteSession] = useReducer(
    noteSessionReducer,
    initialNoteSessionState,
  );
  const note = noteSession.draft;
  const [filter, setFilter] = useState<Filter>({ type: "all" });
  const [query, setQuery] = useState("");
  const [backlinks, setBacklinks] = useState<NoteSummary[]>([]);
  const [mode, setMode] = useState<"edit" | "preview" | "split">("preview");
  const [status, setStatus] = useState("Choose a notes folder to begin");
  const [indexWarningCount, setIndexWarningCount] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const conflict = noteSession.conflict;
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableEditorIndex, setTableEditorIndex] = useState<number | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogParent, setFolderDialogParent] = useState<string | null>(
    null,
  );
  const [folderRenameTarget, setFolderRenameTarget] = useState<string | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [quickCaptureStatus, setQuickCaptureStatus] = useState(
    "Registering global shortcut…",
  );
  const [noteContextMenu, setNoteContextMenu] = useState<{
    note: NoteSummary;
    x: number;
    y: number;
    isTrashed: boolean;
    isDaily: boolean;
  } | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [openedMarkdownPath, setOpenedMarkdownPath] = useState<string | null>(
    null,
  );
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(
    null,
  );
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateError, setUpdateError] = useState("");
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem(favoritesKey) || "[]"),
  );
  const searchScope = useMemo(() => {
    const candidates = filter.type === "trash" ? trashNotes : notes;
    return candidates
      .filter(
        (item) =>
          (filter.type !== "folder" ||
            item.folder === filter.folder ||
            item.folder.startsWith(`${filter.folder}/`)) &&
          (filter.type !== "favorites" || favorites.includes(item.path)) &&
          (filter.type !== "today" ||
            (item.folder === "Daily" && item.title === todayTitle())),
      )
      .map((item) => item.path);
  }, [favorites, filter, notes, trashNotes]);
  const librarySearch = useLibrarySearch({
    library: query.trim() ? library : null,
    query,
    source: filter.type === "trash" ? "trash" : "notes",
    scope: searchScope,
  });
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const saved = localStorage.getItem(themeKey);
    return saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "system";
  });
  const [palette, setPalette] = useState<Palette>(() =>
    loadPalette(localStorage.getItem(paletteStorageKey)),
  );
  const [shortcuts, setShortcuts] = useState<Shortcuts>(loadShortcuts);
  const [quickImportDefaultPath, setQuickImportDefaultPath] = useState(
    () => localStorage.getItem(quickImportDefaultKey) || "",
  );
  const [templates, setTemplates] = useState<NoteTemplate[]>(loadTemplates);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const baseline = useRef<NoteDocument | null>(null);
  const editor = useRef<MarkdownEditorHandle>(null);
  const activePathRef = useRef<string | null>(null);
  const libraryRef = useRef<string | null>(null);
  const noteRef = useRef<NoteDocument | null>(null);
  const noteBaselines = useRef(new Map<string, NoteDocument>());
  const savedPathAliases = useRef(new Map<string, string>());
  const saveQueueKeys = useRef(new Map<string, string>());
  const pendingOpenedMarkdown = useRef<string[]>([]);
  const noteLoadGeneration = useRef(0);
  const refreshGeneration = useRef(0);
  const refreshCoordinator = useRef<ReturnType<typeof createRefreshCoordinator> | null>(null);
  const saveQueues = useRef(new Map<string, Promise<void>>());
  const internallyMovedPath = useRef<string | null>(null);
  const registeredCaptureShortcut = useRef(defaultShortcuts.quickCapture);
  const viewScrollRatios = useRef(new Map<string, number>());

  const checkForUpdates = async (manual = false) => {
    setUpdateState("checking");
    setUpdateError("");
    try {
      const update = await check({ timeout: 15000 });
      localStorage.setItem(updateLastCheckedKey, String(Date.now()));
      if (
        update &&
        localStorage.getItem(updateSkippedVersionKey) !== update.version
      ) {
        setAvailableUpdate(update);
        setUpdateState("available");
        if (manual) setUpdateDialogOpen(true);
      } else {
        setAvailableUpdate(null);
        setUpdateState("idle");
        if (manual) setUpdateError("Margin is up to date.");
      }
    } catch {
      setUpdateState("idle");
      if (manual) setUpdateError("Could not check for updates right now.");
    }
  };
  const installUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateState("downloading");
    setUpdateError("");
    try {
      await availableUpdate.downloadAndInstall();
      setUpdateState("ready");
    } catch (error) {
      setUpdateState("error");
      setUpdateError(`Could not install the update: ${String(error)}`);
    }
  };
  const skipUpdate = () => {
    if (availableUpdate)
      localStorage.setItem(updateSkippedVersionKey, availableUpdate.version);
    setUpdateDialogOpen(false);
    setAvailableUpdate(null);
    setUpdateState("idle");
  };

  const refresh = useCallback((path?: string | null, force = path === undefined) => {
    const requestPath = path ?? libraryRef.current;
    if (!requestPath) return Promise.resolve();
    if (!refreshCoordinator.current) {
      refreshCoordinator.current = createRefreshCoordinator(async (request) => {
        const generation = ++refreshGeneration.current;
        try {
          const snapshot = await native.loadLibrarySnapshot(
            request.path,
            request.force,
          );
          if (
            generation !== refreshGeneration.current ||
            libraryRef.current !== request.path
          )
            return;
          setNotes(snapshot.notes);
          setFolders(snapshot.folders);
          setTrashNotes(snapshot.trash);
          setIndexWarningCount(snapshot.warnings?.length ?? 0);
          setStatus(
            `${snapshot.notes.length} ${snapshot.notes.length === 1 ? "note" : "notes"}`,
          );
        } catch (error) {
          if (
            generation === refreshGeneration.current &&
            libraryRef.current === request.path
          )
            setStatus(`Could not read library: ${String(error)}`);
        }
      });
    }
    return refreshCoordinator.current({ path: requestPath, force });
  }, []);
  const rememberWorkspaceScroll = () => {
    if (!note) return;
    const scroller =
      mode === "edit"
        ? editor.current?.getView()?.scrollDOM
        : document.querySelector<HTMLElement>(".note-content .preview");
    if (!scroller) return;
    const maximum = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    viewScrollRatios.current.set(note.path, scroller.scrollTop / maximum);
  };
  const setViewMode = (next: "edit" | "preview" | "split") => {
    if (next === mode) return;
    rememberWorkspaceScroll();
    setMode(next);
  };
  useEffect(() => {
    libraryRef.current = library;
    refreshGeneration.current += 1;
    if (library) void refresh(library);
  }, [library, refresh]);
  useEffect(() => {
    if (!library || !note) {
      setBacklinks([]);
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      void native.findBacklinks(library, note.path, note.title)
        .then((matches) => {
          if (!disposed) setBacklinks(matches);
        })
        .catch(() => {
          if (!disposed) setBacklinks([]);
        });
    }, 160);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [library, note?.path, note?.title]);
  useEffect(() => {
    if (
      Date.now() - Number(localStorage.getItem(updateLastCheckedKey) || 0) >=
      24 * 60 * 60 * 1000
    )
      void checkForUpdates();
  }, []);
  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);
  useEffect(() => {
    localStorage.setItem(favoritesKey, JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
    localStorage.setItem(themeKey, theme);
    localStorage.setItem(paletteStorageKey, palette);
  }, [palette, theme]);
  useEffect(() => {
    localStorage.setItem(shortcutsKey, JSON.stringify(shortcuts));
  }, [shortcuts]);
  useEffect(() => {
    localStorage.setItem(quickImportDefaultKey, quickImportDefaultPath);
  }, [quickImportDefaultPath]);
  useEffect(() => {
    localStorage.setItem(templatesKey, JSON.stringify(templates));
  }, [templates]);
  useEffect(() => {
    localStorage.setItem(libraryPaneWidthKey, String(libraryPaneWidth));
  }, [libraryPaneWidth]);
  useEffect(() => {
    localStorage.setItem(notePaneWidthKey, String(notePaneWidth));
  }, [notePaneWidth]);
  useEffect(() => {
    localStorage.setItem(outlinePaneWidthKey, String(outlinePaneWidth));
  }, [outlinePaneWidth]);
  const showQuickCapture = () => {
    void native.showQuickCapture().catch(() => setQuickCaptureOpen(true));
  };
  useEffect(() => {
    let disposed = false;
    const requested = shortcuts.quickCapture;
    void native.configureQuickCaptureShortcut(nativeShortcut(requested))
      .then(() => {
        if (!disposed) {
          registeredCaptureShortcut.current = requested;
          setQuickCaptureStatus(`Ready: ${formatShortcut(requested)}`);
        }
      })
      .catch(() => {
        if (!disposed) {
          setShortcuts((current) =>
            current.quickCapture === requested
              ? { ...current, quickCapture: registeredCaptureShortcut.current }
              : current,
          );
          setQuickCaptureStatus(
            `Unavailable: ${formatShortcut(requested)} is already in use`,
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [shortcuts.quickCapture]);
  useEffect(() => {
    let disposed = false;
    void native.loadSelectedLibrary()
      .then(async (selected) => {
        if (disposed) return;
        if (selected) {
          setLibrary(selected);
          return;
        }
        const legacyLibrary = localStorage.getItem(libraryKey);
        if (legacyLibrary) {
          await native.saveSelectedLibrary(legacyLibrary).catch(() => undefined);
          setLibrary(legacyLibrary);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setLibraryInitialized(true);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const receiveOpenedMarkdown = useCallback(
    (path: string) => {
      if (!path) return;
      if (!libraryInitialized) {
        pendingOpenedMarkdown.current.push(path);
        return;
      }
      if (library && pathIsInLibrary(path, library)) {
        setActivePath(path);
        setStatus("Opened Markdown file");
      } else {
        setOpenedMarkdownPath(path);
      }
    },
    [library, libraryInitialized],
  );
  useEffect(() => {
    if (!libraryInitialized) return;
    const pending = pendingOpenedMarkdown.current.splice(0);
    pending.forEach(receiveOpenedMarkdown);
  }, [library, libraryInitialized, receiveOpenedMarkdown]);
  useEffect(() => {
    if (!libraryInitialized) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<string[]>(
        "margin://open-markdown-files",
        (event) => event.payload.forEach(receiveOpenedMarkdown),
      );
      if (!disposed) {
        const pending = await native.takeOpenedMarkdownFiles();
        pending.forEach(receiveOpenedMarkdown);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [libraryInitialized, receiveOpenedMarkdown]);
  // This is a desktop application, not a browser tab. The webview's built-in
  // menu exposes browser actions (reload, inspect, and similar) that do not
  // belong in the product surface. Keyboard cut/copy/paste remains native.
  useEffect(() => {
    const suppressWebviewMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", suppressWebviewMenu);
    return () => window.removeEventListener("contextmenu", suppressWebviewMenu);
  }, []);
  useEffect(() => {
    if (!noteContextMenu) return;
    const dismiss = () => setNoteContextMenu(null);
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [noteContextMenu]);
  useEffect(() => {
    const generation = ++noteLoadGeneration.current;
    if (!activePath) {
      dispatchNoteSession({ type: "cleared" });
      return;
    }
    if (internallyMovedPath.current === activePath) {
      internallyMovedPath.current = null;
      return;
    }
    dispatchNoteSession({ type: "loadRequested" });
    void (async () => {
      try {
        const loaded = await native.readNote(activePath);
        if (
          generation !== noteLoadGeneration.current ||
          activePathRef.current !== activePath
        )
          return;
        baseline.current = loaded;
        noteBaselines.current.set(loaded.path, loaded);
        dispatchNoteSession({ type: "loadSucceeded", note: loaded });
      } catch (error) {
        if (generation === noteLoadGeneration.current) {
          dispatchNoteSession({
            type: "loadFailed",
            message: String(error),
          });
          setStatus(`Could not open note: ${String(error)}`);
        }
      }
    })();
  }, [activePath]);
  useEffect(() => {
    if (!note || !hasUnsavedChanges(note, baseline.current)) return;
    const timer = window.setTimeout(() => void enqueueSave(note), 700);
    return () => window.clearTimeout(timer);
  }, [note?.body, note?.title, note?.tags.join("\0")]);
  useEffect(() => {
    const checkForExternalChanges = async () => {
      const currentNote = noteRef.current;
      const currentBaseline = baseline.current;
      if (!library || !currentNote || !currentBaseline) return;
      await refresh(library);
      if (
        noteRef.current?.path !== currentNote.path ||
        baseline.current?.revision !== currentBaseline.revision
      )
        return;
      try {
        const disk = await native.readNote(currentNote.path);
        if (
          noteRef.current?.path !== currentNote.path ||
          baseline.current?.revision !== currentBaseline.revision
        )
          return;
        if (
          disk.revision !== currentBaseline.revision &&
          hasUnsavedChanges(currentNote, currentBaseline)
        )
          dispatchNoteSession({
            type: "saveConflicted",
            disk,
            mine: currentNote,
            path: currentNote.path,
          });
        else if (disk.revision !== currentBaseline.revision) {
          baseline.current = disk;
          noteBaselines.current.set(disk.path, disk);
          dispatchNoteSession({ type: "loadSucceeded", note: disk });
          setStatus("Updated from disk");
        }
      } catch {
        /* it may have moved */
      }
    };
    const interval = window.setInterval(() => {
      void checkForExternalChanges();
    }, 2500);
    return () => clearInterval(interval);
  }, [library, refresh]);
  useEffect(() => {
    if (!library) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh(library);
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [library, refresh]);
  useEffect(() => {
    if (!note) return;
    const ratio = viewScrollRatios.current.get(note.path);
    if (ratio === undefined) return;
    const frame = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const targets =
          mode === "edit"
            ? [editor.current?.getView()?.scrollDOM]
            : mode === "preview"
              ? [document.querySelector<HTMLElement>(".note-content .preview")]
              : [
                  editor.current?.getView()?.scrollDOM,
                  document.querySelector<HTMLElement>(".note-content .preview"),
                ];
        for (const target of targets) {
          if (target)
            target.scrollTop =
              ratio * Math.max(0, target.scrollHeight - target.clientHeight);
        }
      }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [mode, note?.path]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && outlineOpen) {
        event.preventDefault();
        setOutlineOpen(false);
        return;
      }
      if (matchesShortcut(event, shortcuts.quickCapture)) {
        event.preventDefault();
        showQuickCapture();
      } else if (matchesShortcut(event, shortcuts.newNote)) {
        event.preventDefault();
        void createNote();
      } else if (matchesShortcut(event, shortcuts.search)) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("#note-search")?.focus();
      } else if (matchesShortcut(event, shortcuts.switcher)) {
        event.preventDefault();
        setQuickOpen(true);
      } else if (matchesShortcut(event, shortcuts.save) && note) {
        event.preventDefault();
        void enqueueSave(note);
      } else if (matchesShortcut(event, shortcuts.view) && note) {
        event.preventDefault();
        setViewMode(mode === "edit" ? "preview" : "edit");
      } else if (matchesShortcut(event, shortcuts.sidebar)) {
        event.preventDefault();
        setSidebarHidden((value) => !value);
      } else if (matchesShortcut(event, shortcuts.outline) && note) {
        event.preventDefault();
        setOutlineOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [note, library, outlineOpen, shortcuts, mode]);

  const selectLibrary = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose your notes folder",
    });
    if (typeof selected === "string") {
      await native.saveSelectedLibrary(selected).catch(() => undefined);
      setLibrary(selected);
      setActivePath(null);
      setFilter({ type: "all" });
    }
  };
  const importOpenedMarkdown = async (folder: string) => {
    if (!openedMarkdownPath || !library) return;
    try {
      const imported = await native.importMarkdownFile(
        openedMarkdownPath,
        library,
        folder || null,
      );
      await refresh();
      setActivePath(imported.path);
      setOpenedMarkdownPath(null);
      setStatus("Imported a copy into your library");
    } catch (error) {
      setStatus(`Could not import Markdown file: ${String(error)}`);
    }
  };
  const createNote = async (targetFolder?: string | null, body?: string) => {
    if (!library) return void (await selectLibrary());
    const folder =
      targetFolder === undefined
        ? filter.type === "folder"
          ? filter.folder
          : null
        : targetFolder;
    try {
      const created = await native.createNote(library, folder);
      let saved = created;
      if (body) {
        const result = await native.saveNote({ ...created, body }, library);
        if (result.status === "saved") saved = result.note;
        else if (result.status === "conflict")
          throw new Error("The new note changed on disk before it could be saved");
        else throw new Error(result.message);
      }
      await refresh();
      setActivePath(saved.path);
      setStatus(folder ? `New note created in ${folder}` : "New note created");
    } catch (error) {
      setStatus(`Could not create note: ${String(error)}`);
    }
  };
  const openToday = async () => {
    const title = todayTitle();
    const existing = notes.find(
      (item) => item.folder === "Daily" && item.title === title,
    );
    setFilter({ type: "today" });
    if (existing) {
      setActivePath(existing.path);
      return;
    }
    const template =
      templates.find((item) => item.id === "daily") ||
      templates[0] ||
      defaultTemplates[0];
    await createNote("Daily", expandTemplate(template, title));
  };
  const createFolder = async (folder: string) => {
    if (!library) return;
    try {
      const created = await native.createFolder(library, folder);
      await refresh();
      setFilter({ type: "folder", folder: created });
      setFolderDialogOpen(false);
    } catch (error) {
      setStatus(`Could not create folder: ${String(error)}`);
    }
  };
  const renameFolder = async (folder: string, name: string) => {
    if (!library) return;
    try {
      const renamed = await native.renameFolder(folder, name, library);
      const paths = new Map(renamed.paths.map((path) => [path.from, path.to]));
      const renamedDescendant = (value: string) =>
        value === folder
          ? renamed.folder
          : value.startsWith(`${folder}/`)
            ? `${renamed.folder}${value.slice(folder.length)}`
            : value;
      setFavorites((current) => current.map((path) => paths.get(path) || path));
      if (activePath) setActivePath(paths.get(activePath) || activePath);
      setFilter((current) =>
        current.type === "folder" && current.folder
          ? { ...current, folder: renamedDescendant(current.folder) }
          : current,
      );
      setCollapsedFolders((current) => current.map(renamedDescendant));
      await refresh();
      setFolderRenameTarget(null);
      setStatus(`Renamed ${folder} to ${renamed.folder}`);
    } catch (error) {
      setStatus(`Could not rename folder: ${String(error)}`);
    }
  };
  const saveNote = async (draft: NoteDocument, queueKey: string) => {
    if (!library || !pathIsInLibrary(draft.path, library)) return;
    try {
      const originalPath = draft.path;
      const previousPath =
        savedPathAliases.current.get(originalPath) ?? originalPath;
      const currentBaseline =
        noteBaselines.current.get(previousPath) ??
        noteBaselines.current.get(originalPath) ??
        null;
      const noteToSave = {
        ...draft,
        path: previousPath,
        revision:
          currentBaseline?.path === previousPath
            ? currentBaseline.revision
            : draft.revision,
      };
      if (!hasUnsavedChanges(noteToSave, currentBaseline)) return;
      const saveBelongsToActiveNote = () =>
        activePathRef.current === previousPath ||
        activePathRef.current === originalPath;
      const startedActive = saveBelongsToActiveNote();
      if (startedActive) {
        dispatchNoteSession({ type: "saveRequested" });
        setStatus("Saving…");
      }
      const result = await native.saveNote(noteToSave, library);
      const isStillActive = saveBelongsToActiveNote();
      if (result.status === "conflict") {
        dispatchNoteSession({
          type: "saveConflicted",
          disk: result.disk,
          mine: noteToSave,
          path: previousPath,
        });
        if (isStillActive)
          setStatus("Save conflict: the note changed on disk");
        return;
      }
      if (result.status === "error") {
        if (isStillActive) {
          dispatchNoteSession({
            type: "saveFailed",
            message: result.message,
          });
          setStatus(`Save failed: ${result.message}`);
        }
        return;
      }
      const saved = result.note;
      const pathChanged = saved.path !== previousPath;
      savedPathAliases.current.set(originalPath, saved.path);
      saveQueueKeys.current.set(originalPath, queueKey);
      saveQueueKeys.current.set(saved.path, queueKey);
      noteBaselines.current.set(originalPath, saved);
      noteBaselines.current.set(saved.path, saved);
      if (isStillActive) {
        activePathRef.current = saved.path;
        baseline.current = saved;
        if (pathChanged) {
          internallyMovedPath.current = saved.path;
          setActivePath(saved.path);
        }
      }
      setFavorites((current) =>
        current.map((path) => (path === previousPath ? saved.path : path)),
      );
      dispatchNoteSession({
        type: "saveSucceeded",
        note: saved,
        previousPath,
        savedDraft: noteToSave,
      });
      const updateSummary = (item: NoteSummary) =>
        item.path === originalPath ||
        item.path === previousPath ||
        item.path === saved.path
          ? {
              ...item,
              path: saved.path,
              title: saved.title,
              tags: saved.tags,
              updated: saved.updated,
            }
          : item;
      setNotes((current) => current.map(updateSummary));
      setTrashNotes((current) => current.map(updateSummary));
      if (isStillActive) setStatus("Saved");
    } catch (error) {
      if (activePathRef.current === draft.path) {
        dispatchNoteSession({
          type: "saveFailed",
          message: String(error),
        });
        setStatus(`Save failed: ${String(error)}`);
      }
    }
  };
  const enqueueSave = (draft: NoteDocument) => {
    const queuedDraft = { ...draft, tags: [...draft.tags] };
    const queueKey =
      saveQueueKeys.current.get(queuedDraft.path) ?? queuedDraft.path;
    const previous = saveQueues.current.get(queueKey) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => saveNote(queuedDraft, queueKey));
    saveQueues.current.set(queueKey, queued);
    void queued.finally(() => {
      if (saveQueues.current.get(queueKey) === queued)
        saveQueues.current.delete(queueKey);
    });
    return queued;
  };
  const duplicateNote = async (source: Pick<NoteSummary, "path">) => {
    if (!library) return;
    try {
      const copy = await native.duplicateNote(source.path, library);
      await refresh();
      setActivePath(copy.path);
    } catch (error) {
      setStatus(`Duplicate failed: ${String(error)}`);
    }
  };
  const moveNoteToFolder = async (source: NoteSummary, folder: string) => {
    if (!library) return;
    try {
      const moved = await native.moveNoteToFolder(
        source.path,
        folder || null,
        library,
      );
      setFavorites((current) =>
        current.map((path) => (path === source.path ? moved.path : path)),
      );
      await refresh();
      if (activePath === source.path) setActivePath(moved.path);
      setFilter(folder ? { type: "folder", folder } : { type: "all" });
      setStatus(
        `Moved ${source.title}${folder ? ` to ${folder}` : " to the top level"}`,
      );
    } catch (error) {
      setStatus(`Could not move note: ${String(error)}`);
    }
  };
  const revealNote = async (source: NoteSummary) => {
    if (!library) return;
    try {
      await native.revealNoteInFileManager(source.path, library);
    } catch (error) {
      setStatus(`Could not reveal note: ${String(error)}`);
    }
  };
  const trashNote = async (source: NoteSummary) => {
    if (
      !library ||
      !confirm(`Move “${source.title}” to this library’s trash?`)
    )
      return;
    try {
      await native.moveNoteToTrash(source.path, library);
      setFavorites((current) => current.filter((path) => path !== source.path));
      if (activePath === source.path) setActivePath(null);
      await refresh();
    } catch (error) {
      setStatus(`Could not move note: ${String(error)}`);
    }
  };
  const deleteFolder = async (folder: string) => {
    if (!library) return;
    const contained = notes.filter(
      (item) => item.folder === folder || item.folder.startsWith(`${folder}/`),
    );
    if (
      !confirm(
        `Move “${folder}” and its ${contained.length} ${contained.length === 1 ? "note" : "notes"} to Trash? You can restore its notes later.`,
      )
    )
      return;
    try {
      await native.moveFolderToTrash(folder, library);
      setFavorites((current) =>
        current.filter((path) => !contained.some((item) => item.path === path)),
      );
      if (activePath && contained.some((item) => item.path === activePath))
        setActivePath(null);
      if (
        filter.type === "folder" &&
        filter.folder &&
        (filter.folder === folder || filter.folder.startsWith(`${folder}/`))
      )
        setFilter({ type: "all" });
      setCollapsedFolders((current) =>
        current.filter(
          (value) => value !== folder && !value.startsWith(`${folder}/`),
        ),
      );
      await refresh();
      setStatus(`Moved ${folder} to Trash`);
    } catch (error) {
      setStatus(`Could not delete folder: ${String(error)}`);
    }
  };
  const restoreNote = async (source: NoteSummary) => {
    if (!library) return;
    try {
      const restored = await native.restoreNoteFromTrash(source.path, library);
      await refresh();
      setActivePath(restored.path);
      setFilter({ type: "all" });
    } catch (error) {
      setStatus(`Could not restore note: ${String(error)}`);
    }
  };
  const deleteNotePermanently = async (source: NoteSummary) => {
    if (
      !library ||
      !confirm(
        `Permanently delete “${source.title}”? This cannot be undone.`,
      )
    )
      return;
    try {
      await native.deleteNotePermanently(source.path, library);
      if (activePath === source.path) setActivePath(null);
      await refresh();
      setStatus("Note permanently deleted");
    } catch (error) {
      setStatus(`Could not permanently delete note: ${String(error)}`);
    }
  };
  const saveQuickCapture = async (text: string) => {
    if (!library) {
      await selectLibrary();
      return false;
    }
    try {
      const daily = await native.appendQuickNote(library, text);
      await refresh();
      setQuickCaptureOpen(false);
      setStatus(`Saved to Daily/${fileStem(daily.path)}.md`);
      return true;
    } catch (error) {
      setStatus(`Could not save quick note: ${String(error)}`);
      return false;
    }
  };
  const importDailyNote = async (target: NoteSummary) => {
    if (!note || !library) return;
    try {
      const saved = await native.importDailyNote(
        note.path,
        target.path,
        library,
      );
      await refresh();
      setImportDialogOpen(false);
      openLinkedNote({ ...target, path: saved.path });
      setStatus(`Imported ${note.title} into ${saved.title}`);
    } catch (error) {
      setStatus(`Could not import daily note: ${String(error)}`);
    }
  };
  const importDailyNoteToNew = async (folder: string, title: string) => {
    if (!note || !library) return;
    try {
      const saved = await native.importDailyNoteToNewNote(
        note.path,
        folder || null,
        title,
        library,
      );
      await refresh();
      setImportDialogOpen(false);
      if (folder) {
        setFilter({ type: "folder", folder });
        setCollapsedFolders((current) =>
          current.filter((value) => !folder.startsWith(`${value}/`)),
        );
      } else {
        setFilter({ type: "all" });
      }
      setActivePath(saved.path);
      setStatus(`Imported ${note.title} into ${saved.title}`);
    } catch (error) {
      setStatus(`Could not create imported note: ${String(error)}`);
    }
  };
  const openLinkedNote = useCallback((target: NoteSummary) => {
    const containingFolder = target.folder.trim();
    if (containingFolder) {
      setFilter({ type: "folder", folder: containingFolder });
      setCollapsedFolders((current) =>
        current.filter(
          (folder) =>
            folder !== containingFolder &&
            !containingFolder.startsWith(`${folder}/`),
        ),
      );
    } else {
      setFilter({ type: "all" });
    }
    setActivePath(target.path);
  }, []);
  const listedNotes = filter.type === "trash" ? trashNotes : notes;
  const visibleNotes = useMemo(
    () => {
      if (query.trim()) return librarySearch.results;
      const scopedPaths = new Set(searchScope);
      return listedNotes
        .filter((item) => scopedPaths.has(item.path))
        .sort(
          (left, right) =>
            Number(favorites.includes(right.path)) -
              Number(favorites.includes(left.path)) ||
            right.updated - left.updated,
        );
    },
    [favorites, librarySearch.results, listedNotes, query, searchScope],
  );
  const folderCounts = useMemo(
    () =>
      Object.fromEntries(
        folders.map((folder) => [
          folder,
          notes.filter(
            (note) =>
              note.folder === folder || note.folder.startsWith(`${folder}/`),
          ).length,
        ]),
      ),
    [folders, notes],
  );
  const deferredNoteBody = useDeferredValue(note?.body ?? "");
  const deferredNotePath = useDeferredValue(note?.path ?? "");
  const outlineItems = useMemo<OutlineItem[]>(
    () =>
      outlineOpen && note
        ? extractOutlineItems(deferredNoteBody)
        : [],
    [deferredNoteBody, note?.path, outlineOpen],
  );
  const isManagedNote = Boolean(
    note && library && pathIsInLibrary(note.path, library),
  );
  const insertImportedImage = useCallback((notePath: string, image: ImportedImageResponse) => {
    if (noteRef.current?.path !== notePath) {
      setStatus("The image was imported, but the active note changed before it could be inserted.");
      return;
    }
    const view = editor.current?.getView();
    if (!view) {
      setStatus("The image was imported, but the editor is unavailable.");
      return;
    }
    insertImage(view, { markdownPath: image.markdown_path, alt: image.alt });
  }, []);
  const waitForPendingNoteSave = useCallback(async (notePath: string) => {
    const queueKey = saveQueueKeys.current.get(notePath) ?? notePath;
    await (saveQueues.current.get(queueKey) ?? Promise.resolve()).catch(() => undefined);
  }, []);
  const importImageFile = useCallback(async (file: File) => {
    let activeNote = noteRef.current;
    let activeLibrary = libraryRef.current;
    if (!activeNote || !activeLibrary || !pathIsInLibrary(activeNote.path, activeLibrary)) return;
    if (file.size > 25 * 1024 * 1024) return setStatus("Images must be 25 MB or smaller.");
    try {
      await waitForPendingNoteSave(activeNote.path);
      activeNote = noteRef.current;
      activeLibrary = libraryRef.current;
      if (!activeNote || !activeLibrary || !pathIsInLibrary(activeNote.path, activeLibrary)) return;
      const image = await native.importNoteImageFromBytes(
        activeNote.path,
        file.name || "pasted-image.png",
        Array.from(new Uint8Array(await file.arrayBuffer())),
        activeLibrary,
      );
      insertImportedImage(activeNote.path, image);
    } catch (error) { setStatus(`Could not import image: ${String(error)}`); }
  }, [insertImportedImage, waitForPendingNoteSave]);
  const chooseImage = useCallback(async () => {
    let activeNote = noteRef.current;
    let activeLibrary = libraryRef.current;
    if (!activeNote || !activeLibrary || !pathIsInLibrary(activeNote.path, activeLibrary)) return;
    const selected = await open({ multiple: false, title: "Choose an image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
    if (typeof selected !== "string") return;
    try {
      await waitForPendingNoteSave(activeNote.path);
      activeNote = noteRef.current;
      activeLibrary = libraryRef.current;
      if (!activeNote || !activeLibrary || !pathIsInLibrary(activeNote.path, activeLibrary)) return;
      const image = await native.importNoteImageFromPath(
        activeNote.path,
        selected,
        activeLibrary,
      );
      insertImportedImage(activeNote.path, image);
    } catch (error) { setStatus(`Could not import image: ${String(error)}`); }
  }, [insertImportedImage, waitForPendingNoteSave]);
  const noteEditor = note ? (
    <MarkdownEditor
      key={`${note.path}-${isManagedNote ? "managed" : "external"}`}
      ref={editor}
      notePath={note.path}
      value={note.body}
      onChange={(body) => {
        const current = noteRef.current;
        if (!isManagedNote || current?.path !== note.path) return;
        dispatchNoteSession({
          type: "edited",
          draft: { ...current, body, title: titleFromBody(body) },
        });
      }}
      onBlur={() => isManagedNote && void enqueueSave(note)}
      onImageFile={isManagedNote ? (file) => void importImageFile(file) : undefined}
      autoFocus
      readOnly={!isManagedNote}
      className="markdown-editor"
    />
  ) : null;
  const previewMarkdown =
    mode === "split" && deferredNotePath === note?.path
      ? deferredNoteBody
      : note?.body ?? "";
  const togglePreviewTask = useCallback((index: number, checked: boolean) => {
    const current = noteRef.current;
    if (!current) return;
    dispatchNoteSession({
      type: "edited",
      draft: { ...current, body: toggleTask(current.body, index, checked) },
    });
  }, []);
  const showPreview = mode !== "edit";
  const notePreview = note && showPreview ? (
    <MemoizedMarkdownPreview
      markdown={previewMarkdown}
      notePath={note.path}
      notes={notes}
      onOpen={openLinkedNote}
      onOpenExternalError={setStatus}
      editable={isManagedNote}
      onEditTable={isManagedNote ? setTableEditorIndex : () => undefined}
      onToggleTask={isManagedNote ? togglePreviewTask : () => undefined}
    />
  ) : null;
  const visibleNoteCards = useMemo(
    () => visibleNotes.map((item) => ({ ...item, body: item.excerpt })),
    [visibleNotes],
  );
  const activeNoteDirty = Boolean(
    note && hasUnsavedChanges(note, baseline.current),
  );
  const openNote = useCallback((selected: NoteSummary) => {
    setActivePath(selected.path);
  }, []);
  const toggleNoteFavorite = useCallback((selected: NoteSummary) => {
    setFavorites((value) =>
      value.includes(selected.path)
        ? value.filter((path) => path !== selected.path)
        : [...value, selected.path],
    );
  }, []);
  const isTrashFilter = filter.type === "trash";
  const openNoteContextMenu = useCallback(
    (selected: NoteSummary, position: { x: number; y: number }) =>
      setNoteContextMenu({
        note: selected,
        x: Math.min(position.x, window.innerWidth - 180),
        y: Math.min(position.y, window.innerHeight - 100),
        isTrashed: isTrashFilter,
        isDaily: /[\\/]Daily[\\/]/i.test(selected.path),
      }),
    [isTrashFilter],
  );
  const renderNote = useCallback((item: NoteSummary) => (
    <NoteListItem
      key={item.path}
      note={item}
      active={item.path === activePath}
      dirty={item.path === activePath && activeNoteDirty}
      pinned={favorites.includes(item.path)}
      onOpen={openNote}
      onContextMenu={openNoteContextMenu}
      onTogglePin={isTrashFilter ? undefined : toggleNoteFavorite}
    />
  ), [activeNoteDirty, activePath, favorites, isTrashFilter, openNote, openNoteContextMenu, toggleNoteFavorite]);
  const listTitle =
    filter.type === "folder"
      ? (filter.folder || "").split("/").filter(Boolean).slice(-1)[0] ||
        "Folder"
      : filter.type === "favorites"
        ? "Favorites"
        : filter.type === "trash"
          ? "Trash"
          : filter.type === "today"
            ? "Today"
            : "All notes";
  const isTrashedNote = Boolean(
    note && trashNotes.some((item) => item.path === note.path),
  );
  const isDailyNote = Boolean(note && /[\\/]Daily[\\/]/i.test(note.path));
  const resizeLibraryPane = (width: number) =>
    setLibraryPaneWidth(
      clamp(
        width,
        180,
        Math.max(180, Math.min(420, window.innerWidth - notePaneWidth - 420)),
      ),
    );
  const resizeNotePane = (width: number) =>
    setNotePaneWidth(
      clamp(
        width,
        220,
        Math.max(
          220,
          Math.min(520, window.innerWidth - libraryPaneWidth - 420),
        ),
      ),
    );
  const resizeOutlinePane = (width: number) =>
    setOutlinePaneWidth(
      clamp(
        width,
        220,
        Math.max(
          220,
          Math.min(
            520,
            window.innerWidth - libraryPaneWidth - notePaneWidth - 360,
          ),
        ),
      ),
    );

  return (
    <main
      className={`app-shell ${sidebarHidden ? "sidebar-hidden" : ""}`}
      style={
        {
          "--library-pane-width": `${libraryPaneWidth}px`,
          "--note-pane-width": `${notePaneWidth}px`,
        } as React.CSSProperties
      }
    >
      <header className="app-topbar">
        <div className="top-brand">
          <span className="brand-mark">✦</span>
          <span>Margin</span>
        </div>
        <label className="top-search">
          <span>⌕</span>
          <input
            id="note-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
          />
          <kbd>{formatShortcut(shortcuts.search)}</kbd>
        </label>
        <div className="topbar-actions">
          {availableUpdate && (
            <button
              className="update-available"
              onClick={() => setUpdateDialogOpen(true)}
            >
              Update {availableUpdate.version}
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
        </div>
      </header>
      <LibraryNavigation
        filter={filter.type}
        selectedFolder={filter.type === "folder" ? filter.folder : undefined}
        noteCount={notes.length}
        favoriteCount={favorites.filter((path) =>
          notes.some((note) => note.path === path),
        ).length}
        trashCount={trashNotes.length}
        folders={folders}
        folderCounts={folderCounts}
        collapsedFolders={collapsedFolders}
        library={library}
        indexWarningCount={indexWarningCount}
        newNoteShortcut={formatShortcut(shortcuts.newNote)}
        onNewNote={() => void createNote()}
        onShowAll={() => setFilter({ type: "all" })}
        onOpenToday={() => void openToday()}
        onShowFavorites={() => setFilter({ type: "favorites" })}
        onShowTrash={() => setFilter({ type: "trash" })}
        onCreateFolder={() => {
          setFolderDialogParent(null);
          setFolderDialogOpen(true);
        }}
        onSelectFolder={(folder) => setFilter({ type: "folder", folder })}
        onToggleFolder={(folder) =>
          setCollapsedFolders((current) =>
            current.includes(folder)
              ? current.filter((value) => value !== folder)
              : [...current, folder],
          )
        }
        onAddSubfolder={(folder) => {
          setFolderDialogParent(folder);
          setFolderDialogOpen(true);
        }}
        onRenameFolder={setFolderRenameTarget}
        onDeleteFolder={(folder) => void deleteFolder(folder)}
        onChangeLibrary={() => void selectLibrary()}
      />
      <ColumnResizeHandle
        className="library-pane-resizer"
        value={libraryPaneWidth}
        onChange={resizeLibraryPane}
        label="Resize library sidebar"
      />
      <ColumnResizeHandle
        className="note-pane-resizer"
        value={notePaneWidth}
        onChange={resizeNotePane}
        label="Resize note list"
      />
      <NoteList
        title={listTitle}
        notes={visibleNoteCards}
        activePath={activePath}
        folders={folders}
        rootFolder={filter.type === "folder" ? filter.folder || "" : ""}
        hierarchical={filter.type === "folder" && !query}
        librarySelected={Boolean(library)}
        emptyMessage={
          librarySearch.error ??
          (query.trim()
            ? librarySearch.loading
              ? "Searching…"
              : "No matching notes"
            : "No notes here yet.")
        }
        renderNote={renderNote}
      />
      <section className="workspace">
        {note ? (
          <>
            <header className="workspace-header">
              <div className="title-stack">
                <h1 className="note-title">{note.title}</h1>
                <div className="note-file">
                  <span title={note.path}>{fileStem(note.path)}.md</span>
                  <span role="status">{status}</span>
                </div>
              </div>
              <div className="actions">
                {isDailyNote && !isTrashedNote && (
                  <button
                    type="button"
                    onClick={() => setImportDialogOpen(true)}
                  >
                    Import
                  </button>
                )}
                <ViewModeControl
                  mode={mode}
                  onChange={setViewMode}
                  hotkeyHint={formatShortcut(shortcuts.view)}
                />
              </div>
            </header>
            {mode !== "preview" && (
              <div className="editor-tools" role="toolbar" aria-label="Editor tools">
                <button
                  className="insert-table"
                  type="button"
                  onClick={() => setTableDialogOpen(true)}
                >
                  Table
                </button>
                {isManagedNote && (
                  <button
                    className="insert-image"
                    type="button"
                    onClick={() => void chooseImage()}
                  >
                    Image
                  </button>
                )}
              </div>
            )}
            <div className="workspace-main">
              <div className={`note-content ${mode}`}>
                {mode === "edit" ? (
                  noteEditor
                ) : mode === "preview" ? (
                  notePreview
                ) : (
                  <ResizableSplit
                    left={noteEditor}
                    right={notePreview}
                    minLeftWidth={280}
                    minRightWidth={320}
                    persistenceKey="markdown-notes.split-ratio"
                  />
                )}
              </div>
              {outlineOpen && (
                <>
                  <ColumnResizeHandle
                    className="outline-pane-resizer"
                    value={outlinePaneWidth}
                    onChange={resizeOutlinePane}
                    label="Resize outline"
                    direction={-1}
                  />
                  <Outline
                    items={outlineItems}
                    dirty={hasUnsavedChanges(note, baseline.current)}
                    width={outlinePaneWidth}
                    onClose={() => setOutlineOpen(false)}
                  />
                </>
              )}
            </div>
            {backlinks.length > 0 && (
              <aside className="backlinks">
                <strong>Linked from</strong>
                {backlinks.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => setActivePath(item.path)}
                  >
                    {item.title}
                  </button>
                ))}
              </aside>
            )}
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-icon">✦</div>
            <h1>
              {library
                ? "Choose a note or create one"
                : "Your notes, in plain Markdown"}
            </h1>
            <p>
              {library
                ? "Select a note from the list, or make a fresh one."
                : "Choose a folder. Your notes stay as files you can use anywhere."}
            </p>
            <button
              className="primary"
              onClick={() => void (library ? createNote() : selectLibrary())}
            >
              {library ? "New note" : "Choose notes folder"}
            </button>
          </div>
        )}
      </section>
      {quickOpen && (
        <QuickSwitcher
          library={library}
          onClose={() => setQuickOpen(false)}
          onSelect={(selected) => {
            setActivePath(selected.path);
            setQuickOpen(false);
          }}
        />
      )}
      {quickCaptureOpen && (
        <QuickCaptureDialog
          shortcut={formatShortcut(shortcuts.quickCapture)}
          onClose={() => setQuickCaptureOpen(false)}
          onSave={saveQuickCapture}
        />
      )}
      {openedMarkdownPath && (
        <OpenedMarkdownDialog
          path={openedMarkdownPath}
          library={library}
          folders={folders}
          onClose={() => setOpenedMarkdownPath(null)}
          onOpenOriginal={() => {
            setActivePath(openedMarkdownPath);
            setOpenedMarkdownPath(null);
            setStatus("Opened the original file outside your library");
          }}
          onImport={(folder) => void importOpenedMarkdown(folder)}
          onChooseLibrary={() => void selectLibrary()}
        />
      )}
      {tableDialogOpen && (
        <TableDialog
          onClose={() => setTableDialogOpen(false)}
          onInsert={(rows, columns) => {
            setTableDialogOpen(false);
            setViewMode("edit");
            window.setTimeout(
              () => editor.current?.insertTable(rows, columns),
              0,
            );
          }}
        />
      )}
      {tableEditorIndex !== null &&
        note &&
        parseMarkdownTables(note.body)[tableEditorIndex] && (
          <TableEditorDialog
            table={parseMarkdownTables(note.body)[tableEditorIndex]}
            onClose={() => setTableEditorIndex(null)}
            onApply={(headers, rows) => {
              const current = noteRef.current;
              if (current?.path === note.path)
                dispatchNoteSession({
                  type: "edited",
                  draft: {
                    ...current,
                    body: replaceMarkdownTable(
                      current.body,
                      tableEditorIndex,
                      headers,
                      rows,
                    ),
                  },
                });
              setTableEditorIndex(null);
            }}
          />
        )}
      {folderDialogOpen && (
        <FolderDialog
          onClose={() => setFolderDialogOpen(false)}
          onCreate={(name) =>
            void createFolder(
              folderDialogParent ? `${folderDialogParent}/${name}` : name,
            )
          }
          title={folderDialogParent ? "Add subfolder" : "New folder"}
          description={
            folderDialogParent
              ? `Create a folder inside ${folderDialogParent}.`
              : "Folders are normal folders inside your notes library."
          }
          placeholder={folderDialogParent ? "Folder name" : "Projects/Website"}
          submitLabel={folderDialogParent ? "Add subfolder" : "Create folder"}
        />
      )}
      {folderRenameTarget && (
        <FolderDialog
          key={folderRenameTarget}
          onClose={() => setFolderRenameTarget(null)}
          onCreate={(name) => void renameFolder(folderRenameTarget, name)}
          title="Rename folder"
          description="This keeps the folder’s notes and subfolders together."
          placeholder="Folder name"
          submitLabel="Rename folder"
          initialValue={folderRenameTarget.split("/").pop() || ""}
        />
      )}
      {importDialogOpen && note && (
        <ImportDailyNoteDialog
          source={note}
          targets={notes.filter(
            (item) =>
              item.path !== note.path && !item.folder.startsWith("Daily"),
          )}
          folders={folders.filter((folder) => !folder.startsWith("Daily"))}
          defaultTargetPath={quickImportDefaultPath}
          onClose={() => setImportDialogOpen(false)}
          onImport={importDailyNote}
          onImportNew={importDailyNoteToNew}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          onTheme={setTheme}
          palette={palette}
          onPalette={setPalette}
          shortcuts={shortcuts}
          onShortcuts={setShortcuts}
          quickCaptureStatus={quickCaptureStatus}
          library={library}
          quickImportTargets={notes.filter(
            (item) => !item.folder.startsWith("Daily"),
          )}
          quickImportDefaultPath={quickImportDefaultPath}
          onQuickImportDefaultPath={setQuickImportDefaultPath}
          onManageTemplates={() => setTemplateEditorOpen(true)}
          updateState={updateState}
          updateMessage={updateError}
          onCheckForUpdates={() => void checkForUpdates(true)}
          onChangeLibrary={() => void selectLibrary()}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {templateEditorOpen && (
        <TemplateEditorDialog
          templates={templates}
          onChange={setTemplates}
          onClose={() => setTemplateEditorOpen(false)}
          onUse={(template) => {
            setTemplateEditorOpen(false);
            void createNote(null, expandTemplate(template));
          }}
        />
      )}
      {updateDialogOpen && availableUpdate && (
        <UpdateDialog
          update={availableUpdate}
          state={updateState}
          error={updateError}
          onClose={() => setUpdateDialogOpen(false)}
          onInstall={() => void installUpdate()}
          onRestart={() =>
            void restartInstalledUpdate(relaunch, setUpdateState, setUpdateError)
          }
          onSkip={skipUpdate}
        />
      )}
      {noteContextMenu && (
        <NoteContextMenu
          note={noteContextMenu.note}
          x={noteContextMenu.x}
          y={noteContextMenu.y}
          isTrashed={noteContextMenu.isTrashed}
          isDaily={noteContextMenu.isDaily}
          folders={folders}
          onClose={() => setNoteContextMenu(null)}
          onDuplicate={duplicateNote}
          onMove={moveNoteToFolder}
          onReveal={revealNote}
          onTrash={trashNote}
          onRestore={restoreNote}
          onDeletePermanently={deleteNotePermanently}
          onImport={(selected) => {
            setActivePath(selected.path);
            setImportDialogOpen(true);
          }}
        />
      )}
      {conflict && (
        <ConflictDialog
          conflict={conflict}
          onChoose={(choice) => {
            const conflictIsActive = activePathRef.current === conflict.path;
            const currentNote = noteRef.current;
            const currentPhase = currentNote
              ? hasUnsavedChanges(currentNote, baseline.current)
                ? "dirty"
                : "clean"
              : "empty";
            noteBaselines.current.set(conflict.path, conflict.disk);
            if (choice === "disk") {
              if (conflictIsActive) {
                baseline.current = conflict.disk;
                dispatchNoteSession({
                  type: "loadSucceeded",
                  note: conflict.disk,
                });
              } else
                dispatchNoteSession({
                  type: "conflictDismissed",
                  phase: currentPhase,
                });
            } else {
              if (conflictIsActive) baseline.current = conflict.disk;
              dispatchNoteSession({
                type: "conflictDismissed",
                phase: conflictIsActive ? "dirty" : currentPhase,
              });
              void enqueueSave(conflict.mine);
            }
          }}
        />
      )}
    </main>
  );
}

function NoteContextMenu({
  note,
  x,
  y,
  isTrashed,
  isDaily,
  folders,
  onClose,
  onDuplicate,
  onMove,
  onReveal,
  onTrash,
  onRestore,
  onDeletePermanently,
  onImport,
}: {
  note: NoteSummary;
  x: number;
  y: number;
  isTrashed: boolean;
  isDaily: boolean;
  folders: string[];
  onClose: () => void;
  onDuplicate: (note: NoteSummary) => Promise<void>;
  onMove: (note: NoteSummary, folder: string) => Promise<void>;
  onReveal: (note: NoteSummary) => Promise<void>;
  onTrash: (note: NoteSummary) => Promise<void>;
  onRestore: (note: NoteSummary) => Promise<void>;
  onDeletePermanently: (note: NoteSummary) => Promise<void>;
  onImport: (note: NoteSummary) => void;
}) {
  return (
    <div
      className="note-context-menu"
      role="menu"
      aria-label={`Actions for ${note.title}`}
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p>{note.title}</p>
      {isTrashed ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              void onRestore(note);
            }}
          >
            Restore
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onClose();
              void onDeletePermanently(note);
            }}
          >
            Delete permanently
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              void onDuplicate(note);
            }}
          >
            Duplicate
          </button>
          <label className="note-context-move">
            Move to folder
            <select
              aria-label="Move note to folder"
              defaultValue=""
              onChange={(event) => {
                const folder = event.target.value;
                if (!folder) return;
                onClose();
                void onMove(note, folder === "__top_level__" ? "" : folder);
              }}
            >
              <option value="" disabled>
                Choose folder…
              </option>
              <option value="__top_level__">Top level</option>
              <CascadingFolderOptions folders={folders} />
            </select>
          </label>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              void onReveal(note);
            }}
          >
            Show in {isMac ? "Finder" : "File Explorer"}
          </button>
          {isDaily && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onImport(note);
              }}
            >
              Import captures
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onClose();
              void onTrash(note);
            }}
          >
            Move to Trash
          </button>
        </>
      )}
    </div>
  );
}
function ColumnResizeHandle({
  className,
  value,
  onChange,
  label,
  direction = 1,
}: {
  className: string;
  value: number;
  onChange: (value: number) => void;
  label: string;
  direction?: 1 | -1;
}) {
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const resize = (move: PointerEvent) =>
      onChange(startWidth + (move.clientX - startX) * direction);
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
  };
  return (
    <div
      className={`sidebar-resizer ${className}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={220}
      aria-valuemax={520}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onChange(value - 16 * direction);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onChange(value + 16 * direction);
        }
      }}
    />
  );
}
export function UpdateDialog({
  update,
  state,
  error,
  onClose,
  onInstall,
  onRestart,
  onSkip,
}: {
  update: AppUpdate;
  state: UpdateState;
  error: string;
  onClose: () => void;
  onInstall: () => void;
  onRestart: () => void;
  onSkip: () => void;
}) {
  const busy = state === "downloading";
  const ready = state === "ready";
  const restarting = state === "restarting";
  return (
    <div className="modal-backdrop">
      <section
        className="modal update-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Margin update"
      >
        <header>
          <div>
            <p className="eyebrow">Update available</p>
            <h2>Margin {update.version}</h2>
          </div>
          <button aria-label="Close update" onClick={onClose}>
            ×
          </button>
        </header>
        <p>{update.body || "A newer version of Margin is ready to install."}</p>
        {error && <p className="update-status">{error}</p>}
        {busy && (
          <p className="update-status">
            Downloading and verifying the update…
          </p>
        )}
        {ready && (
          <p className="update-status">
            Update installed. Restart Margin when you’re ready.
          </p>
        )}
        {restarting && (
          <p className="update-status">Restarting Margin…</p>
        )}
        <div>
          {!ready && !restarting && (
            <>
              <button type="button" onClick={onSkip} disabled={busy}>
                Skip this version
              </button>
              <button
                className="primary"
                type="button"
                onClick={onInstall}
                disabled={busy}
              >
                {busy ? "Updating…" : "Update now"}
              </button>
            </>
          )}
          {(ready || restarting) && (
            <button
              className="primary"
              type="button"
              onClick={onRestart}
              disabled={restarting}
            >
              {restarting ? "Restarting Margin…" : "Restart Margin"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
function FolderDialog({
  onClose,
  onCreate,
  title = "New folder",
  description = "Folders are normal folders inside your notes library.",
  placeholder = "Projects/Website",
  submitLabel = "Create folder",
  initialValue = "",
}: {
  onClose: () => void;
  onCreate: (folder: string) => void;
  title?: string;
  description?: string;
  placeholder?: string;
  submitLabel?: string;
  initialValue?: string;
}) {
  const [folder, setFolder] = useState(initialValue);
  return (
    <div className="modal-backdrop">
      <form
        className="modal table-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(folder);
        }}
      >
        <h2>{title}</h2>
        <p>{description}</p>
        <label>
          Name
          <input
            autoFocus
            placeholder={placeholder}
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!folder.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
function QuickCaptureDialog({
  shortcut,
  onClose,
  onSave,
}: {
  shortcut: string;
  onClose: () => void;
  onSave: (text: string) => boolean | Promise<boolean>;
}) {
  return (
    <div className="modal-backdrop quick-capture-backdrop">
      <CaptureComposer
        shortcut={shortcut}
        status="Saved to today’s Daily note"
        disabled={false}
        onClose={onClose}
        onSave={onSave}
      />
    </div>
  );
}
function ImportDailyNoteDialog({
  source,
  targets,
  folders,
  defaultTargetPath,
  onClose,
  onImport,
  onImportNew,
}: {
  source: NoteDocument;
  targets: NoteSummary[];
  folders: string[];
  defaultTargetPath: string;
  onClose: () => void;
  onImport: (target: NoteSummary) => void;
  onImportNew: (folder: string, title: string) => void;
}) {
  const initialTarget = targets.some((item) => item.path === defaultTargetPath)
    ? defaultTargetPath
    : targets[0]?.path || "";
  const [destination, setDestination] = useState<"note" | "new">("note");
  const [targetPath, setTargetPath] = useState(initialTarget);
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState(`${source.title} captures`);
  const target = targets.find((item) => item.path === targetPath);
  return (
    <div className="modal-backdrop">
      <form
        className="modal import-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (destination === "note" && target) onImport(target);
          if (destination === "new") onImportNew(folder, title);
        }}
      >
        <h2>Import captures</h2>
        <p>
          Keep your Daily note intact and choose where this capture set should
          go.
        </p>
        <fieldset className="import-destination">
          <legend>Destination</legend>
          <label>
            <input
              type="radio"
              name="import-destination"
              checked={destination === "note"}
              onChange={() => setDestination("note")}
            />{" "}
            Append to an existing note
          </label>
          <label>
            <input
              type="radio"
              name="import-destination"
              checked={destination === "new"}
              onChange={() => setDestination("new")}
            />{" "}
            Create a separate note in a folder
          </label>
        </fieldset>
        {destination === "note" ? (
          <label>
            Note
            <select
              value={targetPath}
              onChange={(event) => setTargetPath(event.target.value)}
            >
              <CascadingNoteOptions targets={targets} folders={folders} />
            </select>
          </label>
        ) : (
          <>
            <label>
              Folder
              <select
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
              >
                <option value="">Top level</option>
                <CascadingFolderOptions folders={folders} />
              </select>
            </label>
            <label>
              New note title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </>
        )}
        {destination === "note" &&
          defaultTargetPath &&
          targetPath === defaultTargetPath && (
            <p className="default-import-note">
              Using your default import note.
            </p>
          )}
        {destination === "note" && !targets.length && (
          <p>
            No non-Daily notes are available yet. Create a separate note
            instead.
          </p>
        )}
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={destination === "note" ? !target : !title.trim()}
          >
            Import captures
          </button>
        </div>
      </form>
    </div>
  );
}
function OpenedMarkdownDialog({
  path,
  library,
  folders,
  onClose,
  onOpenOriginal,
  onImport,
  onChooseLibrary,
}: {
  path: string;
  library: string | null;
  folders: string[];
  onClose: () => void;
  onOpenOriginal: () => void;
  onImport: (folder: string) => void;
  onChooseLibrary: () => void;
}) {
  const [folder, setFolder] = useState("");
  return (
    <div className="modal-backdrop">
      <section
        className="modal import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Opened Markdown file"
      >
        <h2>Open Markdown file</h2>
        <p title={path}>
          {fileStem(path)}.md is outside your current library. Margin will never
          change it unless you choose to open and edit the original.
        </p>
        {library ? (
          <label>
            Import a copy to
            <select
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
            >
              <option value="">Top level</option>
              <CascadingFolderOptions folders={folders} />
            </select>
          </label>
        ) : (
          <p>
            Choose a notes folder to import a copy. You can still open the
            original file without one.
          </p>
        )}
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onOpenOriginal}>
            Open original
          </button>
          {library ? (
            <button
              className="primary"
              type="button"
              onClick={() => onImport(folder)}
            >
              Import copy
            </button>
          ) : (
            <button className="primary" type="button" onClick={onChooseLibrary}>
              Choose library
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ConflictDialog({
  conflict,
  onChoose,
}: {
  conflict: Conflict;
  onChoose: (choice: "mine" | "disk") => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal conflict">
        <h2>This note changed outside the app</h2>
        <p>
          Your unsaved edits have not been overwritten. Choose which version to
          keep.
        </p>
        <details>
          <summary>Compare versions</summary>
          <div className="compare">
            <pre>{conflict.mine.body}</pre>
            <pre>{conflict.disk.body}</pre>
          </div>
        </details>
        <div>
          <button onClick={() => onChoose("disk")}>Use disk version</button>
          <button className="primary" onClick={() => onChoose("mine")}>
            Keep my edits
          </button>
        </div>
      </section>
    </div>
  );
}
export {
  ConflictDialog,
  createRefreshCoordinator,
  QuickCaptureDialog,
};

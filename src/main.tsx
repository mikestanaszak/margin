import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { all as highlightLanguages } from "lowlight";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { insertImage, MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import MermaidDiagram from "./MermaidDiagram";
import {
  NoteListItem,
  QuickSwitcher,
  ResizableSplit,
  ViewModeControl,
} from "./components";
import { isMac } from "./platform";
import {
  loadPalette,
  paletteOptions,
  paletteStorageKey,
  type Palette,
} from "./theme-palettes";
import {
  clamp,
  fileStem,
  formatShortcut,
  hasUnsavedChanges,
  matchesShortcut,
  nativeShortcut,
  normalizedKey,
  parseMarkdownTables,
  replaceMarkdownTable,
  titleFromBody,
  toggleTask,
  type MarkdownTable,
} from "./note-utils";
import "./styles.css";

type NoteSummary = {
  path: string;
  title: string;
  tags: string[];
  updated: number;
  excerpt: string;
  folder: string;
};
type NoteDocument = {
  path: string;
  title: string;
  tags: string[];
  body: string;
  updated: number;
  revision: string;
  created?: string;
  updated_at?: string;
};
type LibrarySnapshot = {
  notes: NoteSummary[];
  folders: string[];
  trash: NoteSummary[];
};
type SaveNoteResult =
  | { status: "saved"; note: NoteDocument }
  | { status: "conflict"; disk: NoteDocument }
  | { status: "error"; message: string };
type FolderRenameResult = {
  folder: string;
  paths: { from: string; to: string }[];
};
type ImportedImageResponse = { markdown_path: string; alt: string };
type Filter = {
  type: "all" | "today" | "favorites" | "trash" | "folder";
  folder?: string;
};
type Conflict = { disk: NoteDocument; mine: NoteDocument; path: string };
type MarkdownNode = {
  type?: string;
  lang?: string | null;
  checked?: boolean | null;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
};
type OutlineItem = { index: number; level: number; title: string };
type OutlineNode = OutlineItem & { children: OutlineNode[] };
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
type NoteTemplate = { id: string; name: string; body: string };
type RefreshRequest = { path: string; force: boolean };
const libraryKey = "markdown-notes.library-path";
const favoritesKey = "markdown-notes.pinned";
const themeKey = "markdown-notes.theme";
const shortcutsKey = "markdown-notes.shortcuts";
const quickImportDefaultKey = "markdown-notes.quick-import-default";
// At this size, mounting every card becomes noticeably expensive on lower-end
// machines. Virtual rows enforce the same height so scroll geometry remains exact.
const noteListVirtualizationThreshold = 120;
const virtualNoteRowHeight = 92;
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
function expandTemplate(template: NoteTemplate, date = todayTitle()) {
  return template.body.replace(/{{date}}/g, date).replace(
    /{{time}}/g,
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date()),
  );
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
const shortcutLabels: Record<ShortcutId, string> = {
  newNote: "New note",
  search: "Search",
  switcher: "Quick switcher",
  save: "Save",
  view: "Edit / preview",
  sidebar: "Show / hide library",
  outline: "Toggle outline",
  quickCapture: "Quick capture (global)",
};
const codeBlockLanguages = Object.keys(highlightLanguages).sort();

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

function extractOutlineItems(body: string): OutlineItem[] {
  return [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
    index,
    level: match[1].length,
    title: match[2].trim(),
  }));
}

function shouldVirtualizeNoteList(
  count: number,
  isHierarchicalFolderView: boolean,
) {
  return !isHierarchicalFolderView && count >= noteListVirtualizationThreshold;
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

function App() {
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
  const [note, setNote] = useState<NoteDocument | null>(null);
  const [filter, setFilter] = useState<Filter>({ type: "all" });
  const [query, setQuery] = useState("");
  const [matchingPaths, setMatchingPaths] = useState<Set<string> | null>(null);
  const [backlinks, setBacklinks] = useState<NoteSummary[]>([]);
  const [mode, setMode] = useState<"edit" | "preview" | "split">("preview");
  const [status, setStatus] = useState("Choose a notes folder to begin");
  const [quickOpen, setQuickOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
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
          const snapshot = await invoke<LibrarySnapshot>("load_library_snapshot", {
            libraryPath: request.path,
            force: request.force,
          });
          if (
            generation !== refreshGeneration.current ||
            libraryRef.current !== request.path
          )
            return;
          setNotes(snapshot.notes);
          setFolders(snapshot.folders);
          setTrashNotes(snapshot.trash);
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
    const requestLibrary = library;
    const normalizedQuery = query.trim();
    if (!requestLibrary || !normalizedQuery) {
      setMatchingPaths(null);
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      void invoke<NoteSummary[]>("search_library", {
        libraryPath: requestLibrary,
        query: normalizedQuery,
      })
        .then((matches) => {
          if (!disposed && libraryRef.current === requestLibrary)
            setMatchingPaths(new Set(matches.map((item) => item.path)));
        })
        .catch(() => {
          if (!disposed) setMatchingPaths(new Set());
        });
    }, 120);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [library, query]);
  useEffect(() => {
    if (!library || !note) {
      setBacklinks([]);
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      void invoke<NoteSummary[]>("find_backlinks", {
        libraryPath: library,
        notePath: note.path,
        title: note.title,
      })
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
    localStorage.setItem(themeKey, theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    localStorage.setItem(paletteStorageKey, palette);
    void invoke<void>("set_runtime_palette_icon", { palette }).catch(
      () => undefined,
    );
  }, [palette]);
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
    void invoke("show_quick_capture").catch(() => setQuickCaptureOpen(true));
  };
  useEffect(() => {
    let disposed = false;
    const requested = shortcuts.quickCapture;
    void invoke("configure_quick_capture_shortcut", {
      shortcut: nativeShortcut(requested),
    })
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
    void invoke<string | null>("load_selected_library")
      .then(async (selected) => {
        if (disposed) return;
        if (selected) {
          setLibrary(selected);
          return;
        }
        const legacyLibrary = localStorage.getItem(libraryKey);
        if (legacyLibrary) {
          await invoke("save_selected_library", {
            libraryPath: legacyLibrary,
          }).catch(() => undefined);
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
        const pending = await invoke<string[]>("take_opened_markdown_files");
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
      setNote(null);
      return;
    }
    if (internallyMovedPath.current === activePath) {
      internallyMovedPath.current = null;
      return;
    }
    void (async () => {
      try {
        const loaded = await invoke<NoteDocument>("read_note", {
          path: activePath,
        });
        if (
          generation !== noteLoadGeneration.current ||
          activePathRef.current !== activePath
        )
          return;
        baseline.current = loaded;
        noteBaselines.current.set(loaded.path, loaded);
        setNote(loaded);
        setMode("preview");
      } catch (error) {
        if (generation === noteLoadGeneration.current)
          setStatus(`Could not open note: ${String(error)}`);
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
        const disk = await invoke<NoteDocument>("read_note", {
          path: currentNote.path,
        });
        if (
          noteRef.current?.path !== currentNote.path ||
          baseline.current?.revision !== currentBaseline.revision
        )
          return;
        if (
          disk.revision !== currentBaseline.revision &&
          hasUnsavedChanges(currentNote, currentBaseline)
        )
          setConflict({ disk, mine: currentNote, path: currentNote.path });
        else if (disk.revision !== currentBaseline.revision) {
          baseline.current = disk;
          noteBaselines.current.set(disk.path, disk);
          setNote(disk);
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
      await invoke("save_selected_library", { libraryPath: selected }).catch(
        () => undefined,
      );
      setLibrary(selected);
      setActivePath(null);
      setFilter({ type: "all" });
    }
  };
  const importOpenedMarkdown = async (folder: string) => {
    if (!openedMarkdownPath || !library) return;
    try {
      const imported = await invoke<NoteDocument>("import_markdown_file", {
        sourcePath: openedMarkdownPath,
        libraryPath: library,
        folder: folder || null,
      });
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
      const created = await invoke<NoteDocument>("create_note", {
        libraryPath: library,
        folder,
      });
      let saved = created;
      if (body) {
        const result = await invoke<SaveNoteResult>("save_note", {
          note: { ...created, body },
          libraryPath: library,
        });
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
      const created = await invoke<string>("create_folder", {
        libraryPath: library,
        folder,
      });
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
      const renamed = await invoke<FolderRenameResult>("rename_folder", {
        folder,
        name,
        libraryPath: library,
      });
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
      const isActive =
        activePathRef.current === previousPath ||
        activePathRef.current === originalPath;
      if (isActive) setStatus("Saving…");
      const result = await invoke<SaveNoteResult>("save_note", {
        note: noteToSave,
        libraryPath: library,
      });
      if (result.status === "conflict") {
        setConflict({ disk: result.disk, mine: noteToSave, path: previousPath });
        if (isActive) setStatus("Save conflict: the note changed on disk");
        return;
      }
      if (result.status === "error") {
        if (isActive) setStatus(`Save failed: ${result.message}`);
        return;
      }
      const saved = result.note;
      const pathChanged = saved.path !== previousPath;
      savedPathAliases.current.set(originalPath, saved.path);
      saveQueueKeys.current.set(originalPath, queueKey);
      saveQueueKeys.current.set(saved.path, queueKey);
      noteBaselines.current.set(originalPath, saved);
      noteBaselines.current.set(saved.path, saved);
      if (isActive) {
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
      setNote((current) =>
        current?.path === previousPath
          ? {
              ...current,
              path: saved.path,
              updated: saved.updated,
              revision: saved.revision,
              created: saved.created,
              updated_at: saved.updated_at,
            }
          : current,
      );
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
      if (isActive) setStatus("Saved");
    } catch (error) {
      if (activePathRef.current === draft.path)
        setStatus(`Save failed: ${String(error)}`);
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
      const copy = await invoke<NoteDocument>("duplicate_note", {
        path: source.path,
        libraryPath: library,
      });
      await refresh();
      setActivePath(copy.path);
    } catch (error) {
      setStatus(`Duplicate failed: ${String(error)}`);
    }
  };
  const moveNoteToFolder = async (source: NoteSummary, folder: string) => {
    if (!library) return;
    try {
      const moved = await invoke<NoteDocument>("move_note_to_folder", {
        path: source.path,
        folder: folder || null,
        libraryPath: library,
      });
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
      await invoke("reveal_note_in_file_manager", {
        path: source.path,
        libraryPath: library,
      });
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
      await invoke("move_note_to_trash", {
        path: source.path,
        libraryPath: library,
      });
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
      await invoke("move_folder_to_trash", { folder, libraryPath: library });
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
      const restored = await invoke<NoteDocument>("restore_note_from_trash", {
        path: source.path,
        libraryPath: library,
      });
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
      await invoke("delete_note_permanently", {
        path: source.path,
        libraryPath: library,
      });
      if (activePath === source.path) setActivePath(null);
      await refresh();
      setStatus("Note permanently deleted");
    } catch (error) {
      setStatus(`Could not permanently delete note: ${String(error)}`);
    }
  };
  const saveQuickCapture = async (text: string) => {
    if (!library) return void (await selectLibrary());
    try {
      const daily = await invoke<NoteDocument>("append_quick_note", {
        libraryPath: library,
        text,
      });
      await refresh();
      setQuickCaptureOpen(false);
      setStatus(`Saved to Daily/${fileStem(daily.path)}.md`);
    } catch (error) {
      setStatus(`Could not save quick note: ${String(error)}`);
    }
  };
  const importDailyNote = async (target: NoteSummary) => {
    if (!note || !library) return;
    try {
      const saved = await invoke<NoteDocument>("import_daily_note", {
        sourcePath: note.path,
        targetPath: target.path,
        libraryPath: library,
      });
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
      const saved = await invoke<NoteDocument>(
        "import_daily_note_to_new_note",
        {
          sourcePath: note.path,
          folder: folder || null,
          title,
          libraryPath: library,
        },
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
    () =>
      listedNotes
        .filter(
          (item) =>
            (filter.type !== "folder" ||
              item.folder === filter.folder ||
              item.folder.startsWith(`${filter.folder}/`)) &&
            (filter.type !== "favorites" || favorites.includes(item.path)) &&
            (filter.type !== "today" ||
              (item.folder === "Daily" && item.title === todayTitle())) &&
            (!query || matchingPaths?.has(item.path) === true),
        )
        .sort(
          (left, right) =>
            Number(favorites.includes(right.path)) -
              Number(favorites.includes(left.path)) ||
            right.updated - left.updated,
        ),
    [listedNotes, filter, query, matchingPaths, favorites],
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
  const importImageFile = useCallback(async (file: File) => {
    const activeNote = noteRef.current;
    const activeLibrary = libraryRef.current;
    if (!activeNote || !activeLibrary || !pathIsInLibrary(activeNote.path, activeLibrary)) return;
    if (file.size > 25 * 1024 * 1024) return setStatus("Images must be 25 MB or smaller.");
    try {
      const image = await invoke<ImportedImageResponse>("import_note_image_from_bytes", {
        notePath: activeNote.path, filename: file.name || "pasted-image.png",
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())), libraryPath: activeLibrary,
      });
      insertImportedImage(activeNote.path, image);
    } catch (error) { setStatus(`Could not import image: ${String(error)}`); }
  }, [insertImportedImage]);
  const chooseImage = useCallback(async () => {
    const activeNote = noteRef.current;
    const activeLibrary = libraryRef.current;
    if (!activeNote || !activeLibrary || !pathIsInLibrary(activeNote.path, activeLibrary)) return;
    const selected = await open({ multiple: false, title: "Choose an image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
    if (typeof selected !== "string") return;
    try {
      const image = await invoke<ImportedImageResponse>("import_note_image_from_path", { notePath: activeNote.path, sourcePath: selected, libraryPath: activeLibrary });
      insertImportedImage(activeNote.path, image);
    } catch (error) { setStatus(`Could not import image: ${String(error)}`); }
  }, [insertImportedImage]);
  const noteEditor = note ? (
    <MarkdownEditor
      key={`${note.path}-${isManagedNote ? "managed" : "external"}`}
      ref={editor}
      notePath={note.path}
      value={note.body}
      onChange={(body) =>
        isManagedNote &&
        setNote((current) =>
          current?.path === note.path
            ? { ...current, body, title: titleFromBody(body) }
            : current,
        )
      }
      onBlur={() => isManagedNote && void enqueueSave(note)}
      onInsertImage={isManagedNote ? () => void chooseImage() : undefined}
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
    setNote((current) =>
      current ? { ...current, body: toggleTask(current.body, index, checked) } : current,
    );
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
    () => visibleNotes.map((item) => ({ ...item, tags: [], body: item.excerpt })),
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
      <aside className="sidebar" aria-label="Library navigation">
        <button className="new-note" onClick={() => void createNote()}>
          ＋ New note <kbd>{formatShortcut(shortcuts.newNote)}</kbd>
        </button>
        <nav>
          <button
            className={filter.type === "all" ? "nav-item selected" : "nav-item"}
            onClick={() => setFilter({ type: "all" })}
          >
            <span>All notes</span>
            <small>{notes.length}</small>
          </button>
          <button
            className={
              filter.type === "today" ? "nav-item selected" : "nav-item"
            }
            onClick={() => void openToday()}
          >
            <span>Today</span>
            <small>↗</small>
          </button>
          <button
            className={
              filter.type === "favorites" ? "nav-item selected" : "nav-item"
            }
            onClick={() => setFilter({ type: "favorites" })}
          >
            <span>Favorites</span>
            <small>
              {
                favorites.filter((path) =>
                  notes.some((note) => note.path === path),
                ).length
              }
            </small>
          </button>
          <button
            className={
              filter.type === "trash" ? "nav-item selected" : "nav-item"
            }
            onClick={() => setFilter({ type: "trash" })}
          >
            <span>Trash</span>
            <small>{trashNotes.length}</small>
          </button>
          <div className="section-heading">
            <p className="section-label">Folders</p>
            <button
              type="button"
              aria-label="Create folder"
              title="New folder"
              onClick={() => {
                setFolderDialogParent(null);
                setFolderDialogOpen(true);
              }}
            >
              ＋
            </button>
          </div>
          <FolderTree
            folders={folders}
            counts={folderCounts}
            selected={filter.type === "folder" ? filter.folder : undefined}
            collapsed={collapsedFolders}
            onSelect={(folder) => setFilter({ type: "folder", folder })}
            onToggle={(folder) =>
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
            onRename={setFolderRenameTarget}
            onDelete={(folder) => void deleteFolder(folder)}
          />
        </nav>
        <div className="library-control">
          <button onClick={() => void selectLibrary()}>Change library</button>
          <p title={library ?? undefined}>
            {library ? library.split(/[\\/]/).pop() : "No library selected"}
          </p>
        </div>
      </aside>
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
      <section className="note-list">
        <header>
          <h1>{listTitle}</h1>
          <span>{visibleNotes.length}</span>
        </header>
        {shouldVirtualizeNoteList(
          visibleNotes.length,
          filter.type === "folder" && !query,
        ) ? (
          <VirtualNoteList
            notes={visibleNoteCards}
            activePath={activePath}
            renderNote={renderNote}
          />
        ) : (
          <div className="notes">
            {filter.type === "folder" && !query ? (
            <FolderNoteTree
              root={filter.folder || ""}
              folders={folders}
              notes={visibleNoteCards}
              renderNote={renderNote}
            />
          ) : (
            visibleNoteCards.map(renderNote)
          )}
            {library && !visibleNotes.length && (
              <p className="empty-list">No notes here yet.</p>
            )}
          </div>
        )}
      </section>
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
              <div className="editor-tools">
                <button
                  className="insert-table"
                  type="button"
                  onClick={() => setTableDialogOpen(true)}
                >
                  Table
                </button>
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
          notes={notes.map((item) => ({ ...item, tags: [] }))}
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
              setNote((current) =>
                current?.path === note.path
                  ? {
                      ...current,
                      body: replaceMarkdownTable(
                        current.body,
                        tableEditorIndex,
                        headers,
                        rows,
                      ),
                    }
                  : current,
              );
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
            noteBaselines.current.set(conflict.path, conflict.disk);
            if (choice === "disk") {
              if (conflictIsActive) {
                baseline.current = conflict.disk;
                setNote(conflict.disk);
              }
            } else {
              if (conflictIsActive) baseline.current = conflict.disk;
              void enqueueSave(conflict.mine);
            }
            setConflict(null);
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
function FolderTree({
  folders,
  counts,
  selected,
  collapsed,
  onSelect,
  onToggle,
  onAddSubfolder,
  onRename,
  onDelete,
}: {
  folders: string[];
  counts: Record<string, number>;
  selected?: string;
  collapsed: string[];
  onSelect: (folder: string) => void;
  onToggle: (folder: string) => void;
  onAddSubfolder: (folder: string) => void;
  onRename: (folder: string) => void;
  onDelete: (folder: string) => void;
}) {
  const children = (parent: string) =>
    folders.filter(
      (folder) =>
        (folder.includes("/")
          ? folder.slice(0, folder.lastIndexOf("/"))
          : "") === parent,
    );
  const render = (parent: string, depth: number): React.ReactNode =>
    children(parent).map((folder) => {
      const nested = children(folder);
      const isCollapsed = collapsed.includes(folder);
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      return (
        <React.Fragment key={folder}>
          <div
            className={`folder-row ${selected === folder ? "selected" : ""}`}
            style={{ "--folder-depth": depth } as React.CSSProperties}
          >
            {nested.length ? (
              <button
                type="button"
                className={`folder-disclosure ${isCollapsed ? "collapsed" : ""}`}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${name}`}
                aria-expanded={!isCollapsed}
                onClick={() => onToggle(folder)}
              >
                <span>▾</span>
              </button>
            ) : (
              <span className="folder-spacer" />
            )}
            <button
              type="button"
              className="folder-button"
              onClick={() => onSelect(folder)}
              onDoubleClick={() => onRename(folder)}
              title="Double-click to rename"
            >
              <FolderIcon />
              <span className="folder-name">{name}</span>
              <small>{counts[folder] || 0}</small>
            </button>
            <button
              type="button"
              className="folder-add"
              title={`Add subfolder to ${name}`}
              aria-label={`Add subfolder to ${name}`}
              onClick={() => onAddSubfolder(folder)}
            >
              ＋
            </button>
            <button
              type="button"
              className="folder-delete"
              title={`Delete ${name} (moves it to Trash)`}
              aria-label={`Delete ${name}`}
              onClick={() => onDelete(folder)}
            >
              ×
            </button>
          </div>
          {nested.length > 0 && !isCollapsed && render(folder, depth + 1)}
        </React.Fragment>
      );
    });
  return <div className="folder-tree">{render("", 0)}</div>;
}
function FolderNoteTree({
  root,
  folders,
  notes,
  renderNote,
}: {
  root: string;
  folders: string[];
  notes: NoteSummary[];
  renderNote: (note: NoteSummary) => React.ReactNode;
}) {
  const directNotes = (folder: string) =>
    notes.filter((note) => note.folder === folder);
  const children = (parent: string) =>
    folders
      .filter(
        (folder) =>
          (folder.includes("/")
            ? folder.slice(0, folder.lastIndexOf("/"))
            : "") === parent,
      )
      .filter((folder) =>
        notes.some(
          (note) =>
            note.folder === folder || note.folder.startsWith(`${folder}/`),
        ),
      );
  const renderFolder = (folder: string, depth: number): React.ReactNode => (
    <section
      key={folder}
      className="folder-note-group"
      style={{ "--folder-note-depth": depth } as React.CSSProperties}
    >
      <div className="folder-note-heading">
        <FolderIcon />
        <span>{folder.slice(folder.lastIndexOf("/") + 1)}</span>
        <small>
          {
            notes.filter(
              (note) =>
                note.folder === folder || note.folder.startsWith(`${folder}/`),
            ).length
          }
        </small>
      </div>
      {directNotes(folder).map(renderNote)}
      {children(folder).map((child) => renderFolder(child, depth + 1))}
    </section>
  );
  return (
    <div className="folder-note-tree">
      {directNotes(root).map(renderNote)}
      {children(root).map((folder) => renderFolder(folder, 0))}
    </div>
  );
}

function VirtualNoteList({
  notes,
  activePath,
  renderNote,
}: {
  notes: NoteSummary[];
  activePath: string | null;
  renderNote: (note: NoteSummary) => React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const start = Math.max(0, Math.floor(scrollTop / virtualNoteRowHeight) - 6);
  const visibleRows = Math.ceil(viewportHeight / virtualNoteRowHeight) + 12;
  const end = Math.min(notes.length, start + visibleRows);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const updateViewport = () => setViewportHeight(element.clientHeight || 640);
    updateViewport();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateViewport);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const element = scroller.current;
    const index = notes.findIndex((item) => item.path === activePath);
    if (!element || index < 0) return;
    const rowTop = index * virtualNoteRowHeight;
    const rowBottom = rowTop + virtualNoteRowHeight;
    if (
      rowTop < element.scrollTop ||
      rowBottom > element.scrollTop + element.clientHeight
    ) {
      element.scrollTop = Math.max(0, rowTop - virtualNoteRowHeight * 2);
      setScrollTop(element.scrollTop);
    }
  }, [activePath, notes]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const maxScrollTop = Math.max(
      0,
      notes.length * virtualNoteRowHeight - element.clientHeight,
    );
    if (element.scrollTop > maxScrollTop) {
      element.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [notes.length]);

  return (
    <div
      ref={scroller}
      className="notes virtual-note-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="virtual-note-list-spacer"
        style={{ height: notes.length * virtualNoteRowHeight }}
      >
        <div
          className="virtual-note-list-items"
          style={{ transform: `translateY(${start * virtualNoteRowHeight}px)` }}
        >
          {notes.slice(start, end).map((item) => (
            <div className="virtual-note-row" key={item.path}>
              {renderNote(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="folder-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 5.75c0-.97.78-1.75 1.75-1.75h3.84l1.72 2.05h6.44c.97 0 1.75.78 1.75 1.75v6.45c0 1.1-.9 2-2 2H4.5c-1.1 0-2-.9-2-2V5.75Z" />
    </svg>
  );
}
function outlineTree(items: OutlineItem[]) {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const item of items) {
    const node: OutlineNode = { ...item, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level)
      stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}
function activeOutlineAncestors(
  items: OutlineItem[],
  activeIndex: number | null,
) {
  const ancestors = new Set<number>();
  const position = items.findIndex((item) => item.index === activeIndex);
  if (position < 0) return ancestors;
  let level = items[position].level;
  for (let index = position - 1; index >= 0; index -= 1) {
    if (items[index].level < level) {
      ancestors.add(items[index].index);
      level = items[index].level;
    }
  }
  return ancestors;
}
function scrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
) {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return maximum ? clamp(scrollTop / maximum, 0, 1) : 0;
}
function scrollTopForProgress(
  progress: number,
  scrollHeight: number,
  clientHeight: number,
) {
  return clamp(progress, 0, 1) * Math.max(0, scrollHeight - clientHeight);
}
type ScrollablePane = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>;
type PreviewScrollablePane = ScrollablePane & Pick<HTMLElement, "getBoundingClientRect">;
function syncScrollPosition(source: ScrollablePane, target: ScrollablePane) {
  const next = scrollTopForProgress(
    scrollProgress(source.scrollTop, source.scrollHeight, source.clientHeight),
    target.scrollHeight,
    target.clientHeight,
  );
  if (Math.abs(target.scrollTop - next) > 1) target.scrollTop = next;
  return next;
}
function scrollOutlineTargetIntoPreview(preview: PreviewScrollablePane, heading: HTMLElement) {
  const next = clamp(
    preview.scrollTop + heading.getBoundingClientRect().top - preview.getBoundingClientRect().top - 76,
    0,
    Math.max(0, preview.scrollHeight - preview.clientHeight),
  );
  preview.scrollTop = next;
  return next;
}
function activeOutlineIndexAtScroll(
  items: OutlineItem[],
  headingOffsets: number[],
  scrollTop: number,
  offset = 76,
) {
  let activeItem = 0;
  for (let index = 0; index < headingOffsets.length; index += 1) {
    if (headingOffsets[index] > scrollTop + offset) break;
    activeItem = index;
  }
  return items[activeItem]?.index ?? items[0]?.index ?? null;
}

function Outline({
  items,
  dirty,
  width = 280,
  onClose,
}: {
  items: OutlineItem[];
  dirty: boolean;
  width?: number;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(
    () => items[0]?.index ?? null,
  );
  const outline = useRef<HTMLElement>(null);
  const tree = useMemo(() => outlineTree(items), [items]);
  const activeAncestors = useMemo(
    () => activeOutlineAncestors(items, activeIndex),
    [items, activeIndex],
  );

  useEffect(() => {
    setActiveIndex(items[0]?.index ?? null);
  }, [items]);
  useEffect(() => {
    const preview = document.querySelector<HTMLElement>(
      ".note-content .preview",
    );
    const outlineScroller = outline.current;
    if (!preview || !outlineScroller) return;
    const headings = () => [
      ...preview.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    ];
    const syncActive = () => {
      const previewTop = preview.getBoundingClientRect().top;
      const headingOffsets = headings().map(
        (heading) =>
          heading.getBoundingClientRect().top - previewTop + preview.scrollTop,
      );
      setActiveIndex(
        activeOutlineIndexAtScroll(items, headingOffsets, preview.scrollTop),
      );
    };
    const syncOutline = () => {
      syncScrollPosition(preview, outlineScroller);
    };
    const syncPreview = () => {
      syncScrollPosition(outlineScroller, preview);
    };
    let lastPreviewScrollTop = preview.scrollTop;
    let lastOutlineScrollTop = outlineScroller.scrollTop;
    const onPreviewScroll = () => {
      syncActive();
      syncOutline();
      lastPreviewScrollTop = preview.scrollTop;
      lastOutlineScrollTop = outlineScroller.scrollTop;
    };
    const onOutlineScroll = () => {
      syncPreview();
      syncActive();
      syncOutline();
      lastPreviewScrollTop = preview.scrollTop;
      lastOutlineScrollTop = outlineScroller.scrollTop;
    };
    let frame = 0;
    const reconcileScrollPositions = () => {
      if (Math.abs(preview.scrollTop - lastPreviewScrollTop) > 1)
        onPreviewScroll();
      else if (Math.abs(outlineScroller.scrollTop - lastOutlineScrollTop) > 1)
        onOutlineScroll();
      frame = window.requestAnimationFrame(reconcileScrollPositions);
    };
    syncActive();
    syncOutline();
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    outlineScroller.addEventListener("scroll", onOutlineScroll, {
      passive: true,
    });
    frame = window.requestAnimationFrame(reconcileScrollPositions);
    return () => {
      window.cancelAnimationFrame(frame);
      preview.removeEventListener("scroll", onPreviewScroll);
      outlineScroller.removeEventListener("scroll", onOutlineScroll);
    };
  }, [items]);

  const open = (item: OutlineItem) => {
    setActiveIndex(item.index);
    const preview = document.querySelector<HTMLElement>(".note-content .preview");
    const heading = document.querySelectorAll<HTMLElement>(
      ".note-content .preview h1, .note-content .preview h2, .note-content .preview h3, .note-content .preview h4, .note-content .preview h5, .note-content .preview h6",
    )[item.index];
    if (preview && heading) {
      scrollOutlineTargetIntoPreview(preview, heading);
      preview.dispatchEvent(new Event("scroll"));
      return;
    }
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const renderNode = (node: OutlineNode) => (
    <div
      key={`${node.index}-${node.title}`}
      className={`outline-node level-${node.level}${node.children.length ? " has-children" : ""}${activeAncestors.has(node.index) ? " active-ancestor" : ""}`}
      style={
        {
          "--outline-indent": `${(node.level - 1) * 13}px`,
        } as React.CSSProperties
      }
    >
      <button
        type="button"
        data-outline-index={node.index}
        className={activeIndex === node.index ? "active" : ""}
        aria-current={activeIndex === node.index ? "location" : undefined}
        onClick={() => open(node)}
      >
        <span className="outline-node-marker" aria-hidden="true">
          <span className="outline-node-dot" />
        </span>
        <span className="outline-node-label">{node.title}</span>
        {activeIndex === node.index && dirty && (
          <span className="outline-unsaved" aria-label="Unsaved changes" />
        )}
      </button>
      {node.children.length > 0 && (
        <div className="outline-children">{node.children.map(renderNode)}</div>
      )}
    </div>
  );
  return (
    <aside
      ref={outline}
      className="outline"
      style={{ "--outline-pane-width": `${width}px` } as React.CSSProperties}
      aria-label="Note outline"
    >
      <header>
        <strong>Outline</strong>
        <button
          type="button"
          aria-label="Close outline"
          title="Close outline (Esc)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {items.length ? (
        <nav className="outline-tree">{tree.map(renderNode)}</nav>
      ) : (
        <p>Add headings to create an outline.</p>
      )}
    </aside>
  );
}
function TableDialog({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (rows: number, columns: number) => void;
}) {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  return (
    <div className="modal-backdrop">
      <form
        className="modal table-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onInsert(rows, columns);
        }}
      >
        <h2>Insert table</h2>
        <p>Create the Markdown structure, then type directly into the cells.</p>
        <label>
          Columns
          <input
            type="number"
            min="1"
            max="8"
            value={columns}
            onChange={(event) => setColumns(Number(event.target.value))}
          />
        </label>
        <label>
          Rows
          <input
            type="number"
            min="1"
            max="12"
            value={rows}
            onChange={(event) => setRows(Number(event.target.value))}
          />
        </label>
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Insert table</button>
        </div>
      </form>
    </div>
  );
}
function TableEditorDialog({
  table,
  onClose,
  onApply,
}: {
  table: MarkdownTable;
  onClose: () => void;
  onApply: (headers: string[], rows: string[][]) => void;
}) {
  const [headers, setHeaders] = useState(table.headers);
  const [rows, setRows] = useState(table.rows);
  const move = <T,>(items: T[], from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  const changeHeader = (index: number, value: string) =>
    setHeaders((current) =>
      current.map((cell, cellIndex) => (cellIndex === index ? value : cell)),
    );
  const changeCell = (row: number, column: number, value: string) =>
    setRows((current) =>
      current.map((cells, rowIndex) =>
        rowIndex === row
          ? cells.map((cell, columnIndex) =>
              columnIndex === column ? value : cell,
            )
          : cells,
      ),
    );
  const addColumn = (at = headers.length) => {
    if (headers.length >= 12) return;
    setHeaders((current) => [
      ...current.slice(0, at),
      `Column ${current.length + 1}`,
      ...current.slice(at),
    ]);
    setRows((current) =>
      current.map((row) => [...row.slice(0, at), "", ...row.slice(at)]),
    );
  };
  const removeColumn = (column: number) => {
    if (headers.length <= 1) return;
    setHeaders((current) => current.filter((_, index) => index !== column));
    setRows((current) =>
      current.map((row) => row.filter((_, index) => index !== column)),
    );
  };
  const moveColumn = (from: number, to: number) => {
    if (from === to) return;
    setHeaders((current) => move(current, from, to));
    setRows((current) => current.map((row) => move(row, from, to)));
  };
  const addRow = (at = rows.length) => {
    if (rows.length >= 50) return;
    setRows((current) => [
      ...current.slice(0, at),
      headers.map(() => ""),
      ...current.slice(at),
    ]);
  };
  const moveRow = (from: number, to: number) => {
    if (from === to) return;
    setRows((current) => move(current, from, to));
  };
  const pointerReorder = (
    event: React.PointerEvent<HTMLButtonElement>,
    from: number,
    selector: string,
    reorder: (from: number, to: number) => void,
  ) => {
    event.preventDefault();
    let current = from;
    const onMove = (moveEvent: PointerEvent) => {
      const target = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest<HTMLElement>(selector);
      const targetIndex = Number(target?.dataset.index);
      if (
        !Number.isInteger(targetIndex) ||
        targetIndex < 0 ||
        targetIndex === current
      )
        return;
      reorder(current, targetIndex);
      current = targetIndex;
    };
    const onStop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop, { once: true });
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal table-editor-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(headers, rows);
        }}
      >
        <header>
          <div>
            <h2>Edit table</h2>
            <p>
              Drag ⠿ to reorder. Use ＋ beside a row or column to add after
              it.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close table editor"
            onClick={onClose}
          >
          ×
          </button>
        </header>
        <div className="table-grid-wrap">
          <table className="table-editor-grid">
            <thead>
              <tr>
                <th className="table-drag-column" />
                {headers.map((header, column) => (
                  <th key={column} data-table-column data-index={column}>
                    <button
                      type="button"
                      className="table-drag-handle"
                      aria-label={`Drag column ${column + 1}`}
                      title="Drag to reorder column"
                      onPointerDown={(event) =>
                        pointerReorder(
                          event,
                          column,
                          "[data-table-column]",
                          moveColumn,
                        )
                      }
                    >
                      ⠿
                    </button>
                    <input
                      aria-label={`Header ${column + 1}`}
                      value={header}
                      onChange={(event) =>
                        changeHeader(column, event.target.value)
                      }
                    />
                    <span className="table-column-actions">
                      <button
                        type="button"
                        title={`Add column after ${column + 1}`}
                        aria-label={`Add column after ${column + 1}`}
                        onClick={() => addColumn(column + 1)}
                      >
                        ＋
                      </button>
                      <button
                        type="button"
                        title={`Delete column ${column + 1}`}
                        aria-label={`Delete column ${column + 1}`}
                        disabled={headers.length <= 1}
                        onClick={() => removeColumn(column)}
                      >
                        ×
                      </button>
                    </span>
                  </th>
                ))}
                <th className="table-row-action" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} data-table-row data-index={rowIndex}>
                  <td className="table-drag-column">
                    <button
                      type="button"
                      className="table-drag-handle"
                      aria-label={`Drag row ${rowIndex + 1}`}
                      title="Drag to reorder row"
                      onPointerDown={(event) =>
                        pointerReorder(
                          event,
                          rowIndex,
                          "[data-table-row]",
                          moveRow,
                        )
                      }
                    >
                      ⠿
                    </button>
                  </td>
                  {headers.map((_, column) => (
                    <td key={column}>
                      <input
                        aria-label={`Row ${rowIndex + 1}, column ${column + 1}`}
                        value={row[column] || ""}
                        onChange={(event) =>
                          changeCell(rowIndex, column, event.target.value)
                        }
                      />
                    </td>
                  ))}
                  <td className="table-row-action">
                    <button
                      type="button"
                      className="table-add-after"
                      title={`Add row after ${rowIndex + 1}`}
                      aria-label={`Add row after ${rowIndex + 1}`}
                      onClick={() => addRow(rowIndex + 1)}
                    >
                      ＋
                    </button>
                    <button
                      type="button"
                      className="table-remove"
                      title={`Delete row ${rowIndex + 1}`}
                      aria-label={`Delete row ${rowIndex + 1}`}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((_, index) => index !== rowIndex),
                        )
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-editor-actions">
          <span />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Apply changes</button>
        </div>
      </form>
    </div>
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
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="modal-backdrop quick-capture-backdrop">
      <form
        className="modal quick-capture-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(text);
        }}
      >
        <header>
          <div>
            <p className="eyebrow">Quick capture</p>
            <h2>What’s on your mind?</h2>
          </div>
          <button
            type="button"
            aria-label="Close quick capture"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <textarea
          autoFocus
          placeholder="Start typing…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSave(text);
            }
          }}
        />
        <footer>
          <span>Saved to today’s Daily note</span>
          <span>
            <kbd>{shortcut}</kbd> opens · <kbd>⌘↵</kbd> saves
          </span>
        </footer>
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!text.trim()}>
            Save capture
          </button>
        </div>
      </form>
    </div>
  );
}
type CaptureMarkdownEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};
function captureMarkdownEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
  shiftKey = false,
): CaptureMarkdownEdit | undefined {
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEnd = value.indexOf("\n", selectionStart);
  const end = lineEnd < 0 ? value.length : lineEnd;
  if (key === "Tab") {
    const indentation =
      value.slice(lineStart, selectionStart).match(/^(?: {1,2}|\t)/)?.[0] || "";
    if (shiftKey && indentation)
      return {
        value: `${value.slice(0, lineStart)}${value.slice(lineStart + indentation.length)}`,
        selectionStart: Math.max(
          lineStart,
          selectionStart - indentation.length,
        ),
        selectionEnd: Math.max(lineStart, selectionEnd - indentation.length),
      };
    if (!shiftKey)
      return {
        value: `${value.slice(0, lineStart)}  ${value.slice(lineStart)}`,
        selectionStart: selectionStart + 2,
        selectionEnd: selectionEnd + 2,
      };
    return undefined;
  }
  if (key !== "Enter" || selectionStart !== selectionEnd) return undefined;
  const beforeCaret = value.slice(lineStart, selectionStart);
  const task = beforeCaret.match(/^([ \t]*)([-+*]) \[[ xX]\]\s?(.*)$/);
  const bullet = beforeCaret.match(/^([ \t]*)([-+*])\s+(.*)$/);
  const ordered = beforeCaret.match(/^([ \t]*)(\d+)([.)])\s+(.*)$/);
  const quote = beforeCaret.match(/^([ \t]*>\s?)(.*)$/);
  const match = task || bullet || ordered || quote;
  if (!match) return undefined;
  const content = match[match.length - 1];
  const indent = task || bullet || ordered ? match[1] : "";
  if (!content.trim())
    return {
      value: `${value.slice(0, lineStart)}${indent}${value.slice(selectionStart)}`,
      selectionStart: lineStart + indent.length,
      selectionEnd: lineStart + indent.length,
    };
  const prefix = task
    ? `${match[1]}${match[2]} [ ] `
    : bullet
      ? `${match[1]}${match[2]} `
      : ordered
        ? `${match[1]}${Number(match[2]) + 1}${match[3]} `
        : `${match[1]}`;
  const insertion = `\n${prefix}`;
  return {
    value: `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`,
    selectionStart: selectionStart + insertion.length,
    selectionEnd: selectionStart + insertion.length,
  };
}
function CaptureWindow() {
  const [library, setLibrary] = useState<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [templates, setTemplates] = useState<NoteTemplate[]>(loadTemplates);
  const input = useRef<HTMLTextAreaElement>(null);
  const shortcut = formatShortcut(defaultShortcuts.quickCapture);
  const hide = useCallback(() => {
    void (async () => {
      try {
        await invoke("hide_quick_capture");
      } catch {
        await getCurrentWindow()
          .hide()
          .catch(() => undefined);
      }
    })();
  }, []);
  useEffect(() => {
    void invoke<string | null>("load_selected_library")
      .then(setLibrary)
      .catch(() => setLibrary(null))
      .finally(() => setLibraryReady(true));
  }, []);
  useEffect(() => {
    const syncTemplates = () => setTemplates(loadTemplates());
    window.addEventListener("focus", syncTemplates);
    return () => window.removeEventListener("focus", syncTemplates);
  }, []);
  useEffect(() => {
    const focus = () => window.setTimeout(() => input.current?.focus(), 40);
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hide();
      }
    };
    const suppressWebviewMenu = (event: MouseEvent) => event.preventDefault();
    document.documentElement.classList.add("capture-window-html");
    document.body.classList.add("capture-window-body");
    focus();
    window.addEventListener("focus", focus);
    window.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("contextmenu", suppressWebviewMenu);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("contextmenu", suppressWebviewMenu);
      document.documentElement.classList.remove("capture-window-html");
      document.body.classList.remove("capture-window-body");
    };
  }, [hide]);
  const save = async () => {
    if (!text.trim()) return;
    if (!libraryReady) {
      setStatus("Loading your notes folder…");
      return;
    }
    if (!library) {
      setStatus("Open Margin and choose your notes folder first.");
      return;
    }
    try {
      await invoke<NoteDocument>("append_quick_note", {
        libraryPath: library,
        text,
        dailyTemplate: expandTemplate(
          templates.find((template) => template.id === "daily") ||
            templates[0] ||
            defaultTemplates[0],
        ),
      });
      setText("");
      setStatus("Saved to today’s Daily note");
      window.setTimeout(hide, 160);
    } catch (error) {
      setStatus(`Could not save: ${String(error)}`);
    }
  };
  return (
    <main className="capture-window">
      <form
        className="capture-card"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="capture-header">
          <div>
            <p className="eyebrow">Margin</p>
            <h1>Quick capture</h1>
          </div>
          <button
            type="button"
            className="capture-close"
            aria-label="Hide quick capture"
            onClick={hide}
          >
            ×
          </button>
        </header>
        <div className="capture-composer">
          <textarea
            ref={input}
            placeholder="Start typing…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void save();
                return;
              }
              const textarea = event.currentTarget;
              const next = captureMarkdownEdit(
                text,
                textarea.selectionStart,
                textarea.selectionEnd,
                event.key,
                event.shiftKey,
              );
              if (next) {
                event.preventDefault();
                setText(next.value);
                window.requestAnimationFrame(() =>
                  textarea.setSelectionRange(
                    next.selectionStart,
                    next.selectionEnd,
                  ),
                );
              }
            }}
          />
        </div>
        <footer>
          <span className="capture-status">
            {status ||
              (libraryReady
                ? "Adds to today’s Daily note"
                : "Loading your notes folder…")}
          </span>
          <span className="capture-hint">
            <kbd>{shortcut}</kbd>
            <span>opens</span>
            <kbd>{isMac ? "⌘↵" : "Ctrl+Enter"}</kbd>
            <span>saves</span>
          </span>
        </footer>
        <div className="capture-actions">
          <button type="button" className="capture-cancel" onClick={hide}>
            Cancel
          </button>
          <button className="primary" disabled={!text.trim() || !libraryReady}>
            Save capture
          </button>
        </div>
      </form>
    </main>
  );
}
function folderOptionLabel(folder: string) {
  const parts = folder.split("/");
  return `${"—".repeat(parts.length - 1)}▾ ${parts[parts.length - 1]}`;
}
function CascadingFolderOptions({ folders }: { folders: string[] }) {
  return (
    <>
      {[...folders]
        .sort((left, right) => left.localeCompare(right))
        .map((folder) => (
          <option key={folder} value={folder}>
            {folderOptionLabel(folder)}
          </option>
        ))}
    </>
  );
}
function CascadingNoteOptions({
  targets,
  folders = [],
}: {
  targets: NoteSummary[];
  folders?: string[];
}) {
  const allFolders = [
    ...new Set([
      ...folders,
      ...targets.map((target) => target.folder).filter(Boolean),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const directNotes = (folder: string) =>
    targets
      .filter((target) => target.folder === folder)
      .sort((left, right) => left.title.localeCompare(right.title));
  const children = (folder: string) =>
    allFolders.filter(
      (candidate) =>
        (candidate.includes("/")
          ? candidate.slice(0, candidate.lastIndexOf("/"))
          : "") === folder,
    );
  const render = (folder: string, depth: number): React.ReactNode[] =>
    children(folder).flatMap((child) => {
      const name = child.slice(child.lastIndexOf("/") + 1);
      return [
        <option key={`folder-${child}`} value={`folder-${child}`} disabled>
          {"—".repeat(depth)}▾ {name}
        </option>,
        ...directNotes(child).map((note) => (
          <option key={note.path} value={note.path}>
            {"—".repeat(depth + 1)}• {note.title}
          </option>
        )),
        ...render(child, depth + 1),
      ];
    });
  return (
    <>
      {directNotes("").map((note) => (
        <option key={note.path} value={note.path}>
          • {note.title}
        </option>
      ))}
      {render("", 0)}
    </>
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
function ShortcutRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (shortcut: string) => void;
}) {
  const capture = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const parts = [
      event.metaKey && "meta",
      event.ctrlKey && "ctrl",
      event.altKey && "alt",
      event.shiftKey && "shift",
      normalizedKey(event),
    ].filter(Boolean);
    if (parts.length > 1) onChange(parts.join("+"));
  };
  return (
    <input
      className="shortcut-recorder"
      aria-label="Shortcut"
      readOnly
      value={formatShortcut(value)}
      onKeyDown={capture}
    />
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

function TemplateEditorDialog({
  templates,
  onChange,
  onClose,
  onUse,
}: {
  templates: NoteTemplate[];
  onChange: (templates: NoteTemplate[]) => void;
  onClose: () => void;
  onUse: (template: NoteTemplate) => void;
}) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id || "");
  const selected =
    templates.find((template) => template.id === selectedId) || templates[0];
  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [onClose]);
  const update = (changes: Partial<NoteTemplate>) =>
    selected &&
    onChange(
      templates.map((template) =>
        template.id === selected.id ? { ...template, ...changes } : template,
      ),
    );
  const add = () => {
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `template-${Date.now()}`;
    const template = { id, name: "Untitled template", body: "# Untitled\n\n" };
    onChange([...templates, template]);
    setSelectedId(id);
  };
  const duplicate = () => {
    if (!selected) return;
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `template-${Date.now()}`;
    const copy = { ...selected, id, name: `${selected.name} copy` };
    onChange([...templates, copy]);
    setSelectedId(id);
  };
  const remove = () => {
    if (!selected || templates.length === 1) return;
    const next = templates.filter((template) => template.id !== selected.id);
    onChange(next);
    setSelectedId(next[0].id);
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal template-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Template editor"
      >
        <header>
          <div>
            <p className="eyebrow">Margin</p>
            <h2>Templates</h2>
          </div>
          <button aria-label="Close templates" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="template-editor-body">
          <nav aria-label="Templates">
            {templates.map((template) => (
              <button
                key={template.id}
                className={template.id === selected?.id ? "selected" : ""}
                onClick={() => setSelectedId(template.id)}
              >
                {template.name}
              </button>
            ))}
            <button className="template-add" onClick={add}>
              ＋ New template
            </button>
          </nav>
          {selected && (
            <div className="template-workspace">
              <div className="template-actions">
                <label>
                  Name
                  <input
                    value={selected.name}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <div>
                  <button type="button" onClick={duplicate}>
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={templates.length === 1}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onUse(selected)}
                  >
                    Use as new note
                  </button>
                </div>
              </div>
              <div className="template-columns">
                <label>
                  Markdown
                  <textarea
                    value={selected.body}
                    onChange={(event) => update({ body: event.target.value })}
                    spellCheck
                  />
                </label>
                <article className="preview template-preview">
                  <p className="eyebrow">Preview</p>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {expandTemplate(selected)}
                  </ReactMarkdown>
                </article>
              </div>
              <p className="template-help">
                Variables: <code>{"{{date}}"}</code> and{" "}
                <code>{"{{time}}"}</code>. The template named “Daily note”
                powers Today and Quick Capture.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  theme,
  onTheme,
  palette,
  onPalette,
  shortcuts,
  onShortcuts,
  quickCaptureStatus,
  library,
  quickImportTargets,
  quickImportDefaultPath,
  onQuickImportDefaultPath,
  onManageTemplates,
  updateState,
  updateMessage,
  onCheckForUpdates,
  onChangeLibrary,
  onClose,
}: {
  theme: "system" | "light" | "dark";
  onTheme: (theme: "system" | "light" | "dark") => void;
  palette: Palette;
  onPalette: (palette: Palette) => void;
  shortcuts: Shortcuts;
  onShortcuts: (shortcuts: Shortcuts) => void;
  quickCaptureStatus: string;
  library: string | null;
  quickImportTargets: NoteSummary[];
  quickImportDefaultPath: string;
  onQuickImportDefaultPath: (path: string) => void;
  onManageTemplates?: () => void;
  updateState: UpdateState;
  updateMessage: string;
  onCheckForUpdates: () => void;
  onChangeLibrary: () => void;
  onClose: () => void;
}) {
  const selectedDefault = quickImportTargets.some(
    (note) => note.path === quickImportDefaultPath,
  )
    ? quickImportDefaultPath
    : "";
  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [onClose]);
  return (
    <div className="modal-backdrop settings-backdrop">
      <section
        className="modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header>
          <h2>Settings</h2>
          <button aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </header>
        <label className="setting-row">
          Appearance
          <select
            value={theme}
            onChange={(event) =>
              onTheme(event.target.value as "system" | "light" | "dark")
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <fieldset className="palette-picker">
          <legend>Palette</legend>
          <div className="palette-options">
            {paletteOptions.map(({ id, label }) => (
              <label className="palette-option" data-palette={id} key={id}>
                <input
                  type="radio"
                  name="palette"
                  value={id}
                  checked={palette === id}
                  onChange={() => onPalette(id)}
                />
                <span className="palette-swatch" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <section className="quick-import-settings">
          <h3>Quick capture imports</h3>
          <p>
            Preselect a work log or any other note whenever you import a Daily
            capture. You can still choose another note or make a separate note
            in any folder.
          </p>
          <label className="setting-row">
            <span>Default import note</span>
            <select
              value={selectedDefault}
              onChange={(event) => onQuickImportDefaultPath(event.target.value)}
            >
              <option value="">Choose each time</option>
              <CascadingNoteOptions targets={quickImportTargets} />
            </select>
          </label>
        </section>
        <section className="template-settings">
          <h3>Templates & daily notes</h3>
          <p>
            Create reusable Markdown templates. Today creates a dated note in
            your Daily folder from the Daily note template.
          </p>
          <button type="button" onClick={onManageTemplates}>
            Manage templates
          </button>
        </section>
        <section className="shortcut-settings">
          <h3>Keyboard shortcuts</h3>
          <p>Click a shortcut and press its new combination.</p>
          {(Object.keys(shortcutLabels) as ShortcutId[]).map((id) => (
            <label key={id} className="setting-row">
              <span>{shortcutLabels[id]}</span>
              <ShortcutRecorder
                value={shortcuts[id]}
                onChange={(value) => onShortcuts({ ...shortcuts, [id]: value })}
              />
            </label>
          ))}
          <p className="shortcut-status">{quickCaptureStatus}</p>
        </section>
        <section className="code-language-docs">
          <h3>Code blocks</h3>
          <p>
            Use a language after the opening fence, for example{" "}
            <code>```typescript</code>. The full Highlight.js grammar set is
            included.
          </p>
          <details>
            <summary>
              {codeBlockLanguages.length} supported language names
            </summary>
            <div>
              {codeBlockLanguages.map((language) => (
                <code key={language}>{language}</code>
              ))}
            </div>
          </details>
        </section>
        <section className="settings-updates">
          <h3>Updates</h3>
          <p>Check GitHub for the latest signed Margin release.</p>
          <button
            type="button"
            onClick={onCheckForUpdates}
            disabled={updateState === "checking"}
          >
            {updateState === "checking" ? "Checking…" : "Check for updates"}
          </button>
          {updateMessage && (
            <p className="settings-update-status">{updateMessage}</p>
          )}
        </section>
        <section className="settings-library">
          <h3>Library</h3>
          <p title={library ?? undefined}>{library || "No library selected"}</p>
          <button onClick={onChangeLibrary}>Change library</button>
        </section>
      </section>
    </div>
  );
}
function MarkdownPreview({
  markdown,
  notePath,
  notes,
  onOpen,
  onOpenExternalError = () => undefined,
  onEditTable,
  onToggleTask,
  editable = true,
}: {
  markdown: string;
  notePath: string;
  notes: NoteSummary[];
  onOpen: (note: NoteSummary) => void;
  onOpenExternalError?: (message: string) => void;
  onEditTable: (index: number) => void;
  onToggleTask: (index: number, checked: boolean) => void;
  editable?: boolean;
}) {
  const resolved = useMemo(
    () =>
      markdown.replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_, title, label) =>
          `[${label || title}](note:${encodeURIComponent(title.trim())})`,
      ),
    [markdown],
  );
  const directory = notePath.replace(/[\\/][^\\/]+$/, "");
  const localAsset = (src?: string) =>
    !src || /^(https?:|data:|asset:)/i.test(src)
      ? src
      : convertFileSrc(`${directory}/${src}`);
  const markdownTables = useMemo(() => parseMarkdownTables(markdown), [markdown]);
  const normalizePath = (path: string) => {
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    return parts.join("/").toLowerCase();
  };
  const markdownLinkTarget = (href?: string) => {
    const relativePath = href?.split(/[?#]/, 1)[0];
    if (
      !relativePath ||
      !/\.md$/i.test(relativePath) ||
      /^[a-z][a-z\d+.-]*:/i.test(relativePath)
    )
      return undefined;
    const targetPath = /^[\\/]|^[a-z]:[\\/]/i.test(relativePath)
      ? relativePath
      : `${directory}/${decodeURIComponent(relativePath)}`;
    return notes.find(
      (item) => normalizePath(item.path) === normalizePath(targetPath),
    );
  };
  const externalUrl = (href?: string) => {
    const value = href?.trim();
    if (!value) return undefined;
    if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
    return /^(?:www\.)?[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d-]+)+(?:[/?#].*)?$/i.test(
      value,
    )
      ? `https://${value}`
      : undefined;
  };
  const openExternal = (href?: string) => {
    const url = externalUrl(href);
    if (!url) {
      onOpenExternalError(
        "Could not open link: use a full web address such as https://example.com",
      );
      return;
    }
    void invoke("open_external_url", { url }).catch((error) =>
      onOpenExternalError(String(error)),
    );
  };
  const togglePreviewTask = (event: React.MouseEvent<HTMLElement>) => {
    const input =
      event.target instanceof HTMLInputElement &&
      event.target.type === "checkbox"
        ? event.target
        : null;
    const item = input?.closest<HTMLElement>("li[data-task-index]");
    const index = Number(item?.dataset.taskIndex);
    if (editable && input && Number.isInteger(index) && index >= 0)
      onToggleTask(index, input.checked);
  };
  const selectInlineCode = (event: React.MouseEvent<HTMLElement>) => {
    const code =
      event.target instanceof Element ? event.target.closest("code") : null;
    if (!code || code.parentElement?.tagName === "PRE") return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  return (
    <article
      className="preview"
      onClick={togglePreviewTask}
      onDoubleClick={selectInlineCode}
    >
      <ReactMarkdown
        urlTransform={(url) =>
          url.startsWith("note:") ? url : defaultUrlTransform(url)
        }
        remarkPlugins={[remarkGfm, annotateTaskIndexes, normalizeCodeLanguages]}
        rehypePlugins={[[rehypeHighlight, { languages: highlightLanguages }]]}
        components={{
          pre: ({ children, node: _node, ...props }) => {
            const child = React.Children.toArray(children)[0];
            if (
              React.isValidElement<{
                className?: string;
                children?: React.ReactNode;
              }>(child) &&
              child.props.className?.split(/\s+/).includes("language-mermaid")
            )
              return (
                <MermaidDiagram
                  source={String(child.props.children || "").replace(/\n$/, "")}
                />
              );
            return <PreviewCodeBlock {...props}>{children}</PreviewCodeBlock>;
          },
          a: ({ href, children }) => {
            if (href?.startsWith("note:")) {
              const title = decodeURIComponent(href.slice(5));
              const target = notes.find(
                (item) => item.title.toLowerCase() === title.toLowerCase(),
              );
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (target) onOpen(target);
                  }}
                >
                  {children}
                </a>
              );
            }
            const target = markdownLinkTarget(href);
            if (target)
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpen(target);
                  }}
                >
                  {children}
                </a>
              );
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  openExternal(href);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => <img src={localAsset(src)} alt={alt || ""} />,
          table: ({ children, node, ...props }) => {
            const sourceLine = (
              node as { position?: { start?: { line?: number } } }
            ).position?.start?.line;
            const index = markdownTables.findIndex(
              (table) => table.start === (sourceLine || 0) - 1,
            );
            const openEditor = () => {
              if (editable && index >= 0) onEditTable(index);
            };
            return (
              <div className="preview-table-shell">
                {editable && (
                  <div className="preview-table-toolbar">
                    <span>Table</span>
                    <button
                      type="button"
                      className="preview-table-edit"
                      aria-label={`Edit table ${index + 1}`}
                      onClick={openEditor}
                    >
                      Edit table
                    </button>
                  </div>
                )}
                <table {...props} onClick={editable ? openEditor : undefined}>
                  {children}
                </table>
              </div>
            );
          },
          input: ({ type, checked, disabled: _disabled, ...props }) => {
            if (type !== "checkbox") return <input type={type} {...props} />;
            return (
              <input
                {...props}
                type="checkbox"
                checked={Boolean(checked)}
                disabled={!editable}
                onChange={() => undefined}
              />
            );
          },
        }}
      >
        {resolved}
      </ReactMarkdown>
    </article>
  );
}
const MemoizedMarkdownPreview = React.memo(MarkdownPreview);

function PreviewCodeBlock({
  children,
  ...props
}: React.ComponentPropsWithoutRef<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copyCode = async () => {
    const code = preRef.current?.querySelector("code")?.textContent;
    if (code === null || code === undefined) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  const buttonLabel =
    copyStatus === "copied"
      ? "Code copied"
      : copyStatus === "failed"
        ? "Could not copy code"
        : "Copy code";
  const buttonText =
    copyStatus === "copied"
      ? "Copied"
      : copyStatus === "failed"
        ? "Copy failed"
        : "Copy";

  return (
    <div className="preview-code-block">
      <pre ref={preRef} {...props}>{children}</pre>
      <button
        type="button"
        className="preview-code-copy"
        aria-label={buttonLabel}
        onClick={() => void copyCode()}
      >
        {buttonText}
      </button>
    </div>
  );
}

function normalizeCodeLanguages() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "code" && node.lang)
        node.lang = node.lang.toLowerCase();
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
function annotateTaskIndexes() {
  return (tree: MarkdownNode) => {
    let index = 0;
    const visit = (node: MarkdownNode) => {
      if (
        node.type === "listItem" &&
        node.checked !== null &&
        node.checked !== undefined
      ) {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, "data-task-index": index },
        };
        index += 1;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
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
  App,
  CascadingNoteOptions,
  captureMarkdownEdit,
  ConflictDialog,
  createRefreshCoordinator,
  FolderNoteTree,
  FolderTree,
  MarkdownPreview,
  QuickCaptureDialog,
  SettingsDialog,
  TableEditorDialog,
  activeOutlineAncestors,
  activeOutlineIndexAtScroll,
  annotateTaskIndexes,
  extractOutlineItems,
  normalizeCodeLanguages,
  noteListVirtualizationThreshold,
  outlineTree,
  scrollProgress,
  scrollOutlineTargetIntoPreview,
  scrollTopForProgress,
  shouldVirtualizeNoteList,
  syncScrollPosition,
  virtualNoteRowHeight,
};
const isCaptureWindow = (() => {
  try {
    return getCurrentWindow().label === "capture";
  } catch {
    return false;
  }
})();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isCaptureWindow ? <CaptureWindow /> : <App />}
  </React.StrictMode>,
);

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
import { shouldSuppressWebviewContextMenu } from "./context-menu";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { listen } from "@tauri-apps/api/event";
import { EditorView } from "@codemirror/view";
import {
  insertImage,
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "../MarkdownEditor";
import type { ImportedImageResponse, NoteDocument, NoteSummary } from "./types";
import {
  NoteListItem,
  QuickSwitcher,
  ResizableSplit,
  ViewModeControl,
} from "../components";
import { isModalOpen } from "../components/Modal";
import {
  captureSuccessDelayMs,
  useCancelableDelay,
} from "../features/capture/CaptureComposer";
import { LibraryNavigation } from "../features/library/LibraryNavigation";
import { NoteList } from "../features/library/NoteList";
import { useLibrarySearch } from "../features/search/useLibrarySearch";
import {
  createUpdateController,
  shouldRunAutomaticUpdateCheck,
  updateLastCheckedKey,
  type UpdateControllerState,
} from "../features/updater/update-controller";
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
import {
  SettingsDialog,
  type Shortcuts,
} from "../features/settings/SettingsDialog";
import {
  expandTemplate,
  TemplateEditorDialog,
  todayTitle,
  type NoteTemplate,
} from "../features/templates/TemplateEditorDialog";
import {
  loadPalette,
  paletteStorageKey,
  type Palette,
} from "../theme-palettes";
import {
  applyAppearance,
  loadTheme,
  storeAppearance,
  themeStorageKey,
  type Theme,
} from "../appearance";
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
import {
  ColumnResizeHandle,
  ConflictDialog,
  FailedSaveDialog,
  FolderDialog,
  ImportDailyNoteDialog,
  NoteContextMenu,
  OpenedMarkdownDialog,
  QuickCaptureDialog,
  UpdateDialog,
} from "./dialogs";
import {
  dailyTemplate,
  defaultShortcuts,
  loadFavorites,
  loadPaneWidth,
  loadShortcuts,
  loadTemplates,
  storageKeys,
  usePersistedPreference,
} from "./preferences";
import { createRefreshCoordinator } from "./refresh-coordinator";

type Filter = {
  type: "all" | "today" | "favorites" | "trash" | "folder";
  folder?: string;
};
type ViewMode = "edit" | "preview" | "split";
type FailedSaveRecovery = {
  draft: NoteDocument;
  libraryPath: string;
  message: string;
};

function normalizedFilePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function pathIsInLibrary(path: string, library: string) {
  const file = normalizedFilePath(path);
  const root = normalizedFilePath(library);
  return file === root || file.startsWith(`${root}/`);
}
/** True for `folder` itself and every folder nested inside it. */
function inFolder(candidate: string, folder: string) {
  return candidate === folder || candidate.startsWith(`${folder}/`);
}
/** Daily imports are only accepted from the library's top-level Daily folder. */
function isDailyFolder(folder: string) {
  return inFolder(folder, "Daily");
}

export function App() {
  const quickCaptureSession = useRef(0);
  useEffect(
    () => () => {
      quickCaptureSession.current += 1;
    },
    [],
  );
  const {
    cancel: cancelQuickCaptureClose,
    schedule: scheduleQuickCaptureClose,
  } = useCancelableDelay();
  const [library, setLibrary] = useState<string | null>(null);
  const [libraryInitialized, setLibraryInitialized] = useState(false);
  const [libraryPaneWidth, setLibraryPaneWidth] = useState(() =>
    loadPaneWidth(storageKeys.libraryPaneWidth, 232),
  );
  const [notePaneWidth, setNotePaneWidth] = useState(() =>
    loadPaneWidth(storageKeys.notePaneWidth, 296),
  );
  const [outlinePaneWidth, setOutlinePaneWidth] = useState(() =>
    loadPaneWidth(storageKeys.outlinePaneWidth, 280),
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
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [failedSaveRecoveries, setFailedSaveRecoveries] = useState<
    Map<string, FailedSaveRecovery>
  >(() => new Map());
  const [filter, setFilter] = useState<Filter>({ type: "all" });
  const [query, setQuery] = useState("");
  const [backlinks, setBacklinks] = useState<NoteSummary[]>([]);
  const [mode, setMode] = useState<ViewMode>("preview");
  const [status, setStatus] = useState("");
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
  const [quickCaptureFeedback, setQuickCaptureFeedback] = useState(
    "Adds to today’s Daily note",
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
  const updateController = useMemo(
    () =>
      createUpdateController({
        checkForUpdate: () => check({ timeout: 15000 }),
        relaunchApp: relaunch,
        getStoredValue: (key) => localStorage.getItem(key),
        setStoredValue: (key, value) => localStorage.setItem(key, value),
        now: Date.now,
      }),
    [],
  );
  const [updater, setUpdater] = useState<UpdateControllerState>(() =>
    updateController.getState(),
  );
  const availableUpdate = updater.update;
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const searchScope = useMemo(() => {
    const candidates = filter.type === "trash" ? trashNotes : notes;
    return candidates
      .filter(
        (item) =>
          (filter.type !== "folder" ||
            inFolder(item.folder, filter.folder ?? "")) &&
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
  const [theme, setTheme] = useState<Theme>(() =>
    loadTheme(localStorage.getItem(themeStorageKey)),
  );
  const [palette, setPalette] = useState<Palette>(() =>
    loadPalette(localStorage.getItem(paletteStorageKey)),
  );
  const [shortcuts, setShortcuts] = useState<Shortcuts>(loadShortcuts);
  const [quickImportDefaultPath, setQuickImportDefaultPath] = useState(
    () => localStorage.getItem(storageKeys.quickImportDefault) || "",
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
  const refreshCoordinator = useRef<ReturnType<
    typeof createRefreshCoordinator
  > | null>(null);
  const saveQueues = useRef(new Map<string, Promise<boolean>>());
  const latestSaveDrafts = useRef(new Map<string, NoteDocument>());
  const failedSaveRecoveriesRef = useRef(new Map<string, FailedSaveRecovery>());
  const enqueueSaveRef = useRef<(draft: NoteDocument) => Promise<boolean>>(
    async () => false,
  );
  const lastReportedDirty = useRef<boolean | null>(null);
  const latestQuitRequestId = useRef(0);
  const activeQuitRequestId = useRef<number | null>(null);
  const quitFlushTail = useRef(Promise.resolve());
  const internallyMovedPath = useRef<string | null>(null);
  const registeredCaptureShortcut = useRef(defaultShortcuts.quickCapture);
  const viewScrollRatios = useRef(new Map<string, number>());
  const setFailedSaveRecovery = useCallback(
    (queueKey: string, recovery: FailedSaveRecovery | null) => {
      const next = new Map(failedSaveRecoveriesRef.current);
      if (recovery) next.set(queueKey, recovery);
      else next.delete(queueKey);
      failedSaveRecoveriesRef.current = next;
      setFailedSaveRecoveries(next);
    },
    [],
  );
  const queueKeyForPath = useCallback((path: string) => {
    const aliasedPath = savedPathAliases.current.get(path) ?? path;
    return (
      saveQueueKeys.current.get(path) ??
      saveQueueKeys.current.get(aliasedPath) ??
      aliasedPath
    );
  }, []);
  const rememberLatestDraft = useCallback(
    (draft: NoteDocument) => {
      const ownedDraft = { ...draft, tags: [...draft.tags] };
      latestSaveDrafts.current.set(
        queueKeyForPath(ownedDraft.path),
        ownedDraft,
      );
      return ownedDraft;
    },
    [queueKeyForPath],
  );
  const retireOwnedDraft = useCallback(
    (queueKey: string, candidate: NoteDocument) => {
      if (latestSaveDrafts.current.get(queueKey) !== candidate) return false;
      latestSaveDrafts.current.delete(queueKey);

      const retiredPaths = new Set<string>();
      for (const [path, mappedQueueKey] of saveQueueKeys.current) {
        if (mappedQueueKey !== queueKey) continue;
        retiredPaths.add(path);
        saveQueueKeys.current.delete(path);
      }
      for (const [path, savedPath] of savedPathAliases.current) {
        if (!retiredPaths.has(path) && !retiredPaths.has(savedPath)) continue;
        savedPathAliases.current.delete(path);
      }
      return true;
    },
    [],
  );
  /** Resolves a draft to its latest saved path and the baseline stored there. */
  const savedStateFor = useCallback((draft: NoteDocument) => {
    const path = savedPathAliases.current.get(draft.path) ?? draft.path;
    const savedBaseline =
      noteBaselines.current.get(path) ??
      noteBaselines.current.get(draft.path) ??
      null;
    return { path, baseline: savedBaseline };
  }, []);
  const draftIsUnsaved = useCallback(
    (draft: NoteDocument) => {
      const saved = savedStateFor(draft);
      return hasUnsavedChanges({ ...draft, path: saved.path }, saved.baseline);
    },
    [savedStateFor],
  );
  /**
   * Every user navigation goes through here so the outgoing note's pending
   * edits are queued for saving before its autosave timer is torn down.
   */
  const openNotePath = useCallback(
    (path: string) => {
      const currentNote = noteRef.current;
      if (currentNote && draftIsUnsaved(currentNote))
        void enqueueSaveRef.current(currentNote);
      setActivePath(path);
    },
    [draftIsUnsaved],
  );
  /** Applies an edit to the active note as the newest owned draft. */
  const applyEdit = useCallback(
    (notePath: string, edit: (current: NoteDocument) => NoteDocument) => {
      const current = noteRef.current;
      if (current?.path !== notePath) return;
      const draft = rememberLatestDraft(edit(current));
      noteRef.current = draft;
      dispatchNoteSession({ type: "edited", draft });
    },
    [rememberLatestDraft],
  );

  const refresh = useCallback(
    (path?: string | null, force = path === undefined) => {
      const requestPath = path ?? libraryRef.current;
      if (!requestPath) return Promise.resolve();
      if (!refreshCoordinator.current) {
        refreshCoordinator.current = createRefreshCoordinator(
          async (request) => {
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
              // Counts already live in the sidebar and list header; keep the note
              // header status free for save and file messages.
              setStatus((current) =>
                current.startsWith("Could not read library") ? "" : current,
              );
            } catch (error) {
              if (
                generation === refreshGeneration.current &&
                libraryRef.current === request.path
              )
                setStatus(`Could not read library: ${String(error)}`);
            }
          },
        );
      }
      return refreshCoordinator.current({ path: requestPath, force });
    },
    [],
  );
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
  const setViewMode = (next: ViewMode) => {
    if (next === mode) return;
    rememberWorkspaceScroll();
    setMode(next);
  };
  useEffect(() => updateController.subscribe(setUpdater), [updateController]);
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
      void native
        .findBacklinks(library, note.path, note.title)
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
      shouldRunAutomaticUpdateCheck(
        localStorage.getItem(updateLastCheckedKey),
        Date.now(),
      )
    )
      void updateController.check("automatic");
  }, [updateController]);
  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);
  useEffect(() => {
    const appearance = { theme, palette };
    applyAppearance(appearance);
    storeAppearance(appearance);
  }, [palette, theme]);
  usePersistedPreference(storageKeys.favorites, favorites);
  usePersistedPreference(storageKeys.shortcuts, shortcuts);
  usePersistedPreference(
    storageKeys.quickImportDefault,
    quickImportDefaultPath,
  );
  usePersistedPreference(storageKeys.templates, templates);
  usePersistedPreference(storageKeys.libraryPaneWidth, libraryPaneWidth);
  usePersistedPreference(storageKeys.notePaneWidth, notePaneWidth);
  usePersistedPreference(storageKeys.outlinePaneWidth, outlinePaneWidth);
  const showQuickCapture = () => {
    void native.showQuickCapture().catch(() => {
      quickCaptureSession.current += 1;
      cancelQuickCaptureClose();
      setQuickCaptureFeedback("Adds to today’s Daily note");
      setQuickCaptureOpen(true);
    });
  };
  const closeQuickCapture = () => {
    quickCaptureSession.current += 1;
    cancelQuickCaptureClose();
    setQuickCaptureOpen(false);
  };
  useEffect(() => {
    let disposed = false;
    const requested = shortcuts.quickCapture;
    void native
      .configureQuickCaptureShortcut(nativeShortcut(requested))
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
    void native
      .loadSelectedLibrary()
      .then(async (selected) => {
        if (disposed) return;
        if (selected) {
          setLibrary(selected);
          return;
        }
        const legacyLibrary = localStorage.getItem(storageKeys.legacyLibrary);
        if (legacyLibrary) {
          await native
            .saveSelectedLibrary(legacyLibrary)
            .catch(() => undefined);
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
        openNotePath(path);
        setStatus("Opened Markdown file");
      } else {
        setOpenedMarkdownPath(path);
      }
    },
    [library, libraryInitialized, openNotePath],
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
    const suppressWebviewMenu = (event: MouseEvent) => {
      if (shouldSuppressWebviewContextMenu(event.target))
        event.preventDefault();
    };
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
        const queueKey = queueKeyForPath(loaded.path);
        const ownedDraft = latestSaveDrafts.current.get(queueKey);
        const pendingOwnedDraft = Boolean(
          ownedDraft &&
          (saveQueues.current.has(queueKey) ||
            failedSaveRecoveriesRef.current.has(queueKey) ||
            hasUnsavedChanges(ownedDraft, loaded)),
        );
        const restoredDraft =
          pendingOwnedDraft && ownedDraft
            ? {
                ...ownedDraft,
                path: loaded.path,
                revision: loaded.revision,
                updated: loaded.updated,
                created: loaded.created,
                updated_at: loaded.updated_at,
              }
            : null;
        if (restoredDraft)
          latestSaveDrafts.current.set(queueKey, restoredDraft);
        dispatchNoteSession({
          type: "loadSucceeded",
          note: restoredDraft ?? loaded,
        });
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
  }, [activePath, queueKeyForPath]);
  useEffect(() => {
    if (!note || !hasUnsavedChanges(note, baseline.current)) return;
    const timer = window.setTimeout(() => void enqueueSave(note), 700);
    return () => window.clearTimeout(timer);
  }, [note?.path, note?.body, note?.title, note?.tags.join("\0")]);
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
            libraryPath: library,
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
      // Dialogs own the keyboard while open; app shortcuts must not act
      // behind them (for example creating a note under Settings).
      if (event.defaultPrevented || isModalOpen()) return;
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
  /** Lists a folder's notes and expands its ancestors in the sidebar. */
  const showFolder = (folder: string) => {
    if (!folder) {
      setFilter({ type: "all" });
      return;
    }
    setFilter({ type: "folder", folder });
    setCollapsedFolders((current) =>
      current.filter((value) => !inFolder(folder, value)),
    );
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
      openNotePath(imported.path);
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
      const currentNote = noteRef.current;
      if (
        currentNote &&
        pathIsInLibrary(currentNote.path, library) &&
        hasUnsavedChanges(currentNote, baseline.current) &&
        !(await enqueueSaveRef.current(currentNote))
      )
        return;
      const created = await native.createNote(library, folder);
      let saved = created;
      if (body) {
        const result = await native.saveNote({ ...created, body }, library);
        if (result.status === "saved") saved = result.note;
        else if (result.status === "conflict")
          throw new Error(
            "The new note changed on disk before it could be saved",
          );
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
      openNotePath(existing.path);
      return;
    }
    await createNote("Daily", expandTemplate(dailyTemplate(templates), title));
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
  const saveNote = async (
    draft: NoteDocument,
    queueKey: string,
    saveLibrary: string | null,
  ) => {
    if (!saveLibrary || !pathIsInLibrary(draft.path, saveLibrary)) return true;
    const originalPath = draft.path;
    const { path: previousPath, baseline: currentBaseline } =
      savedStateFor(draft);
    const noteToSave = {
      ...draft,
      path: previousPath,
      revision:
        currentBaseline?.path === previousPath
          ? currentBaseline.revision
          : draft.revision,
    };
    if (!hasUnsavedChanges(noteToSave, currentBaseline)) {
      setFailedSaveRecovery(queueKey, null);
      return true;
    }
    try {
      const saveBelongsToActiveNote = () =>
        activePathRef.current === previousPath ||
        activePathRef.current === originalPath;
      const startedActive = saveBelongsToActiveNote();
      if (startedActive) {
        dispatchNoteSession({ type: "saveRequested" });
        setStatus("Saving…");
      }
      const result = await native.saveNote(noteToSave, saveLibrary);
      const isStillActive = saveBelongsToActiveNote();
      if (result.status === "conflict") {
        setFailedSaveRecovery(queueKey, null);
        dispatchNoteSession({
          type: "saveConflicted",
          disk: result.disk,
          mine: latestSaveDrafts.current.get(queueKey) ?? noteToSave,
          path: previousPath,
          libraryPath: saveLibrary,
        });
        if (isStillActive) setStatus("Save conflict: the note changed on disk");
        return false;
      }
      if (result.status === "error") {
        const recoveryDraft =
          latestSaveDrafts.current.get(queueKey) ??
          (isStillActive && noteRef.current?.path === originalPath
            ? noteRef.current
            : noteToSave);
        setFailedSaveRecovery(queueKey, {
          draft: recoveryDraft,
          libraryPath: saveLibrary,
          message: result.message,
        });
        if (isStillActive) {
          dispatchNoteSession({
            type: "saveFailed",
            message: result.message,
          });
          setStatus(`Save failed: ${result.message}`);
        }
        return false;
      }
      const saved = result.note;
      setFailedSaveRecovery(queueKey, null);
      const pathChanged = saved.path !== previousPath;
      const priorAliases = [...savedPathAliases.current];
      const aliasedPaths = new Set([originalPath, previousPath]);
      let foundEarlierAlias = true;
      while (foundEarlierAlias) {
        foundEarlierAlias = false;
        for (const [path, target] of priorAliases) {
          if (!aliasedPaths.has(target) || aliasedPaths.has(path)) continue;
          aliasedPaths.add(path);
          foundEarlierAlias = true;
        }
      }
      for (const path of aliasedPaths) {
        if (path === saved.path) savedPathAliases.current.delete(path);
        else savedPathAliases.current.set(path, saved.path);
        saveQueueKeys.current.set(path, queueKey);
        if (path !== saved.path) noteBaselines.current.delete(path);
      }
      saveQueueKeys.current.set(saved.path, queueKey);
      noteBaselines.current.set(saved.path, saved);
      const ownedDraft = latestSaveDrafts.current.get(queueKey);
      if (ownedDraft)
        latestSaveDrafts.current.set(queueKey, {
          ...ownedDraft,
          path: saved.path,
          revision: saved.revision,
          updated: saved.updated,
          created: saved.created,
          updated_at: saved.updated_at,
        });
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
      return true;
    } catch (error) {
      const recoveryDraft =
        latestSaveDrafts.current.get(queueKey) ??
        (noteRef.current?.path === originalPath ? noteRef.current : noteToSave);
      setFailedSaveRecovery(queueKey, {
        draft: recoveryDraft,
        libraryPath: saveLibrary,
        message: String(error),
      });
      if (activePathRef.current === draft.path) {
        dispatchNoteSession({
          type: "saveFailed",
          message: String(error),
        });
        setStatus(`Save failed: ${String(error)}`);
      }
      return false;
    }
  };
  const enqueueSave = (
    draft: NoteDocument,
    saveLibrary = libraryRef.current,
  ) => {
    const queuedDraft = rememberLatestDraft(draft);
    const queueKey = queueKeyForPath(queuedDraft.path);
    const previous = saveQueues.current.get(queueKey) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async (previousSaved) => {
        // Already-queued work must not silently retry a failed save or conflict.
        if (previousSaved === false) return false;
        if (!saveLibrary || !pathIsInLibrary(queuedDraft.path, saveLibrary)) {
          retireOwnedDraft(queueKey, queuedDraft);
          return true;
        }
        // An earlier queue entry may already have saved the newest draft and
        // retired its aliases. Never replay that entry's captured old path.
        let nextDraft = latestSaveDrafts.current.get(queueKey);
        if (!nextDraft) return true;
        while (true) {
          if (!(await saveNote(nextDraft, queueKey, saveLibrary))) return false;
          const latestDraft = latestSaveDrafts.current.get(queueKey);
          if (!latestDraft) return true;
          if (!draftIsUnsaved(latestDraft)) {
            retireOwnedDraft(queueKey, latestDraft);
            return true;
          }
          nextDraft = { ...latestDraft, tags: [...latestDraft.tags] };
        }
      });
    setPendingSaveCount((count) => count + 1);
    saveQueues.current.set(queueKey, queued);
    void queued.finally(() => {
      if (saveQueues.current.get(queueKey) === queued)
        saveQueues.current.delete(queueKey);
      setPendingSaveCount((count) => Math.max(0, count - 1));
    });
    return queued;
  };
  enqueueSaveRef.current = enqueueSave;
  const duplicateNote = async (source: Pick<NoteSummary, "path">) => {
    if (!library) return;
    try {
      const copy = await native.duplicateNote(source.path, library);
      await refresh();
      openNotePath(copy.path);
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
    if (!library || !confirm(`Move “${source.title}” to this library’s trash?`))
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
    const contained = notes.filter((item) => inFolder(item.folder, folder));
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
      if (filter.type === "folder" && inFolder(filter.folder ?? "", folder))
        setFilter({ type: "all" });
      setCollapsedFolders((current) =>
        current.filter((value) => !inFolder(value, folder)),
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
      openNotePath(restored.path);
      setFilter({ type: "all" });
    } catch (error) {
      setStatus(`Could not restore note: ${String(error)}`);
    }
  };
  const deleteNotePermanently = async (source: NoteSummary) => {
    if (
      !library ||
      !confirm(`Permanently delete “${source.title}”? This cannot be undone.`)
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
    const session = quickCaptureSession.current;
    if (!library) {
      setQuickCaptureFeedback("Choose your notes folder before saving.");
      await selectLibrary();
      return false;
    }
    let daily: NoteDocument;
    try {
      daily = await native.appendQuickNote(
        library,
        text,
        expandTemplate(dailyTemplate(templates)),
      );
    } catch (error) {
      if (session !== quickCaptureSession.current) return false;
      const failure = `Could not save quick note: ${String(error)}`;
      setQuickCaptureFeedback(failure);
      setStatus(failure);
      return false;
    }
    if (session !== quickCaptureSession.current) return false;
    const savedStatus = `Saved to Daily/${fileStem(daily.path)}.md`;
    setQuickCaptureFeedback(savedStatus);
    setStatus(savedStatus);
    scheduleQuickCaptureClose(() => {
      if (session === quickCaptureSession.current) setQuickCaptureOpen(false);
    }, captureSuccessDelayMs);
    void refresh().catch((error) => {
      if (session === quickCaptureSession.current)
        setStatus(`Could not read library: ${String(error)}`);
    });
    return true;
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
      showFolder(folder);
      openNotePath(saved.path);
      setStatus(`Imported ${note.title} into ${saved.title}`);
    } catch (error) {
      setStatus(`Could not create imported note: ${String(error)}`);
    }
  };
  const openLinkedNote = useCallback(
    (target: NoteSummary) => {
      showFolder(target.folder.trim());
      openNotePath(target.path);
    },
    [openNotePath],
  );
  const listedNotes = filter.type === "trash" ? trashNotes : notes;
  const visibleNotes = useMemo(() => {
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
  }, [favorites, librarySearch.results, listedNotes, query, searchScope]);
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
    () => (outlineOpen && note ? extractOutlineItems(deferredNoteBody) : []),
    [deferredNoteBody, note?.path, outlineOpen],
  );
  const isManagedNote = Boolean(
    note && library && pathIsInLibrary(note.path, library),
  );
  const insertImportedImage = useCallback(
    (notePath: string, image: ImportedImageResponse) => {
      if (noteRef.current?.path !== notePath) {
        setStatus(
          "The image was imported, but the active note changed before it could be inserted.",
        );
        return;
      }
      const view = editor.current?.getView();
      if (!view) {
        setStatus("The image was imported, but the editor is unavailable.");
        return;
      }
      insertImage(view, { markdownPath: image.markdown_path, alt: image.alt });
    },
    [],
  );
  /**
   * Copies an image into the active note's companion folder once any pending
   * save (which may rename the note) has settled, then inserts its link.
   */
  const importImage = useCallback(
    async (
      copyImage: (
        notePath: string,
        libraryPath: string,
      ) => Promise<ImportedImageResponse>,
    ) => {
      const activeManagedNote = () => {
        const activeNote = noteRef.current;
        const activeLibrary = libraryRef.current;
        return activeNote &&
          activeLibrary &&
          pathIsInLibrary(activeNote.path, activeLibrary)
          ? { notePath: activeNote.path, libraryPath: activeLibrary }
          : null;
      };
      const before = activeManagedNote();
      if (!before) return;
      try {
        await (
          saveQueues.current.get(queueKeyForPath(before.notePath)) ??
          Promise.resolve()
        ).catch(() => undefined);
        const target = activeManagedNote();
        if (!target) return;
        insertImportedImage(
          target.notePath,
          await copyImage(target.notePath, target.libraryPath),
        );
      } catch (error) {
        setStatus(`Could not import image: ${String(error)}`);
      }
    },
    [insertImportedImage, queueKeyForPath],
  );
  const importImageFile = useCallback(
    (file: File) => {
      if (file.size > 25 * 1024 * 1024)
        return setStatus("Images must be 25 MB or smaller.");
      void importImage(async (notePath, libraryPath) =>
        native.importNoteImageFromBytes(
          notePath,
          file.name || "pasted-image.png",
          Array.from(new Uint8Array(await file.arrayBuffer())),
          libraryPath,
        ),
      );
    },
    [importImage],
  );
  const chooseImage = useCallback(async () => {
    if (!noteRef.current) return;
    const selected = await open({
      multiple: false,
      title: "Choose an image",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
      ],
    });
    if (typeof selected !== "string") return;
    await importImage((notePath, libraryPath) =>
      native.importNoteImageFromPath(notePath, selected, libraryPath),
    );
  }, [importImage]);
  const noteEditor = note ? (
    <MarkdownEditor
      key={`${note.path}-${isManagedNote ? "managed" : "external"}`}
      ref={editor}
      notePath={note.path}
      value={note.body}
      onChange={(body) => {
        if (!isManagedNote) return;
        applyEdit(note.path, (current) => ({
          ...current,
          body,
          title: titleFromBody(body),
        }));
      }}
      onBlur={() => {
        // Loaded notes keep a baseline across navigation; a successful rename
        // removes only the old path. Ignore that retired editor's blur event.
        if (isManagedNote && noteBaselines.current.has(note.path))
          void enqueueSave(
            noteRef.current?.path === note.path ? noteRef.current : note,
          );
      }}
      onImageFile={isManagedNote ? importImageFile : undefined}
      autoFocus
      readOnly={!isManagedNote}
      className="markdown-editor"
    />
  ) : null;
  const previewMarkdown =
    mode === "split" && deferredNotePath === note?.path
      ? deferredNoteBody
      : (note?.body ?? "");
  const revealOutlineItemInEditor = useCallback((item: OutlineItem) => {
    const view = editor.current?.getView();
    if (!view || item.line === undefined) return;
    const line = view.state.doc.line(
      Math.min(Math.max(1, item.line), view.state.doc.lines),
    );
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, {
        y: "start",
        yMargin: 24,
      }),
    });
    view.focus();
  }, []);
  const togglePreviewTask = useCallback(
    (index: number, checked: boolean) => {
      const current = noteRef.current;
      if (!current) return;
      applyEdit(current.path, (draft) => ({
        ...draft,
        body: toggleTask(draft.body, index, checked),
      }));
    },
    [applyEdit],
  );
  const showPreview = mode !== "edit";
  const notePreview =
    note && showPreview ? (
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
  const activeNoteDirty = Boolean(
    note && hasUnsavedChanges(note, baseline.current),
  );
  const failedSaveRecovery = failedSaveRecoveries.values().next().value;
  useEffect(() => {
    if (!note) return;
    const queueKey = queueKeyForPath(note.path);
    const ownedDraft = latestSaveDrafts.current.get(queueKey);
    if (
      !ownedDraft ||
      saveQueues.current.has(queueKey) ||
      failedSaveRecoveriesRef.current.has(queueKey)
    )
      return;
    const currentPath = savedStateFor(note).path;
    if (
      !draftIsUnsaved(note) &&
      !hasUnsavedChanges(
        {
          ...ownedDraft,
          path:
            savedPathAliases.current.get(ownedDraft.path) ?? ownedDraft.path,
        },
        { ...note, path: currentPath },
      )
    )
      retireOwnedDraft(queueKey, ownedDraft);
  }, [
    draftIsUnsaved,
    failedSaveRecoveries,
    note,
    pendingSaveCount,
    queueKeyForPath,
    retireOwnedDraft,
    savedStateFor,
  ]);
  const nativeDirty =
    activeNoteDirty ||
    pendingSaveCount > 0 ||
    failedSaveRecoveries.size > 0 ||
    Boolean(conflict);
  useEffect(() => {
    if (lastReportedDirty.current === nativeDirty) return;
    lastReportedDirty.current = nativeDirty;
    void native.setDirtyState(nativeDirty).catch(() => {
      if (lastReportedDirty.current === nativeDirty)
        lastReportedDirty.current = null;
    });
  }, [nativeDirty]);
  useEffect(() => {
    let disposed = false;
    let unlistenRequest: (() => void) | undefined;
    let unlistenCancellation: (() => void) | undefined;
    void listen<{ requestId: number }>("margin://request-quit", (event) => {
      const requestId = event.payload.requestId;
      if (
        !Number.isSafeInteger(requestId) ||
        requestId <= 0 ||
        requestId <= latestQuitRequestId.current
      )
        return;
      latestQuitRequestId.current = requestId;
      activeQuitRequestId.current = requestId;
      quitFlushTail.current = quitFlushTail.current
        .catch(() => undefined)
        .then(async () => {
          const requestIsActive = () =>
            !disposed &&
            requestId === latestQuitRequestId.current &&
            requestId === activeQuitRequestId.current;
          if (!requestIsActive()) return;

          let saved = true;
          while (saved && requestIsActive()) {
            const currentNote = noteRef.current;
            const currentLibrary = libraryRef.current;
            if (
              currentNote &&
              currentLibrary &&
              pathIsInLibrary(currentNote.path, currentLibrary) &&
              hasUnsavedChanges(currentNote, baseline.current)
            ) {
              saved = (await enqueueSaveRef.current(currentNote)) && saved;
            }

            while (requestIsActive() && saveQueues.current.size > 0) {
              const pending = [...new Set(saveQueues.current.values())];
              const results = await Promise.all(
                pending.map((queue) => queue.catch(() => false)),
              );
              if (!requestIsActive()) break;
              saved = results.every(Boolean) && saved;
              await Promise.resolve();
            }

            if (!requestIsActive() || !saved) break;
            const latestNote = noteRef.current;
            const latestLibrary = libraryRef.current;
            const latestIsDirty = Boolean(
              latestNote &&
              latestLibrary &&
              pathIsInLibrary(latestNote.path, latestLibrary) &&
              hasUnsavedChanges(latestNote, baseline.current),
            );
            if (!latestIsDirty && saveQueues.current.size === 0) break;
          }

          if (!requestIsActive()) return;
          saved = saved && failedSaveRecoveriesRef.current.size === 0;
          activeQuitRequestId.current = null;
          await native
            .completeQuitRequest(requestId, saved)
            .catch(() => undefined);
        });
    }).then((removeListener) => {
      if (disposed) removeListener();
      else unlistenRequest = removeListener;
    });
    void listen<{ requestId: number }>("margin://cancel-quit", (event) => {
      const requestId = event.payload.requestId;
      if (
        Number.isSafeInteger(requestId) &&
        requestId > 0 &&
        activeQuitRequestId.current === requestId
      )
        activeQuitRequestId.current = null;
    }).then((removeListener) => {
      if (disposed) removeListener();
      else unlistenCancellation = removeListener;
    });
    return () => {
      disposed = true;
      activeQuitRequestId.current = null;
      unlistenRequest?.();
      unlistenCancellation?.();
    };
  }, []);
  const openNote = useCallback(
    (selected: NoteSummary) => openNotePath(selected.path),
    [openNotePath],
  );
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
        x: position.x,
        y: position.y,
        isTrashed: isTrashFilter,
        isDaily: isDailyFolder(selected.folder),
      }),
    [isTrashFilter],
  );
  const renderNote = useCallback(
    (item: NoteSummary) => (
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
    ),
    [
      activeNoteDirty,
      activePath,
      favorites,
      isTrashFilter,
      openNote,
      openNoteContextMenu,
      toggleNoteFavorite,
    ],
  );
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
  const isDailyNote = Boolean(
    note &&
    notes.some((item) => item.path === note.path && isDailyFolder(item.folder)),
  );
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
          <svg
            className="top-search-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.75" />
            <path d="m10.5 10.5 3.25 3.25" />
          </svg>
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
              onClick={() => updateController.openDialog()}
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
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" />
              <path d="M16.1 12.2a1.3 1.3 0 0 0 .26 1.43l.05.05a1.58 1.58 0 1 1-2.23 2.23l-.05-.05a1.3 1.3 0 0 0-1.43-.26 1.3 1.3 0 0 0-.79 1.19v.14a1.58 1.58 0 0 1-3.16 0v-.07a1.3 1.3 0 0 0-.85-1.19 1.3 1.3 0 0 0-1.43.26l-.05.05a1.58 1.58 0 1 1-2.23-2.23l.05-.05a1.3 1.3 0 0 0 .26-1.43 1.3 1.3 0 0 0-1.19-.79h-.14a1.58 1.58 0 0 1 0-3.16h.07a1.3 1.3 0 0 0 1.19-.85 1.3 1.3 0 0 0-.26-1.43l-.05-.05a1.58 1.58 0 1 1 2.23-2.23l.05.05a1.3 1.3 0 0 0 1.43.26h.06a1.3 1.3 0 0 0 .79-1.19v-.14a1.58 1.58 0 0 1 3.16 0v.07a1.3 1.3 0 0 0 .79 1.19 1.3 1.3 0 0 0 1.43-.26l.05-.05a1.58 1.58 0 1 1 2.23 2.23l-.05.05a1.3 1.3 0 0 0-.26 1.43v.06a1.3 1.3 0 0 0 1.19.79h.14a1.58 1.58 0 0 1 0 3.16h-.07a1.3 1.3 0 0 0-1.19.79Z" />
            </svg>
          </button>
        </div>
      </header>
      <LibraryNavigation
        filter={filter.type}
        selectedFolder={filter.type === "folder" ? filter.folder : undefined}
        noteCount={notes.length}
        favoriteCount={
          favorites.filter((path) => notes.some((note) => note.path === path))
            .length
        }
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
        min={180}
        max={420}
        onChange={resizeLibraryPane}
        label="Resize library sidebar"
      />
      <ColumnResizeHandle
        className="note-pane-resizer"
        value={notePaneWidth}
        min={220}
        max={520}
        onChange={resizeNotePane}
        label="Resize note list"
      />
      <NoteList
        title={listTitle}
        notes={visibleNotes}
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
                {mode !== "preview" && (
                  <div
                    className="editor-tools"
                    role="toolbar"
                    aria-label="Editor tools"
                  >
                    <button
                      className="insert-table"
                      type="button"
                      title="Insert a table"
                      onClick={() => setTableDialogOpen(true)}
                    >
                      Table
                    </button>
                    {isManagedNote && (
                      <button
                        className="insert-image"
                        type="button"
                        title="Insert an image"
                        onClick={() => void chooseImage()}
                      >
                        Image
                      </button>
                    )}
                  </div>
                )}
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
                    minLeftWidth={240}
                    minRightWidth={260}
                    persistenceKey={storageKeys.splitRatio}
                  />
                )}
              </div>
              {outlineOpen && (
                <>
                  <ColumnResizeHandle
                    className="outline-pane-resizer"
                    value={outlinePaneWidth}
                    min={220}
                    max={520}
                    onChange={resizeOutlinePane}
                    label="Resize outline"
                    direction={-1}
                  />
                  <Outline
                    items={outlineItems}
                    dirty={hasUnsavedChanges(note, baseline.current)}
                    width={outlinePaneWidth}
                    onClose={() => setOutlineOpen(false)}
                    onNavigate={revealOutlineItemInEditor}
                  />
                </>
              )}
            </div>
            {backlinks.length > 0 && (
              <aside className="backlinks">
                <strong>Linked from</strong>
                {backlinks.map((item) => (
                  <button key={item.path} onClick={() => openNote(item)}>
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
            setQuickOpen(false);
            openNote(selected);
          }}
        />
      )}
      {quickCaptureOpen && (
        <QuickCaptureDialog
          session={quickCaptureSession.current}
          shortcut={formatShortcut(shortcuts.quickCapture)}
          status={quickCaptureFeedback}
          onClose={closeQuickCapture}
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
            openNotePath(openedMarkdownPath);
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
            // Split already shows the editor; only Preview needs to switch.
            if (mode === "preview") setViewMode("edit");
            window.setTimeout(() => {
              editor.current?.insertTable(rows, columns);
              editor.current?.focus();
            }, 0);
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
              applyEdit(note.path, (current) => ({
                ...current,
                body: replaceMarkdownTable(
                  current.body,
                  tableEditorIndex,
                  headers,
                  rows,
                ),
              }));
              setTableEditorIndex(null);
            }}
          />
        )}
      {folderDialogOpen && (
        <FolderDialog
          onClose={() => setFolderDialogOpen(false)}
          onSubmit={(name) =>
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
          onSubmit={(name) => void renameFolder(folderRenameTarget, name)}
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
            (item) => item.path !== note.path && !isDailyFolder(item.folder),
          )}
          folders={folders.filter((folder) => !isDailyFolder(folder))}
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
            (item) => !isDailyFolder(item.folder),
          )}
          quickImportDefaultPath={quickImportDefaultPath}
          onQuickImportDefaultPath={setQuickImportDefaultPath}
          onManageTemplates={() => setTemplateEditorOpen(true)}
          updateState={updater.phase}
          updateMessage={updater.message}
          onCheckForUpdates={() => void updateController.check("manual")}
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
      {updater.dialogOpen && availableUpdate && (
        <UpdateDialog
          update={availableUpdate}
          state={updater.phase}
          error={updater.message}
          onClose={() => updateController.closeDialog()}
          onInstall={() => void updateController.install()}
          onRestart={() => void updateController.restart()}
          onSkip={() => updateController.skip()}
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
            openNote(selected);
            setImportDialogOpen(true);
          }}
        />
      )}
      {failedSaveRecovery && (
        <FailedSaveDialog
          title={failedSaveRecovery.draft.title}
          message={failedSaveRecovery.message}
          onRetry={() =>
            void enqueueSave(
              failedSaveRecovery.draft,
              failedSaveRecovery.libraryPath,
            )
          }
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
              const queueKey = queueKeyForPath(conflict.path);
              const ownedDraft = latestSaveDrafts.current.get(queueKey);
              setFailedSaveRecovery(queueKey, null);
              if (ownedDraft) retireOwnedDraft(queueKey, ownedDraft);
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
              void enqueueSave(
                conflict.mine,
                conflict.libraryPath ?? libraryRef.current,
              );
            }
          }}
        />
      )}
    </main>
  );
}

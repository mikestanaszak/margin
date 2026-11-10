import { useEffect } from "react";
import { isMac } from "../platform";
import { clamp } from "../note-utils";
import type { NoteTemplate } from "../features/templates/TemplateEditorDialog";
import type { Shortcuts } from "../features/settings/SettingsDialog";

// Storage keys predate the Margin name; keep them so existing preferences load.
export const storageKeys = {
  legacyLibrary: "markdown-notes.library-path",
  favorites: "markdown-notes.pinned",
  shortcuts: "markdown-notes.shortcuts",
  quickImportDefault: "markdown-notes.quick-import-default",
  templates: "margin.templates",
  libraryPaneWidth: "markdown-notes.library-pane-width",
  notePaneWidth: "markdown-notes.note-pane-width",
  outlinePaneWidth: "markdown-notes.outline-pane-width",
  splitRatio: "markdown-notes.split-ratio",
} as const;

export const defaultShortcuts: Shortcuts = {
  newNote: isMac ? "meta+n" : "ctrl+n",
  search: isMac ? "meta+k" : "ctrl+k",
  switcher: isMac ? "meta+p" : "ctrl+p",
  save: isMac ? "meta+s" : "ctrl+s",
  view: isMac ? "meta+e" : "ctrl+e",
  sidebar: isMac ? "meta+shift+b" : "ctrl+shift+b",
  outline: isMac ? "meta+shift+o" : "ctrl+shift+o",
  quickCapture: isMac ? "meta+alt+shift+space" : "ctrl+alt+shift+space",
};
const legacySidebarShortcuts = isMac
  ? ["meta+\\", "meta+alt+b"]
  : ["ctrl+\\", "ctrl+alt+b"];

export const defaultTemplates: NoteTemplate[] = [
  {
    id: "daily",
    name: "Daily note",
    body: "# {{date}}\n\n## Priorities\n\n- [ ] \n\n## Notes\n\n",
  },
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadShortcuts(): Shortcuts {
  const saved = readJson<Partial<Shortcuts>>(storageKeys.shortcuts, {});
  return {
    ...defaultShortcuts,
    ...saved,
    sidebar:
      !saved.sidebar || legacySidebarShortcuts.includes(saved.sidebar)
        ? defaultShortcuts.sidebar
        : saved.sidebar,
  };
}

export function loadTemplates(): NoteTemplate[] {
  const saved = readJson<NoteTemplate[]>(storageKeys.templates, []);
  return Array.isArray(saved) && saved.length ? saved : defaultTemplates;
}

export function loadFavorites(): string[] {
  const saved = readJson<unknown>(storageKeys.favorites, []);
  return Array.isArray(saved)
    ? saved.filter((path): path is string => typeof path === "string")
    : [];
}

export function loadPaneWidth(key: string, fallback: number) {
  const value = localStorage.getItem(key);
  if (!value?.trim()) return fallback;
  const saved = Number(value);
  return Number.isFinite(saved) ? clamp(saved, 180, 520) : fallback;
}

/** The Daily template powers Today and Quick Capture. */
export function dailyTemplate(templates: NoteTemplate[]) {
  return (
    templates.find((item) => item.id === "daily") ||
    templates[0] ||
    defaultTemplates[0]
  );
}

/** Writes a preference whenever it changes. */
export function usePersistedPreference(key: string, value: unknown) {
  useEffect(() => {
    try {
      localStorage.setItem(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    } catch {
      // Preferences are conveniences; the app keeps working without storage.
    }
  }, [key, value]);
}

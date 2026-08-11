import React, { useEffect, type KeyboardEvent } from "react";
import "./settings.css";
import { all as highlightLanguages } from "lowlight";
import type { NoteSummary } from "../../app/types";
import { formatShortcut, normalizedKey } from "../../note-utils";
import { paletteOptions, type Palette } from "../../theme-palettes";
import { CascadingNoteOptions } from "../library/LibraryNavigation";

export type ShortcutId = "newNote" | "search" | "switcher" | "save" | "view" | "sidebar" | "outline" | "quickCapture";
export type Shortcuts = Record<ShortcutId, string>;
export type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "restarting" | "error";

export const shortcutLabels: Record<ShortcutId, string> = {
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

export function SettingsDialog({
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

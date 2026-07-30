# Margin — Product Specification

## Product summary

Margin is a local-first desktop workspace for Markdown notes on macOS, Windows, and Linux. A library is an ordinary folder of UTF-8 `.md` files; there is no account, cloud service, or proprietary note database.

Margin is built with Tauri 2, React, TypeScript, and Rust. The interface handles writing and navigation while the native layer reads and safely writes only inside the library the user selects.

## Product principles

- **Files first.** Notes stay useful in Finder, Explorer, and other Markdown tools.
- **Calm by default.** The reading surface should be quiet, clear, and quick to navigate.
- **Markdown without friction.** Preview makes common Markdown pleasant to read; helpers make tables, tasks, code, and links easier to use.
- **Local and safe.** Core work is offline. Autosave and external-change handling must not silently discard content.
- **Native where it matters.** Keyboard shortcuts, file selection, quick capture, and updates should feel at home on each platform.

## Current experience

### Libraries and files

- A user chooses a local folder as a library. Margin recursively discovers Markdown files and watches for external changes.
- Folders are the primary organization system. The sidebar includes **All notes**, **Favorites**, **Trash**, and a collapsible folder tree.
- The first level-one heading is the note title. Saving keeps the filename aligned with that title, disambiguating duplicates safely.
- New notes, folders, note moves, duplication, rename, trash, folder trash, restore, and permanent deletion all operate on normal filesystem objects within the chosen library.

### Reading and writing

- Preview is the default mode. **Cmd/Ctrl+E** switches between Preview and Edit; Split view shows both together.
- Preview supports GitHub-flavored Markdown: headings, links, images, task lists, tables, blockquotes, and syntax-highlighted code blocks.
- Task checkboxes are interactive in Preview and write their completion state back to Markdown without changing layout.
- Tables have an editor for cell content, adding or removing rows and columns, and reordering rows or columns.
- Internal Markdown links and wiki links open the target note and reveal its deepest containing folder. The outline panel exposes headings only and follows heading hierarchy.
- Autosave preserves the current editor selection and scroll position. Opening a note does not alter its last-edited indicator.

### Navigation and customization

- Top navigation provides search and Settings. The note toolbar is limited to **Edit**, **Split**, **Preview**, and **Import**.
- Sidebars are resizable. Note cards provide a favorite control and a context menu for duplicate and move-to-trash actions.
- Light, dark, and system appearance are available; system is the default.
- Settings includes the library location, quick-capture import default, configurable hotkeys, and supported code-block language names.

### Quick capture

- A native global shortcut opens a small, focused capture window on the active desktop: **Cmd+Option+Shift+Space** on macOS and **Ctrl+Alt+Shift+Space** elsewhere by default.
- Escape or Cancel dismisses the window. Cmd/Ctrl+Enter saves a capture into the library’s daily note.
- Daily captures can later be imported into a configured default note, any existing note, or a separate note in any folder.

### Updates and privacy

- Margin checks for signed application updates once a day and presents an unobtrusive Settings badge when one is available.
- The updater verifies signed artifacts before installation. Release signing keys remain outside the repository and are supplied only through CI secrets.
- Margin does not require network access to create, index, search, or edit notes. It has no telemetry.

## Keyboard shortcuts

The primary modifier is Command on macOS and Control on Windows/Linux. Defaults include New Note, Save, Search, Quick Switcher, Edit/Preview, sidebar toggle, outline toggle, and Quick Capture. Users can review and customize them in Settings; global shortcut conflicts are reported without unregistering the previously working binding.

## Quality bar

- Notes never leave the user-selected library unless the user explicitly copies them.
- File writes are safe and failures are clearly reported.
- External edits refresh the index; conflicting unsaved changes require a user decision.
- The desktop app suppresses browser-style context menus in its capture window and uses native window behavior where available.
- The interface remains keyboard-accessible, with visible focus behavior and system-aware color choices.

## Near-term roadmap

- Publish signed Windows and macOS installers for each release, then add Linux packages.
- Add automated coverage around file operations, preview interaction, and quick-capture flows.
- Add templates and daily-note creation options.
- Explore optional Git-aware library status and a version-history workflow without compromising file ownership.
- Improve import paths from popular Markdown exports while keeping the output ordinary Markdown.

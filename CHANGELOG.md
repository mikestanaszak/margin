# Changelog

All notable user-facing changes to Margin are documented here.

## 0.3.1 — 2026-08-01

### Fixed

- Installed Windows builds no longer open a background Command Prompt window.

## 0.3.0 — 2026-08-01

### Improved

- Large libraries and long notes stay responsive: note lists virtualize when needed, previews and backlinks avoid unnecessary work while typing, and outlines are calculated only when shown.
- Libraries now use a native index with filesystem watching, lightweight reconciliation, native search, and native backlinks.
- Renaming a managed note repairs unambiguous relative links to it, including `.md` and `.markdown` links, with recovery-safe rollback if an update fails.

### Fixed

- Hardened library boundaries across file operations with canonical relative IDs, containment checks, and a policy that rejects in-library symlinks.
- System-opened Markdown files are read-only until imported into a Margin library.
- Added portable filename validation for Unicode normalization, reserved Windows names, control characters, byte length, and case-only renames.
- Added a restrictive desktop content security policy while preserving Markdown image previews.

## 0.2.1 — 2026-08-01

### Fixed

- Autosave now detects an external edit before writing and presents a conflict instead of silently overwriting it.
- Note loading, queued saves, library refreshes, and system-opened Markdown files now remain scoped to the correct note and selected library.
- Fixed corrupted symbols in the app interface.
- Libraries now index both `.md` and `.markdown` files.

### Improved

- Library refreshes use one guarded snapshot request and skip Margin's internal storage.

## 0.2.0 — 2026-08-01

### Added

- Daily Notes with a Today view and an editable Daily note template.
- Template editor for reusable Markdown notes, with live preview and `{{date}}` / `{{time}}` variables.
- Linux packages: AppImage and Debian / Ubuntu `.deb` downloads.
- Default Markdown-opener support on Windows and macOS, including safe imports for files outside a Margin library.

### Improved

- Quick Capture applies the Daily template when it creates a new day’s note.
- The library toggle shortcut is now Cmd/Ctrl+Shift+B; existing legacy bindings migrate automatically.
- Today is a focused, selected view rather than an ambiguous jump from All notes.

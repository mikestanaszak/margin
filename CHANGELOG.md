# Changelog

All notable user-facing changes to Margin are documented here.

## 0.5.0 — 2026-08-11

### Added

- Existing YAML front-matter tags now appear as read-only labels on note cards and in Quick Open.
- A tray menu provides Show Margin, Quick Capture, and Quit while Margin continues running in the background.
- Library indexing problems now appear as a concise warning count without preventing healthy notes from loading.

### Improved

- Search and Quick Open now share one native ranked discovery service. Exact and prefix title matches lead filename, path, tag, and body matches; an empty Quick Open shows recently updated notes.
- Linked from now recognizes both resolved relative Markdown links and wiki links while excluding external, anchored, absolute, ambiguous, and unresolved targets.
- The dedicated Quick Capture window and in-app fallback now share the same composer, list continuation, Daily template handling, keyboard behavior, and status feedback.
- Opening another note preserves the current Edit, Split, or Preview mode.
- Quit now waits for pending note saves. A conflict or save failure returns to the main window with the draft and recovery state intact, and an unresponsive save requires explicit confirmation before discarding a draft.

### Fixed

- The full frontend test command now isolates the cold Mermaid renderer from parallel unit tests for deterministic local and CI runs.
- Library scans now keep usable notes available when a directory entry, file, UTF-8 document, or front matter cannot be read safely.

## 0.4.6 — 2026-08-09

### Fixed

- Markdown image previews now decode relative paths exactly once, so companion images with spaces or Unicode characters display correctly on Windows.
- Margin now keeps the same green application icon across every theme and palette.

## 0.4.5 — 2026-08-09

### Fixed

- Markdown image previews now declare a safe startup asset scope for the signed-in user's files, so Windows can load copied note images immediately after Margin opens.

## 0.4.4 — 2026-08-09

### Improved

- Rewrote the README into a practical feature guide, including image storage and cleanup, navigation, linked-from behavior, capture, and customization.
- Duplicated notes now receive their own image companion folder with repaired image paths.

### Fixed

- Reveal in File Explorer now uses the native file-reveal integration so Windows selects the requested note.
- Image previews now build native Windows asset paths instead of mixed slash paths that WebView could not load.
- Removing an image from a note now removes its unreferenced companion file on save and removes the empty companion folder.
- Renaming a note repairs its image paths after moving the companion folder.
- Rebuilt every packaged application icon with a Paper-toned Margin mark, including the Windows shortcut icon.

## 0.4.3 — 2026-08-09

### Fixed

- Image now appears in the persistent top editor bar directly beside Table, not in the floating selection toolbar.
- Pasting copied images now works when the desktop clipboard omits its MIME type and filename. Image drag detection uses the same resilient handling.

## 0.4.2 — 2026-08-09

### Added

- Paper, a warm tan palette with matched light and dark appearances and a runtime icon.
- A README feature tour explaining editor tools, image handling, links and backlinks, navigation, capture, templates, and settings.

### Improved

- Image insertion is beside table insertion in the edit toolbar. Images can now be dropped from desktop file managers or pasted from clipboard image items.
- Companion image folders are hidden from library navigation.
- Code-fence language suggestions now use readable palette-aware text, panel, and selection colors.

### Fixed

- Theme switches update macOS window icons as well as the application icon.
- Mermaid preview coverage no longer runs the heavyweight renderer in the general UI suite, removing the intermittent timeout.

## 0.4.1 — 2026-08-09

### Added

- Images can be selected, dragged into the editor, or pasted. Margin stores a copy in a sibling `.assets` folder and inserts a relative Markdown image link.

### Improved

- Image asset folders follow notes when they are renamed, moved, trashed, restored, or permanently deleted.

## 0.4.0 — 2026-08-08

### Added

- Code fences offer language suggestions while you type, including common aliases.
- Preview code blocks now expose a copy control when hovered or focused.
- Mermaid code fences render diagrams locally in Preview, with the source preserved when a diagram cannot render.

### Improved

- Update installation now keeps its status accurate when the desktop restart request is unavailable.
- Margin checks every Windows, macOS, and Linux installer before a release is published.

### Fixed

- Spell check is now enabled only for editable notes, never previews or read-only system-opened files.

## 0.3.2 — 2026-08-06

### Fixed

- The preview table editor control now stays readable and clickable on macOS.
- Clicking an outline heading in a long note now scrolls the note and synchronized outline to the selected section.

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

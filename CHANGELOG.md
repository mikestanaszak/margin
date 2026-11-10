# Changelog

All notable user-facing changes to Margin are documented here.

## Unreleased

### Added

- Find and replace in the editor with Cmd/Ctrl+F, including match case, regex, and whole-word options.
- Typing `[[` suggests note titles and completes the closing brackets.
- Cmd/Ctrl+Enter toggles the task checkbox on the current lines, turning list items and plain lines into tasks.
- Cmd/Ctrl+click follows a wiki link, Markdown link, or web address from the editor.
- Settings offers a sans-serif editor font; code stays monospace.

### Improved

- New notes open in Edit view with the title selected, ready to type.
- Pressing Enter after an opening code fence adds the closing fence; Enter on an empty list item ends the list with a blank line so the next paragraph stands on its own.
- Code blocks are shaded in the editor so they stand apart from prose.
- Switching from Preview to Edit places the cursor where you were reading, so typing does not jump back to an earlier position.
- In the search field, Enter opens the top result, Escape clears the search, and Down moves into the note list; Up and Down move between notes in the list.
- Note card excerpts no longer show code-block contents or image syntax.

### Fixed

- Pausing while typing a title no longer moves the cursor to the top of the note. The rename that follows keeps the cursor, scroll position, and undo history.
- Renaming a note through its title keeps the editor in step with the rewritten image paths, so a later autosave no longer restores the old paths and lets cleanup remove the note's images.
- Checking a task in Preview no longer toggles an example task inside a code block that appears earlier in the note; tasks inside block quotes are counted correctly.
- Lines inside fenced code (such as `# install` shell comments) no longer become the note title, outline headings, or tables.
- `[[ ... ]]` inside code blocks and inline code stays literal instead of turning into a note link.
- A link or image path with a stray `%` no longer breaks Preview.
- Edits made just before switching notes (for example a task checked in Preview, then a link, backlink, or Quick Open result) are saved instead of waiting until the note is reopened.
- Cmd/Ctrl+I now italicizes the selection. Italic uses `*`, which also works inside words, and toggling italic leaves bold text intact.
- Inserting a table no longer replaces selected text, and inserting one from Split view stays in Split view. The selection toolbar no longer offers a table button that replaced the selection.
- The selection toolbar hides when the selection scrolls out of view or the editor loses focus, and no longer covers search matches.
- Choosing an outline heading in Edit view moves the editor to that heading, and the outline matches setext and quoted headings.
- With the outline open, jumping to a heading in Edit view no longer shifts the whole window upward.
- Escape closes the topmost dialog only (for example Templates, leaving Settings open), and app shortcuts no longer act behind open dialogs.
- The note context menu always stays fully on screen and supports arrow-key navigation.
- The table editor keeps rows with missing cells and offers an Add row button even when a table has no rows.
- Import captures is only offered for notes in the library's Daily folder, matching where imports are accepted.

## 0.5.4 — 2026-11-09

### Improved

- The editor highlights Markdown syntax (headings, emphasis, links, code, quotes) in every palette and theme.
- Code blocks in Preview use readable light-mode colors instead of dark-theme colors on a light background.
- Note cards use their full width for excerpts, tags, and dates, with spacing between cards and accent-colored tags.
- The note header is tidier: Table and Image moved beside the view switcher, the switcher is more compact, and the stale library note count no longer appears under the note title.
- The sidebar uses consistent type sizes and count alignment; folder actions appear on hover without truncating folder names.
- Search and Settings use crisp line icons, and search shows a focus ring.
- Filled accent buttons stay legible in dark themes.
- Compact windows (around 900–1180px) cap the side panes so Split view no longer overflows the window.
- Settings and other dialogs use consistent button and control sizes; the palette picker shows all four palettes in one row.
- The quick switcher no longer draws a doubled focus line under its search field.

### Security

- Updated DOMPurify (3.4.17) and KaTeX (0.18.10), which Mermaid diagrams use, to releases that fix published advisories.
- Updated rustls, rustls-webpki, and the bundled root certificates, and removed the unused `zip` extraction path from the updater.

## 0.5.3 — 2026-08-28

### Fixed

- Bullets and numbers remain visible in lists that also contain tasks, including bullets nested under a task.
- Wrapped task text stays aligned with the first line, with the checkbox beside it, in both compact lists and lists containing separate paragraphs.
- Long links, formatted link labels, and unbroken inline text wrap within list items without displacing markers or overflowing narrow preview panes.
- New installations use the intended navigation pane widths instead of starting with cramped sidebars and unnecessarily truncated note titles. Saved pane sizes are preserved.
- Changing a note title no longer triggers stale autosave attempts against its previous filename or a misleading unsaved-draft warning after a successful save.
- Creating or switching notes immediately after editing saves the outgoing draft, including task changes made in Preview.
- Relative images using parent-directory paths render correctly, including Windows drive and network-share paths, without widening native file access.
- Table, template, and settings dialogs retain their intended layout instead of being squeezed by shared modal styles.

## 0.5.2 — 2026-08-21

### Improved

- Quick Capture reapplies the saved appearance and palette whenever its window opens or regains focus.
- Tagged GitHub releases now publish the matching changelog section as their release notes instead of a generic placeholder.
- Code-fence completion keeps Tab available for indentation while Enter accepts the highlighted language.

### Fixed

- The native spelling context menu is available in editable, spellchecked notes on macOS while application context menus remain suppressed elsewhere.
- Cmd/Ctrl+A selects the complete active note in the editor without propagating to the surrounding application.
- Preview code blocks no longer reserve an oversized blank strip above their first line.

## 0.5.1 — 2026-08-21

### Added

- Releases now include `SHA256SUMS`; the Windows, macOS, and Linux installer scripts verify the selected package before changing an installation.

### Improved

- Automatic update checks recover from invalid or future cadence timestamps, honor skipped versions, and clear stale update actions before a new check. Manual checks can reconsider a skipped version.
- Update installation no longer restarts Margin automatically. Restart becomes available only after installation succeeds, with retry and close paths for check, install, or relaunch failures.
- Release validation now verifies every expected package, updater signature, platform entry, tagged asset URL, and package checksum before a draft can be published.

### Fixed

- Case-only note renames no longer risk replacing a distinct case-variant note on a case-sensitive macOS volume.
- Percent-encoded companion image references, including spaces and Unicode filenames, are preserved during cleanup; ambiguous local targets now skip deletion.
- Title-rename link repair now aborts and rolls back if another linked note changes after planning or staging.

## 0.5.0 — 2026-08-13

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

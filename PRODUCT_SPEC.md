# Margin — Features

## Available now

### Notes and libraries

- Local Markdown libraries: recursive indexing, external-file refresh, and normal UTF-8 `.md` files.
- Tags are read from YAML front matter, normalized by trimming duplicates case-insensitively, shown as read-only labels on note cards and in Quick Open, and included in ranked search. Tag editing and tag filtering are not included.
- First H1 is the note title; filenames stay aligned with titles. When a title rename changes a filename, Margin repairs only unambiguous internal relative Markdown links and leaves external URLs, anchors, absolute paths, and unresolved links untouched.
- Notes can be created, duplicated, renamed, moved, trashed, restored, permanently deleted, and revealed in Finder or File Explorer.
- Folders can be created, nested, renamed by double-clicking their name, and moved to Trash. The inline plus button adds a subfolder.
- Selecting a parent folder groups notes by nested folders instead of flattening them.
- Favorites, All notes, Trash, folder counts, folder collapse state, and resizable navigation panes.
- Search filters the current note view while Quick Open searches the whole library. Both use the same native ranking: exact and prefix title matches lead filename/path, tag, and body matches, and an empty Quick Open shows recently updated notes.
- Library scans keep healthy notes available and show a concise warning count when a directory entry, note, UTF-8 document, or front matter cannot be interpreted safely.

### Editing and preview

- Preview is the default; Cmd/Ctrl+E switches between Preview and Edit, with Split view available. Opening another note preserves the current Edit, Split, or Preview mode.
- GitHub-flavored Markdown preview: headings, links, images, tasks, tables, blockquotes, and highlighted code blocks.
- Fenced code blocks have a keyboard-accessible Copy control with success and failure feedback.
- Mermaid code fences render as local diagrams in Preview, with light and dark themes and a visible source fallback for malformed diagrams.
- Preview tasks are clickable and save their completion state.
- Tables can be edited in place, with row/column insertion, deletion, and reordering.
- Internal Markdown and wiki links open the matching note. Resolved relative Markdown links and unambiguous wiki links share one backlink graph and populate the receiving note's Linked from list; external URLs, anchors, absolute paths, ambiguous targets, and unresolved targets do not. Web links open in the system browser, and creating a missing note from a link remains deferred.
- Inline code can be selected with a double-click.
- Typing after an opening triple-backtick suggests supported Highlight.js language names and common aliases without restricting custom identifiers.
- Enter accepts the highlighted code-language suggestion; Tab dismisses suggestions and indents. Cmd/Ctrl+A selects the complete active note without selecting the surrounding interface.
- Autosave preserves editor selection and scroll position.
- Preview uses the same comfortable, left-aligned reading margin as the editor.
- Resizable heading outline with hierarchy, active-section tracking, synchronized scrolling, and a configurable shortcut.
- Edit mode provides operating-system spell check and its native correction menu; Preview and read-only notes remain non-editable.

### Capture, import, and customization

- Global Quick Capture: Cmd+Option+Shift+Space on macOS; Ctrl+Alt+Shift+Space elsewhere by default.
- The dedicated Quick Capture window and in-app fallback share one lightweight composer, Markdown list continuation, keyboard behavior, status feedback, Daily template handling, and the saved theme and palette.
- Today opens or creates the current date’s note in the Daily folder.
- Template editor: create, rename, duplicate, delete, preview, and create a note from reusable Markdown templates. `{{date}}` and `{{time}}` variables are supported.
- Daily captures can be imported into a configured default note, another existing note, or a new note in any folder.
- Light, dark, and system appearance; system is the default. Ink, Mint, and Linen palettes are available independently of appearance, with Mint as the default.
- Margin uses one packaged green application icon on every platform; theme and palette changes do not change it.
- Images can be picked, dragged into the editor, or pasted. Margin copies each image into a sibling `<note>.assets` folder and inserts a relative Markdown image link. A successful note save removes unreferenced direct files from that note's companion folder and deletes the folder when it becomes empty. Encoded local references are decoded exactly once; ambiguous local destinations preserve the folder rather than risk deletion.
- Image companion folders stay out of the sidebar and folder menus. The Image action lives beside table insertion in the top edit formatting toolbar. Renaming a note moves its companion folder and rewrites that note's image paths.
- The Paper palette provides coordinated warm-tan light and dark appearances; code-fence language suggestions remain readable in every palette.
- Settings for library location, hotkeys, Quick Capture destination, supported code-block languages, and manual update checks.

### Desktop and updates

- Native Tauri app for Windows, Apple Silicon macOS, and x64 Linux (`.deb` and AppImage releases).
- Margin registers as an editor for `.md` and `.markdown` files. Files already
  inside the selected library open directly; files outside it can be opened as
  their original or imported as a copy into a chosen folder.
- Signed in-app updates, with daily automatic checks and manual checks in Settings. Automatic checks suppress a version the user skipped, while a manual check surfaces that version again for reconsideration. Choosing Update now downloads and installs without restarting; Restart Margin appears only after installation succeeds. Check, install, and restart failures keep clear feedback and a retry or close path.
- Published releases include a SHA-256 manifest. The manual Windows, macOS, and Linux installer scripts verify their selected package before modifying an installation. Manual packages are not currently Windows Authenticode-signed or Apple Developer ID-signed/notarized, so documentation does not claim operating-system publisher identity.
- GitHub release bodies are generated from the tagged version's `CHANGELOG.md` section after all platform packages are assembled.
- Packaged builds serve compiled assets with Tauri's embedded custom protocol and do not enable the optional localhost-server plugin. Development alone uses the configured Vite localhost server.
- Closing the main window hides Margin so global Quick Capture remains available. The tray menu provides Show Margin, Quick Capture, and Quit.
- Quit waits for pending managed-note saves. A conflict or save failure shows the main window with the draft and recovery state intact; if saving does not answer, discarding the draft requires explicit native confirmation and Cancel is the default.

## Planned

- Optional Git-aware library status and version history.
- Improved imports from popular Markdown exports.
- Optional graph views and unresolved-link note creation.
- Optional tag editing and tag-based library filtering.
- Optional synchronization while preserving portable Markdown files and local-first ownership.
- Optional AI-agent integrations for user-directed note drafting, summarizing, organizing, and appending work logs, with explicit per-action approval and no automatic access to a library.

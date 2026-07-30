# Margin — Features

## Available now

### Notes and libraries

- Local Markdown libraries: recursive indexing, external-file refresh, and normal UTF-8 `.md` files.
- First H1 is the note title; filenames stay aligned with titles.
- Notes can be created, duplicated, renamed, moved, trashed, restored, permanently deleted, and revealed in Finder or File Explorer.
- Folders can be created, nested, renamed by double-clicking their name, and moved to Trash. The inline plus button adds a subfolder.
- Selecting a parent folder groups notes by nested folders instead of flattening them.
- Favorites, All notes, Trash, folder counts, folder collapse state, and resizable navigation panes.

### Editing and preview

- Preview is the default; Cmd/Ctrl+E switches between Preview and Edit, with Split view available.
- GitHub-flavored Markdown preview: headings, links, images, tasks, tables, blockquotes, and highlighted code blocks.
- Preview tasks are clickable and save their completion state.
- Tables can be edited in place, with row/column insertion, deletion, and reordering.
- Internal Markdown and wiki links open the matching note; web links open in the system browser.
- Inline code can be selected with a double-click.
- Autosave preserves editor selection and scroll position.
- Heading outline with hierarchy, active-section tracking, and a configurable shortcut.

### Capture, import, and customization

- Global Quick Capture: Cmd+Option+Shift+Space on macOS; Ctrl+Alt+Shift+Space elsewhere by default.
- Quick Capture supports Markdown list continuation and appends to a daily note.
- Daily captures can be imported into a configured default note, another existing note, or a new note in any folder.
- Light, dark, and system appearance; system is the default.
- Settings for library location, hotkeys, Quick Capture destination, supported code-block languages, and manual update checks.

### Desktop and updates

- Native Tauri app for Windows and Apple Silicon macOS.
- Signed in-app updates, with daily checks and an available-update prompt.

## Planned

- Templates and daily-note creation options.
- Linux packages.
- Native-window integration and staged-update installation coverage.
- Optional Git-aware library status and version history.
- Improved imports from popular Markdown exports.
- Platform-specific `.md` file association so Margin can be chosen as the default Markdown opener. For Markdown opened outside a library, preserve the source file and offer: import as a new note, append all or a selection to an existing note, or copy selected Markdown.

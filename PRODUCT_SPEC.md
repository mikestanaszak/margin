# Margin — Features

## Available now

### Notes and libraries

- Local Markdown libraries: recursive indexing, external-file refresh, and normal UTF-8 `.md` files.
- First H1 is the note title; filenames stay aligned with titles. When a title rename changes a filename, Margin repairs only unambiguous internal relative Markdown links and leaves external URLs, anchors, absolute paths, and unresolved links untouched.
- Notes can be created, duplicated, renamed, moved, trashed, restored, permanently deleted, and revealed in Finder or File Explorer.
- Folders can be created, nested, renamed by double-clicking their name, and moved to Trash. The inline plus button adds a subfolder.
- Selecting a parent folder groups notes by nested folders instead of flattening them.
- Favorites, All notes, Trash, folder counts, folder collapse state, and resizable navigation panes.

### Editing and preview

- Preview is the default; Cmd/Ctrl+E switches between Preview and Edit, with Split view available.
- GitHub-flavored Markdown preview: headings, links, images, tasks, tables, blockquotes, and highlighted code blocks.
- Fenced code blocks have a keyboard-accessible Copy control with success and failure feedback.
- Mermaid code fences render as local diagrams in Preview, with light and dark themes and a visible source fallback for malformed diagrams.
- Preview tasks are clickable and save their completion state.
- Tables can be edited in place, with row/column insertion, deletion, and reordering.
- Internal Markdown and wiki links open the matching note; web links open in the system browser.
- Inline code can be selected with a double-click.
- Typing after an opening triple-backtick suggests supported Highlight.js language names and common aliases without restricting custom identifiers.
- Autosave preserves editor selection and scroll position.
- Preview uses the same comfortable, left-aligned reading margin as the editor.
- Resizable heading outline with hierarchy, active-section tracking, synchronized scrolling, and a configurable shortcut.
- Edit mode provides operating-system spell check; Preview and read-only notes remain non-editable.

### Capture, import, and customization

- Global Quick Capture: Cmd+Option+Shift+Space on macOS; Ctrl+Alt+Shift+Space elsewhere by default.
- Quick Capture supports Markdown list continuation and applies the Daily note template when it creates the day’s note.
- Today opens or creates the current date’s note in the Daily folder.
- Template editor: create, rename, duplicate, delete, preview, and create a note from reusable Markdown templates. `{{date}}` and `{{time}}` variables are supported.
- Daily captures can be imported into a configured default note, another existing note, or a new note in any folder.
- Light, dark, and system appearance; system is the default. Ink, Mint, and Linen palettes are available independently of appearance, with Mint as the default.
- Margin uses one packaged green application icon on every platform; theme and palette changes do not change it.
- Images can be picked, dragged into the editor, or pasted. Margin copies each image into a sibling `<note>.assets` folder and inserts a relative Markdown image link. A successful note save removes unreferenced direct files from that note's companion folder and deletes the folder when it becomes empty.
- Image companion folders stay out of the sidebar and folder menus. The Image action lives beside table insertion in the top edit formatting toolbar. Renaming a note moves its companion folder and rewrites that note's image paths.
- The Paper palette provides coordinated warm-tan light and dark appearances; code-fence language suggestions remain readable in every palette.
- Settings for library location, hotkeys, Quick Capture destination, supported code-block languages, and manual update checks.

### Desktop and updates

- Native Tauri app for Windows, Apple Silicon macOS, and x64 Linux (`.deb` and AppImage releases).
- Margin registers as an editor for `.md` and `.markdown` files. Files already
  inside the selected library open directly; files outside it can be opened as
  their original or imported as a copy into a chosen folder.
- Signed in-app updates, with daily checks and an available-update prompt. Choosing Update now downloads and installs the update; Restart Margin appears only after that operation finishes.

## Planned

- Native-window integration and staged-update installation coverage.
- Optional Git-aware library status and version history.
- Improved imports from popular Markdown exports.
- Optional AI-agent integrations for user-directed note drafting, summarizing, organizing, and appending work logs, with explicit per-action approval and no automatic access to a library.
- Code-fence language autocomplete: suggest supported languages and aliases while typing after an opening triple-backtick fence, while still allowing custom language identifiers.

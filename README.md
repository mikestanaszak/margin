# Margin

Margin is a calm, local-first desktop workspace for ordinary Markdown notes. Pick a folder, write in `.md` files, and keep using that same folder in Explorer, Finder, Git, or another editor—there is no account, database, or proprietary note format.

[Download Margin](https://github.com/mikestanaszak/margin/releases/latest) · [Release notes](CHANGELOG.md) · [Complete product spec](PRODUCT_SPEC.md)

<p align="center">
  <img src="docs/images/workspace-current.png" alt="Margin showing a project note in a nested Markdown folder workspace" width="760" />
</p>

## What is in Margin

| Area | What it does |
| --- | --- |
| Write | Preview, Edit, and Split views; Markdown formatting tools; spell check in Edit; autosave; and a heading outline. |
| Preview | GitHub-flavored Markdown, syntax-highlighted code, Mermaid diagrams, interactive tasks, image rendering, and editable tables. |
| Organize | Real nested folders, YAML front-matter tags, All notes, Favorites, Trash, search, Quick Open, and per-folder note counts. |
| Navigate | Markdown links and `[[wiki links]]` open notes in the library. **Linked from** appears when another saved note contains a matching wiki link. |
| Capture | Global Quick Capture, dated Daily notes, and reusable Markdown templates with `{{date}}` and `{{time}}`. |
| Customize | System, light, and dark appearance; Ink, Mint, Linen, and Paper palettes; configurable shortcuts; update checks; and a library picker. |

## Images stay beside their note

Use the **Image** button in the top Edit bar beside **Table**, drag an image into the editor, or paste one from the clipboard. Margin copies the image next to its note and inserts a portable relative Markdown reference.

For example:

```text
Notes/
  Projects/
    Launch plan.md
    Launch plan.assets/
      whiteboard.png
```

The `.assets` folder is hidden from Margin’s sidebar because it belongs to the adjacent note, not to your folder organization. If you rename or move a note, Margin moves its companion folder and repairs its image references. When an image reference is removed from the Markdown, the unreferenced image file is removed on the next save; an empty companion folder disappears too. Margin only removes direct files it created in that note’s own `.assets` folder.

## Everyday workflow

1. Choose a folder as your library.
2. Create notes and folders normally—your first H1 becomes the note title and filename.
3. Use Preview for reading, **Cmd/Ctrl+E** for editing, or Split for both.
4. Search with **Cmd/Ctrl+K**, use Quick Open, or browse folders and Favorites.
5. Right-click a note to move it, send it to Trash, duplicate it, or reveal the exact file in Finder or File Explorer.

Notes can also be opened from their file manager. A Markdown file already in the selected library opens directly; an external Markdown file can be opened as-is or safely imported as a copy.

## Feature details

### Editing and preview

- The top Edit bar inserts headings, emphasis, links, tables, and images. Select text for the smaller contextual formatting controls.
- Type after an opening `` ``` `` fence to choose a code language. The list includes Highlight.js languages and common aliases, but custom identifiers still work.
- Preview code blocks have a Copy button. Tables open an editor for adding, removing, filling, and reordering rows and columns.
- Checkboxes can be toggled from Preview and save back to Markdown. Mermaid diagrams render locally and retain a visible source fallback if a diagram is invalid.

### Links, backlinks, and navigation

Use `[label](Relative note.md)` or `[[Note title]]` to connect notes. Margin only treats Markdown links that resolve to a note in the library as in-app navigation; web, email, and phone links open through the operating system. **Linked from** is added beneath the active note after another note containing a matching saved wiki link is indexed. It updates after that other note saves or the library refreshes.

Tags are stored in each note's YAML front matter. Margin normalizes them by trimming empty entries and duplicate names case-insensitively; they appear on note cards and participate in search.

### Capture and templates

Press **Ctrl+Alt+Shift+Space** on Windows or **Command+Option+Shift+Space** on macOS to open Quick Capture. The first capture of a day can create a Daily note from the Daily note template. Later, captures can be appended, imported into another note, or turned into a separate note. Manage templates, capture defaults, shortcuts, appearance, and updates in Settings.

<p align="center">
  <img src="docs/images/quick-capture-current.png" alt="Margin Quick Capture window" width="520" />
</p>

## Install

### Windows

Run this in PowerShell to install or update Margin. Your note library is not changed.

```powershell
irm https://raw.githubusercontent.com/mikestanaszak/margin/main/install.ps1 | iex
```

### macOS (Apple Silicon)

```bash
curl -fsSL https://raw.githubusercontent.com/mikestanaszak/margin/main/install.sh | bash
```

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/mikestanaszak/margin/main/install-linux.sh | bash
```

Manual installers for Windows, macOS, Debian/Ubuntu, and AppImage Linux are available from the [latest release](https://github.com/mikestanaszak/margin/releases/latest).

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Edit the open note | Cmd/Ctrl + E |
| Save now | Cmd/Ctrl + S |
| Search notes | Cmd/Ctrl + K |
| Open Quick Capture | Cmd/Ctrl + Alt + Shift + Space |
| Save Quick Capture | Cmd/Ctrl + Enter |
| Show or hide library | Cmd/Ctrl + Shift + B |
| Close a panel or capture | Escape |

The shortcut list is configurable in Settings.

## Privacy and safety

Margin stores your writing in the library you choose and does not require an account. It checks for signed updates and verifies downloads before installation. For safety, Margin does not follow symlinks inside a library; select the real notes folder and keep linked files as normal external files.

## Build from source

Margin uses Tauri, React, TypeScript, and Rust. With Node.js, pnpm, Rust, and the platform build tools installed:

```cmd
pnpm install
pnpm tauri dev
```

Run `pnpm test`, `pnpm build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo check --manifest-path src-tauri/Cargo.toml`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` before contributing. Run `pnpm test:integration` directly when changing Mermaid rendering. More development detail is in [TESTING.md](TESTING.md).

# Margin

**A native, local-first home for Markdown notes.** Margin turns an ordinary folder of `.md` files into a focused workspace—without locking your writing into an account, database, or proprietary format.

[Get Margin](https://github.com/mikestanaszak/margin/releases/latest) · [Feature list](PRODUCT_SPEC.md)

<p align="center">
  <img src="docs/images/workspace-current.png" alt="Margin showing a nested folder workspace and a project note in Preview" width="760" />
</p>

## Made for everyday notes

- **Keep your files.** A Margin library is just a folder of UTF-8 Markdown files. Open the same notes in Finder, Explorer, or another editor whenever you want.
- **Stay oriented.** Browse All notes, Favorites, Trash, and a real nested folder tree. Choosing a parent folder keeps its notes visibly grouped by subfolder.
- **Write without the Markdown tax.** Work in Preview, Edit, or Split view; use the outline to jump between headings; and use a selection toolbar for common formatting.
- **Make Preview useful.** Check off tasks directly in Preview, follow Markdown and wiki links, open web links in your default browser, and view highlighted code, images, and tables.
- **Edit tables like a person.** Hover a Preview table to open its editor, then add, remove, reorder, and fill rows or columns without hand-editing pipes.
- **Keep filenames understandable.** The first top-level heading becomes the note title and filename, so the folder still makes sense outside Margin.

## A calmer way to manage a library

Margin is designed around the little things that make a note app pleasant to live in:

- Create, rename, nest, delete, and resize folders; move notes with a right-click menu.
- Favorite notes, send them to Trash, restore them, or permanently delete them when you are sure.
- Search the whole library from the top bar, and use internal Markdown links to open a note in its deepest folder.
- See linked-from references and an optional heading-only outline without cluttering the editor.
- Open a note’s location directly in Finder or File Explorer.
- Use light or dark appearance, following the system by default, and review or change shortcuts in Settings.
- Keep editing position stable while autosave writes safely in the background.

## Catch thoughts before they disappear

Press **Ctrl+Alt+Shift+Space** on Windows or **Command+Option+Shift+Space** on macOS to open Quick Capture from anywhere. It remembers the library and destination you choose, understands basic list continuation while you type, and saves with **Ctrl/Command+Enter**.

Later, import captures into today’s daily note, append them to any existing note, create a separate note, or choose a folder. This is handy for a daily work log that eventually becomes part of a weekly or yearly record.

<p align="center">
  <img src="docs/images/quick-capture-current.png" alt="Margin Quick Capture window" width="520" />
</p>

## Install

### macOS (Apple Silicon)

Install the latest signed release with one command. An existing Margin app is replaced; your notes remain in the library you chose.

```bash
curl -fsSL https://raw.githubusercontent.com/mikestanaszak/margin/main/install.sh | bash
```

### Windows

Run this in PowerShell. It replaces an existing Margin installation and leaves your notes alone.

```powershell
irm https://raw.githubusercontent.com/mikestanaszak/margin/main/install.ps1 | iex
```

### Linux

Margin publishes two x64 Linux downloads on every release:

- **Debian / Ubuntu:** download the `.deb` from the [latest release](https://github.com/mikestanaszak/margin/releases/latest), then install it with `sudo apt install ./Margin_*.deb`.
- **Other distributions:** download the `.AppImage`, make it executable with `chmod +x Margin_*.AppImage`, then run it directly.

You can also download an installer for any platform from the [latest release](https://github.com/mikestanaszak/margin/releases/latest).

## Shortcuts

Margin uses **Command** on macOS and **Control** on Windows for usual in-app shortcuts.

| Action | Shortcut |
| --- | --- |
| Edit the open note | Cmd/Ctrl + E |
| Save now | Cmd/Ctrl + S |
| Search notes | Cmd/Ctrl + K |
| Open Quick Capture | Cmd/Ctrl + Alt + Shift + Space |
| Save Quick Capture | Cmd/Ctrl + Enter |
| Close a panel or capture | Escape |

Settings includes the full configurable shortcut list, the quick-capture destination, theme controls, and supported code-block languages.

## Updates and privacy

Margin checks for signed updates daily and shows an unobtrusive notice in Settings when one is ready. Downloads are verified before installation.

Your writing stays in the folder you chose. Margin does not require an account and does not put notes in a proprietary database.

## Build from source

Margin is built with Tauri, React, TypeScript, and Rust. With Node.js, pnpm, Rust, and the platform build tools installed:

```cmd
pnpm install
pnpm tauri dev
```

For more development and testing details, see [TESTING.md](TESTING.md).

# Margin

A local-first Markdown note-taking desktop app built with Tauri 2, React, TypeScript, and Rust. Notes remain ordinary `.md` files in a folder you choose.

## Features currently implemented

- Choose and reopen a local notes library
- Recursively discover Markdown files
- Create and edit notes with autosave
- YAML front matter for multiple tags
- Sidebar views for All Notes, Untagged, and individual tags
- Local full-text search across titles, filenames, tags, and note bodies, with excerpts
- Edit/Preview toggle with `Cmd+E` on macOS and `Ctrl+E` on Windows/Linux
- GitHub-flavored Markdown Preview (tables, task lists, code blocks, links, and relative images)
- Rename, duplicate, pin, and safely move notes to the library-local trash
- Quick switcher, split editor/preview, wiki links and backlinks
- External-change conflict resolution and automatic index refresh
- Responsive sidebar, keyboard focus shortcuts, and system light/dark appearance

The broader product roadmap is documented in [PRODUCT_SPEC.md](PRODUCT_SPEC.md). Templates, import/export, and version-history workflows remain future roadmap work.

## Install on macOS

Once a signed macOS release has been published, install the latest release directly from the root installer:

```bash
curl -fsSL https://raw.githubusercontent.com/mikestanaszak/margin/main/install.sh | bash
```

The installer detects Apple Silicon and Intel Macs, downloads the matching `.dmg` from GitHub Releases, verifies its code signature, and installs **Margin.app** in `/Applications`. It will request an administrator password only when macOS requires permission to write there.

To install a particular release or use a per-user Applications folder:

```bash
curl -fsSL https://raw.githubusercontent.com/mikestanaszak/margin/main/install.sh | MARGIN_VERSION=0.1.0 MARGIN_INSTALL_DIR="$HOME/Applications" bash
```

Releases need to include signed `aarch64.dmg` and `x64.dmg` assets. The installer deliberately refuses unsigned builds; during local development only, set `MARGIN_ALLOW_UNSIGNED=1`.

## Keyboard shortcuts

The app uses the platform's primary shortcut modifier: **Command** on macOS and **Control** on Windows/Linux. This applies to New Note, Save, Search, Quick Switcher, Edit/Preview, focus navigation, and the Markdown formatting shortcuts for bold, italic, and links.

## Prerequisites (Windows)

Install these dependencies before building the native desktop app:

1. **Node.js LTS** — [nodejs.org](https://nodejs.org/) or `winget install OpenJS.NodeJS.LTS`
2. **pnpm** — `npm install --global pnpm`
3. **Rust (MSVC toolchain)** — [rustup.rs](https://rustup.rs/) or `winget install Rustlang.Rustup`
4. **Visual Studio Build Tools** with the **Desktop development with C++** workload and a Windows SDK — [Visual Studio downloads](https://visualstudio.microsoft.com/downloads/)

The Rust toolchain must be the MSVC toolchain:

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

If Cargo cannot find `link.exe`, open an **x64 Native Tools Command Prompt for VS 2022** (or load `VsDevCmd.bat`) before running the commands below.

## Install dependencies

From the repository root:

```powershell
pnpm install
```

## Run in development

```powershell
pnpm tauri dev
```

This starts the Vite development server and launches the Margin window. Choose a folder containing Markdown notes, or create a new folder from the library picker.

For development, use `pnpm tauri dev` rather than launching `target/debug/margin.exe` directly. A debug executable launched by itself expects the Vite server at `http://localhost:1420`; a packaged build from `pnpm tauri build` contains the frontend and can be launched directly.

## Build

Build only the web frontend:

```powershell
pnpm build
```

Build the native debug executable:

```powershell
pnpm tauri build --debug
```

Build a production application bundle:

```powershell
pnpm tauri build
```

Rust and Tauri artifacts are configured to go in the repository-level `target/` directory, not `src-tauri/target/`:

```text
target/debug/margin.exe
target/release/margin.exe
target/release/bundle/
```

The output directory is ignored by Git.

## Validate the backend

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

## Note format

Each note is one UTF-8 Markdown file. Tags are stored in YAML front matter so the files remain portable:

```markdown
---
title: A useful note
tags:
  - ideas
  - product
---

# A useful note

Write Markdown here.
```

Notes can be edited by other Markdown tools. The app reads the library recursively and does not require a proprietary database.

## Project layout

```text
src/                 React UI and styling
src-tauri/src/       Rust filesystem/indexing commands
src-tauri/tauri.conf.json
PRODUCT_SPEC.md      Product requirements and roadmap
.cargo/config.toml   Root build output configuration
```

## Troubleshooting

### `npm` or `pnpm` is not recognized

Install Node.js, restart the terminal, then install pnpm:

```powershell
npm install --global pnpm
```

### `link.exe` is not found

Install Visual Studio Build Tools with the C++ workload, then run the command from the Visual Studio x64 Native Tools terminal.

### `kernel32.lib` cannot be opened

Install a Windows 10/11 SDK through the Visual Studio Installer and rerun from the x64 Native Tools terminal.

### Preview or tags look stale

Stop the running app, rebuild with `pnpm tauri dev` or `pnpm tauri build --debug`, and reopen the note. The app autosaves note content and tags back to the Markdown file.
## Run locally

In Codex, use the `dev:desktop` package script (or the **Run Margin (native)** workspace task) to start the native desktop app. The same command works in a terminal:

```powershell
pnpm run dev:desktop
```

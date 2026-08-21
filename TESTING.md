# Margin test suite

Run the complete automated suite from a regular Windows Command Prompt:

```cmd
pnpm install
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

`pnpm test` runs the unit suite and then the dedicated Mermaid renderer integration suite. Run either phase directly when iterating:

```cmd
pnpm test:unit
pnpm test:integration
```

## Example library

[`tests/fixtures/example-library`](tests/fixtures/example-library) is a reusable, portable Markdown library. Automated native tests copy it into a unique temporary directory before changing it, so the committed examples remain pristine. It can also be copied elsewhere and selected in a development build for manual testing.

The example notes include:

- YAML front matter, dates, tags, case-insensitive duplicate tags, and a stale metadata title;
- nested folders, a daily note, a trashed note, and a note without an H1;
- Unicode paths and content;
- wiki links, relative Markdown links, an external link, and a local SVG image;
- task lists, tables with escaped pipes, blockquotes, inline formatting, and highlighted code;
- a non-Markdown file and internal `.markdown-notes` content that indexing must ignore.

## Coverage matrix

| Product area | Automated evaluation | Desktop-only regression check |
| --- | --- | --- |
| Library indexing and recursive folders | Fixture-driven Rust tests | Select the copied example library and compare sidebar counts |
| UTF-8, front matter, canonical H1 titles, excerpts, and search text | Rust and TypeScript tests | Edit a Unicode note in another editor and refocus Margin |
| Create, save, filename alignment, collisions, rename, duplicate, and move | Rust workflow tests | Confirm Explorer shows ordinary `.md` files |
| Note/folder trash, restore, permanent delete, and path containment | Rust workflow and rejection tests | Confirm destructive-action prompts and context menus |
| Preview GFM, tasks, tables, links, local images, and code languages | React and transformation tests | Visually inspect highlighting and local image layout |
| CodeMirror formatting, code-fence language autocomplete, image insertion, controlled updates, and view-state bounds | Editor command tests | Confirm selection and scroll remain stable through autosave and mode changes |
| YAML front-matter tags, note cards, favorites control, quick switcher, and relative dates | React interaction tests | Confirm tags appear on note cards and favorite persistence after relaunch |
| Edit/Split/Preview and keyboard-resizable split layout | React interaction tests | Drag dividers and verify saved widths after relaunch |
| Quick-capture append and import destinations | Rust workflow tests | Exercise the registered global shortcut and separate capture window |
| External-change indexing | Rust reload test | Verify the clean reload and unsaved-conflict decision dialog |
| Themes and configurable shortcuts | Pure shortcut tests plus production build | Check system theme changes and an OS-level shortcut conflict |
| Daily/manual update checks, skipped versions, no-update/error feedback, install/retry, successful install, and restart states | Platform-independent updater controller and React interaction tests | Signature verification and a real install/relaunch require a signed staged release served by the update endpoint |
| Release packages, updater platform URLs/signatures, and SHA-256 coverage | Release-contract and checksum-manifest tests | Confirm the draft release remains unpublished if any platform build or verification job fails |
| Offline/privacy guarantees | Architecture review: file operations have no network dependency or telemetry | Disconnect networking and create/search/edit notes |

## Native smoke checklist

Use `pnpm tauri dev` after automated checks pass:

1. Copy `tests/fixtures/example-library` to a temporary location and choose it as the library.
2. Open each navigation filter and a nested folder; search for `crème`, `planning`, and `release checklist`.
3. Open `Project Alpha`, toggle both task states in Preview, edit its table, and switch among Edit, Split, and Preview with the toolbar and shortcut.
4. Follow its wiki link and relative Markdown link, then verify Backlinks and Outline navigation.
5. Create a temporary note, insert an image through the picker, drag/drop, and paste; verify the image preview and adjacent `.assets` folder. Rename, move, trash, restore, and permanently delete the note to verify its asset folder follows it. Repeat trash with a temporary folder.
6. Make an unsaved edit, modify the same file externally, and verify that the conflict dialog preserves both choices.
7. Open quick capture with the global shortcut, cancel with Escape, save with Ctrl/Cmd+Enter, and import the Daily capture to both an existing note and a new nested note.
8. Change theme, pane sizes, default capture import target, and shortcuts; relaunch and verify persistence.
9. Trigger a manual update check. If using a signed staged release, exercise download/install, confirm Margin does not restart automatically, then choose Restart Margin. Real signature verification and install/relaunch are not attempted with an unsigned local build.
10. For a release candidate, compare the selected installer against `SHA256SUMS` before launch and confirm each installer script rejects a deliberately mismatched copy without stopping or replacing Margin.
11. On a packaged macOS release candidate, confirm Margin owns no TCP listening socket (for example, with Activity Monitor or `lsof -nP -iTCP -sTCP:LISTEN`). A `tauri://localhost` WebView origin is expected and is not a network listener.

# Editor images, discoverability, and paper theme

## Purpose

Make image insertion reliable and easy to find, keep implementation-owned image folders out of navigation, and make the app's existing capabilities discoverable from the README.

## Approved behavior

- The existing Image picker action moves into the edit formatting toolbar immediately after the table action. It keeps its existing managed-note safeguards and native picker behavior.
- Dragging a supported image file over the editor accepts both MIME-typed browser files and desktop files whose `File.type` is empty. Dropping inserts the imported relative Markdown image at the current editor selection.
- Pasting an image accepts clipboard image items through `DataTransferItem.getAsFile()` as well as clipboard file lists. It never intercepts ordinary text pastes.
- Native image validation remains authoritative: only PNG, JPEG, GIF, and WebP image payloads up to 25 MB are stored beside the note.
- Directories named `<note>.assets` are omitted from the library folder snapshot, its sidebar, and folder-selection menus. Their files remain available to Markdown previews and all existing move, rename, trash, restore, and delete lifecycle operations.
- Add a `paper` palette with coordinated tan light and dark CSS variables and a matching runtime application icon. It appears alongside the current Mint, Ink, and Linen choices.
- Theme switching updates the visible native window/tool-bar icon as well as the application or taskbar icon on platforms where runtime icon updates are supported. The audit verifies the currently open main and capture windows, rather than assuming a palette-to-icon command is sufficient.
- The code-fence language completion panel uses palette-aware foreground, background, active-row, and detail colors so options remain readable in every light and dark palette.
- The README gains a feature tour that locates editing tools, image handling, wiki links and the conditional `Linked from` list, preview tools, library navigation, capture/templates, settings, themes, and shortcuts.
- Mermaid preview integration tests do not execute the full Mermaid rendering engine in the broad UI suite. They verify preview-to-diagram wiring with a small test double, while the dedicated Mermaid component suite retains rendering, sanitization, fallback, and theme-change coverage. This keeps the release test suite deterministic without increasing timeout limits.

## Backlink rule to document

`Linked from` appears only for an open note that has at least one inbound wiki link from another indexed note. A wiki link target is compared case-insensitively with the current note title; `[[Project plan]]` therefore adds its source note to the `Project plan` note's list after the source note is saved and indexed.

## Validation

- Unit tests exercise image selection, desktop-style empty MIME file drops, clipboard-item image pastes, text-paste pass-through, toolbar ordering, hidden asset directories, the Paper palette, and completion panel color tokens.
- The full frontend suite is run repeatedly after the Mermaid test isolation change to prove the prior timeout no longer occurs under concurrent test load.
- Run focused frontend tests during each red-green cycle, then the complete frontend suite, production build, Rust test suite, formatter, and native check.
- Manually exercise picker, drag/drop, and paste in the Tauri desktop app using a managed note; verify the inserted relative image Markdown, hidden asset folder, preview rendering, both paper appearances, and visible native toolbar/window icon changes after every palette switch.

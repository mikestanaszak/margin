# Theme palettes design

## Scope

Margin keeps its existing **System**, **Light**, and **Dark** appearance
selection. A separate palette selection gives those appearances a visual
identity. This release ships three built-in palettes:

- **Ink** — graphite and blue.
- **Mint** — the refined green Margin identity and the default for new and existing installations.
- **Linen** — warm paper, ink, and terracotta.

The selection is application-wide and stored locally, never in note files or
library metadata. No custom palette editor or imported theme format is in
scope.

## Experience

Settings gains a **Palette** control directly below **Appearance**. It presents
three small, labeled swatches; choosing one applies it immediately and marks
the active swatch. Appearance continues to choose System, Light, or Dark.

The palette updates all shared interface tokens: backgrounds, surfaces, text,
muted text, borders, accents, focus rings, selection/highlight color, danger
color, and shadows. Editor, preview, dialogs, navigation, tables, Mermaid,
and quick capture continue to consume those shared tokens. System appearance
reacts to OS light/dark changes without overwriting the selected palette.

## Runtime icons

The bundled installer/Finder/Applications/Start-menu icon is Mint. Margin also
ships Mint, Ink, and Linen runtime PNG variants. On Windows and macOS, changing
the palette asks the native host to update open Margin window icons immediately.
The call is best-effort: a native failure does not undo the palette change.
Linux intentionally keeps its packaged icon because runtime window-icon changes
are not consistently supported there.

## Architecture

The frontend owns the persisted `Palette` preference and sets
`data-palette` on the document root next to the existing `data-theme` value.
CSS supplies one semantic-token set per palette and appearance combination.
The native boundary is a narrow `set_runtime_palette_icon(palette)` command;
it maps only known palette names to compiled-in images and is a successful no-op
where runtime replacement is unsupported.

## Testing and validation

- Tests cover fallback to Ink, local persistence, document-root attributes, and
  immediate Settings selection.
- Native tests cover accepted palette identifiers and unsupported-platform
  no-op behavior through an icon-selection helper.
- Existing Mermaid appearance tests continue to ensure diagrams recompute when
  the effective light/dark mode changes.
- Validate with `pnpm test`, `pnpm build`, `cargo test --manifest-path
  src-tauri/Cargo.toml`, and native Windows/macOS smoke tests of Settings.

## Non-goals

- Per-note or per-folder themes.
- Editing, importing, or sharing palette definitions.
- Changing the installed shell icon after installation.
- Git-backed notes or any note-library migration.

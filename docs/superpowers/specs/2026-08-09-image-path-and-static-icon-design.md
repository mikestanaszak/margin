# Encoded Image Paths and Static Icon Design

## Goal

Make local Markdown images render when note and asset names contain spaces or Unicode, and return Margin to one green application icon that never changes with the selected palette.

## Image preview

React Markdown percent-encodes relative image URLs before passing them to Margin's image component. Margin will decode that URL path exactly once before converting separators and passing the native filesystem path to Tauri. Malformed percent escapes remain unchanged so preview rendering cannot throw. Remote, data, and existing asset URLs keep their current behavior.

The regression fixture uses the observed Windows form: `![image](<Meeting Notes — Kickoff.assets/image.png>)` beside `Meeting Notes — Kickoff.md`.

## Application icon

The packaged icon source returns to the original green Margin artwork and all generated platform assets are rebuilt from it. Theme and palette changes continue to update the application colors, but no longer invoke native icon updates. The native palette-icon command and its palette-specific embedded resources are removed from the runtime path.

## Verification

- A component test proves the observed encoded Markdown URL becomes the correct native Windows path.
- Frontend and native test suites pass when run sequentially.
- Production frontend and Tauri release builds compile with the regenerated green icons.
- Product documentation states that the icon is static and green.

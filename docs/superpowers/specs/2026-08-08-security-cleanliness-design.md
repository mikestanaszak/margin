# Security and Cleanliness Hardening Design

## Goal

Harden Margin's desktop trust boundaries and continuous-integration supply chain while removing confirmed dead code and making strict static validation pass, without changing the documented note format or user workflows.

## Scope

The change addresses every repository-controlled finding from the audit:

- Replace the global asset-protocol file globs with runtime scopes for the active library and explicitly opened Markdown files.
- Separate the production CSP from development-only Vite allowances and remove production `unsafe-eval`.
- Limit each window to the Tauri plugin permissions it actually uses.
- Pin GitHub Actions to immutable commit SHAs and add repeatable frontend/Rust security and lint checks.
- Remove the unused frontend global-shortcut package, unused barrel exports, and UI components that are only referenced by their own tests.
- Resolve every strict Clippy diagnostic without changing observable behavior.

The PR will not redesign installers, the frontend architecture, or Tauri's Linux backend. RustSec currently reports no known vulnerabilities and 17 upstream warnings, primarily GTK3 bindings required by Tauri on Linux. Those cannot be removed within this repository without replacing the platform backend.

## Architecture and data flow

`tauri.conf.json` will start the asset protocol with an empty static scope. Rust will grant recursive access only after canonicalizing a user-selected library. When the operating system explicitly opens an external Markdown file, Rust will canonicalize the file and grant recursive access to that note's containing directory so its relative images still render. The WebView continues to use `convertFileSrc`, but attempts to traverse outside an approved directory are rejected by Tauri's asset scope.

Production CSP will contain only bundled application, IPC, asset, and intentionally supported image/media sources. A separate `devCsp` will add Vite's localhost HTTP/WebSocket endpoints and development-only script allowances.

Capabilities will be split by window. Both windows retain core APIs, while only the main window receives the open-file dialog, updater, and restart permissions. Global shortcuts and external links remain implemented in Rust and no longer expose redundant frontend plugin permissions.

## Error handling

Failure to register an asset directory returns the existing user-facing command error for library selection. Invalid or missing startup Markdown paths are ignored as they are today. Explicitly opened files remain read-only until imported, and no new filesystem write authority is introduced.

## Testing and validation

Regression tests will first assert the hardened configuration and asset-directory decisions and must fail against the current code. Implementation then proceeds until they pass. Final validation includes:

- `pnpm test` and `pnpm build`
- `cargo test`, `cargo check`, `cargo fmt --check`, and strict `cargo clippy`
- `pnpm audit --prod`
- RustSec audit of `src-tauri/Cargo.lock`
- unused dependency/export scans
- inspection of the final staged diff and GitHub Actions results

No Markdown file-format or product-scope change is required, so `PRODUCT_SPEC.md` remains unchanged.

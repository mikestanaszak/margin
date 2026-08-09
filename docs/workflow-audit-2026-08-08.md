# GitHub Actions audit — 2026-08-08

## Decision summary

| Workflow | Decision | Reason |
| --- | --- | --- |
| Test | Keep | Required PR gate: frontend/Rust validation on Windows and Linux package smoke coverage. |
| Publish Margin | Keep and extend | Required signed Windows, Apple Silicon macOS, and Linux publication path. |

There are no redundant workflows to remove. The two workflows serve distinct validation and publication purposes; their different triggers are intentional.

## Trigger and permission review

### Test

- **Triggers:** pull requests, pushes to `main` and `master`, and `workflow_dispatch`.
- **Permissions:** `contents: read` only.
- **Jobs and platforms:** `test` runs on `windows-latest` and executes the frontend/native test suite, frontend build, Rust formatting check, and Cargo check. `linux-package` runs on `ubuntu-22.04` and builds Debian and AppImage packages without signing.
- **Recent-run evidence:** the most recent completed Test run succeeded on 2026-08-07 (run `31192486629`, push to `main`). A successful manual-dispatch run also completed the same day (run `31191110956`), confirming the recovery path is active.

### Publish Margin

- **Triggers:** pushes of tags matching `v*` and `workflow_dispatch`.
- **Permissions:** `contents: write`, required by the release action to create or update the draft GitHub release and attach artifacts.
- **Jobs and platforms:** the `publish` matrix runs on `windows-latest`, `macos-latest` with the `aarch64-apple-darwin` target, and `ubuntu-22.04` (Debian and AppImage bundles). It uses the Tauri release action with the repository token and Tauri signing key; macOS uses the configured ad-hoc signing identity.
- **Recent-run evidence:** the most recent completed Publish Margin run succeeded on 2026-08-07 (run `31192509554`, tag `v0.3.2`).

## Changes made from this audit

- Keep `workflow_dispatch` on Test as the outage recovery path.
- Retain pull-request validation, including Windows frontend/Rust checks and Linux package smoke coverage.
- Retain the tag-triggered three-platform release path for Windows, Apple Silicon macOS, and Linux.
- Add the release-artifact verification gate described in Task 4.
- Do not broaden workflow permissions or introduce a new third-party action.

## Constraint confirmation

This audit preserves all required safeguards: PR validation remains in Test; tag-triggered three-platform release remains in Publish Margin; and manual recovery dispatch remains available on both workflows. It proposes neither broader permissions nor a new third-party action.

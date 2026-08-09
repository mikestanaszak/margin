# Security and Cleanliness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict Margin's desktop file and plugin authority, secure CI inputs, remove confirmed dead code, and make all supported validation gates pass.

**Architecture:** Tauri starts with no global asset-file scope and grants access only to canonical selected-library directories or the parent directories of Markdown files explicitly opened by the operating system. Production and development CSPs are separated, capabilities are assigned per window, and repeatable tests enforce the configuration. Cleanup remains behavior-neutral and is guarded by the existing test suites plus strict lint and advisory scans.

**Tech Stack:** Tauri 2, Rust 2021, React 18, TypeScript 5, Vitest, pnpm, GitHub Actions.

## Global Constraints

- Keep user notes as portable UTF-8 `.md` files with optional YAML front matter.
- Do not introduce a database or store user notes in the repository.
- Use typed Tauri command boundaries and preserve existing user-facing errors.
- Run repository commands through Windows Command Prompt and use pnpm.
- Leave `PRODUCT_SPEC.md` unchanged because no documented product behavior changes.
- Preserve the user's interrupted rebase in `C:\Users\mfsta\Documents\notable-replacement` untouched.

---

### Task 1: Add failing security-configuration tests

**Files:**
- Create: `scripts/security-config.test.ts`

**Interfaces:**
- Consumes: JSON configuration in `src-tauri/tauri.conf.json` and `src-tauri/capabilities/*.json`; workflow YAML as text.
- Produces: Vitest assertions that prevent reintroducing production development sources, global asset globs, excessive window permissions, or mutable action tags.

- [ ] **Step 1: Write configuration regression tests**

Create tests that load repository files from `import.meta.url` and assert:

```ts
expect(security.assetProtocol.scope).toEqual([]);
expect(security.csp).not.toMatch(/unsafe-eval|localhost:1420|ws:\/\/localhost:1420/);
expect(security.devCsp).toMatch(/localhost:1420/);
expect(defaultCapability.permissions).toEqual(["core:default"]);
expect(desktopCapability.permissions).toEqual([
  "dialog:allow-open",
  "updater:allow-check",
  "updater:allow-download-and-install",
  "process:allow-restart",
]);
expect(workflowText).not.toMatch(/uses:\s+[^\s#]+@(v\d+|stable)\b/);
```

- [ ] **Step 2: Verify the tests fail for the intended reasons**

Run: `pnpm test scripts/security-config.test.ts`

Expected: FAIL because the current asset scope is global, production CSP contains development allowances, capabilities are broad, and actions use mutable tags.

- [ ] **Step 3: Commit only the failing tests**

```cmd
git add -- scripts\security-config.test.ts
git commit -m "Add security configuration regression tests"
```

### Task 2: Scope local assets at runtime

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `tauri::Manager::asset_protocol_scope()`, canonical selected-library paths, and canonical OS-opened Markdown paths.
- Produces: `markdown_asset_directory(path: &Path) -> Option<PathBuf>` and `allow_asset_directory(app: &AppHandle, directory: &Path) -> Result<(), String>`.

- [ ] **Step 1: Add the failing Rust path test**

Add a unit test that creates a Markdown file and a non-Markdown file, then proves only the Markdown file yields its canonical parent directory:

```rust
assert_eq!(
    markdown_asset_directory(&note),
    Some(fs::canonicalize(&library).unwrap())
);
assert_eq!(markdown_asset_directory(&not_markdown), None);
assert_eq!(markdown_asset_directory(&missing), None);
```

- [ ] **Step 2: Verify the Rust test fails because the helper is absent**

Run: `cargo test --manifest-path src-tauri\Cargo.toml markdown_assets_are_scoped_to_explicit_note_directories`

Expected: FAIL with an unresolved `markdown_asset_directory` import.

- [ ] **Step 3: Implement canonical runtime asset grants**

Implement the helper and register scopes at every authority-establishing boundary:

```rust
fn markdown_asset_directory(path: &Path) -> Option<PathBuf> {
    let canonical = fs::canonicalize(path).ok()?;
    (canonical.is_file() && is_markdown_path(&canonical))
        .then(|| canonical.parent().map(Path::to_path_buf))
        .flatten()
}

fn allow_asset_directory(app: &AppHandle, directory: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(directory, true)
        .map_err(|error| format!("Could not allow note images: {error}"))
}
```

Call `allow_asset_directory` after canonicalizing a saved or loaded selected library. Canonicalize startup/open-event Markdown paths, allow each explicit note parent, and then enqueue the canonical strings.

- [ ] **Step 4: Verify the focused Rust test passes**

Run: `cargo test --manifest-path src-tauri\Cargo.toml markdown_assets_are_scoped_to_explicit_note_directories`

Expected: PASS.

- [ ] **Step 5: Commit the runtime boundary**

```cmd
git add -- src-tauri\src\lib.rs
git commit -m "Scope Markdown assets to approved directories"
```

### Task 3: Harden CSP and window capabilities

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/capabilities/desktop.json`

**Interfaces:**
- Consumes: runtime asset grants from Task 2.
- Produces: empty static asset scope, production-only CSP, Vite-specific `devCsp`, shared core permission, and main-window-only plugin permissions.

- [ ] **Step 1: Replace static scope and split CSP**

Set `assetProtocol.scope` to `[]`. Keep production `connect-src` limited to `'self' ipc: http://ipc.localhost`; set production `script-src` to `'self'`; move `http://localhost:1420`, `ws://localhost:1420`, and `'unsafe-eval'` into `devCsp`.

- [ ] **Step 2: Apply least-privilege capabilities**

Set `default.json` to both windows with only `core:default`. Set `desktop.json` to the main window with exactly:

```json
[
  "dialog:allow-open",
  "updater:allow-check",
  "updater:allow-download-and-install",
  "process:allow-restart"
]
```

- [ ] **Step 3: Verify the configuration portion of the test passes**

Run: `pnpm test scripts/security-config.test.ts`

Expected: only the mutable GitHub Action assertions remain failing.

- [ ] **Step 4: Commit configuration hardening**

```cmd
git add -- src-tauri\tauri.conf.json src-tauri\capabilities\default.json src-tauri\capabilities\desktop.json
git commit -m "Reduce desktop security permissions"
```

### Task 4: Remove dead frontend code and dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/components/index.ts`
- Modify: `src/components/ViewModeControl.tsx`
- Modify: `src/components/view-layout.test.tsx`
- Modify: `src/components/navigation-qol.tsx`
- Modify: `src/components/navigation-qol.test.tsx`

**Interfaces:**
- Consumes: production imports from `src/main.tsx`.
- Produces: a barrel exposing only `NoteListItem`, `QuickSwitcher`, `ResizableSplit`, and `ViewModeControl`; no frontend global-shortcut package; no test-only UI components.

- [ ] **Step 1: Remove the unused package through pnpm**

Run: `pnpm remove @tauri-apps/plugin-global-shortcut`

Expected: `package.json` and `pnpm-lock.yaml` no longer contain the frontend package; the Rust plugin remains unchanged.

- [ ] **Step 2: Remove unused barrel exports**

Reduce `src/components/index.ts` to:

```ts
export { ResizableSplit } from "./ResizableSplit";
export { ViewModeControl } from "./ViewModeControl";
export { NoteListItem, QuickSwitcher } from "./navigation-qol";
```

- [ ] **Step 3: Remove test-only components and their tests**

Delete `FocusModeToggle` and `FocusModeToggleProps` from `ViewModeControl.tsx`, delete `TagCombobox` and `TagComboboxProps` from `navigation-qol.tsx`, and remove their dedicated harness/test cases while preserving all tests for production-used components and helpers.

- [ ] **Step 4: Verify frontend behavior**

Run: `pnpm test`

Expected: all remaining frontend tests pass.

- [ ] **Step 5: Verify unused-code scans**

Run: `pnpm dlx knip --no-progress`

Expected: exit 0 with no unused dependencies, exports, exported types, or duplicate exports.

Run: `pnpm dlx depcheck --json`

Expected: exit 0 with empty `dependencies`, `devDependencies`, and `missing` collections.

- [ ] **Step 6: Commit frontend cleanup**

```cmd
git add -- package.json pnpm-lock.yaml src\components\index.ts src\components\ViewModeControl.tsx src\components\view-layout.test.tsx src\components\navigation-qol.tsx src\components\navigation-qol.test.tsx
git commit -m "Remove unused frontend code"
```

### Task 5: Make strict Rust linting clean

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: existing `NoteDocument`, `SaveNoteFailure`, and note-sorting behavior.
- Produces: behavior-equivalent code accepted by `cargo clippy --all-targets --all-features -- -D warnings`.

- [ ] **Step 1: Apply the six mechanical Clippy fixes**

Use a character array for `trim_start_matches`, `sort_by_key` with `Reverse`, `repeat_n`, and box the conflict document:

```rust
enum SaveNoteFailure {
    Conflict(Box<NoteDocument>),
    Error(String),
}
```

Construct conflicts with `Box::new(disk)` and move the document back out with `*disk` when producing `SaveNoteResult::Conflict`.

- [ ] **Step 2: Format and run strict Clippy**

Run: `cargo fmt --manifest-path src-tauri\Cargo.toml`

Run: `cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets --all-features -- -D warnings`

Expected: exit 0 with no diagnostics.

- [ ] **Step 3: Run Rust tests**

Run: `cargo test --manifest-path src-tauri\Cargo.toml`

Expected: all tests pass.

- [ ] **Step 4: Commit lint cleanup**

```cmd
git add -- src-tauri\src\lib.rs
git commit -m "Resolve strict Rust lint findings"
```

### Task 6: Pin CI actions and add security gates

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: existing Windows/Linux build jobs and release matrix.
- Produces: immutable action references, npm production audit, strict Clippy, and RustSec audit.

- [ ] **Step 1: Pin every action reference**

Use these reviewed revisions with version comments:

```yaml
actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa # v4
dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c # stable
tauri-apps/tauri-action@944946e3e4cac6603d1fe8f514171e9ecd3c78aa # v1
rustsec/audit-check@69366f33c96575abad1ee0dba8212993eecbe998 # v2.0.0
```

- [ ] **Step 2: Add validation gates**

Add `pnpm audit --prod --audit-level=low` and strict Clippy to the Windows test job. Add a separate Ubuntu RustSec job with `contents: read`, `checks: write`, the GitHub token, and `working-directory: src-tauri`.

- [ ] **Step 3: Verify security-configuration tests are fully green**

Run: `pnpm test scripts/security-config.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit CI hardening**

```cmd
git add -- .github\workflows\test.yml .github\workflows\release.yml scripts\security-config.test.ts
git commit -m "Harden continuous integration inputs"
```

### Task 7: Final verification, review, and delivery

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-security-cleanliness-hardening.md` only to check completed steps if needed.

**Interfaces:**
- Consumes: all prior commits.
- Produces: a reviewed branch, draft PR, green GitHub checks, and merged PR.

- [ ] **Step 1: Run the full frontend validation**

Run: `pnpm test`

Run: `pnpm build`

Run: `pnpm audit --prod --audit-level=low`

- [ ] **Step 2: Run the full Rust validation**

Run: `cargo fmt --manifest-path src-tauri\Cargo.toml --all -- --check`

Run: `cargo test --manifest-path src-tauri\Cargo.toml`

Run: `cargo check --manifest-path src-tauri\Cargo.toml`

Run: `cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets --all-features -- -D warnings`

Run the temporary `cargo-audit` binary against `src-tauri\Cargo.lock`; expect no vulnerabilities and only the documented upstream Tauri/GTK warnings.

- [ ] **Step 3: Run cleanliness and diff checks**

Run: `pnpm dlx knip --no-progress`

Run: `pnpm dlx depcheck --json`

Run: `git diff --check origin/main...HEAD`

Inspect: `git status --short`, `git diff --stat origin/main...HEAD`, and `git diff origin/main...HEAD`.

- [ ] **Step 4: Push and create one draft PR**

Push `audit/security-cleanliness`, verify no matching PR exists, then create one draft PR targeting `main` with user-visible changes, validation commands, and the upstream RustSec warning note.

- [ ] **Step 5: Wait for GitHub checks and merge**

Monitor the PR until every required check passes. Address any validated failure test-first, push the fix, and recheck. Mark the PR ready if needed, merge it without force-pushing, and report the merged PR URL and commit.

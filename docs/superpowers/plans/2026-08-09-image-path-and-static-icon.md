# Image Path and Static Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render encoded local image paths correctly and use one green application icon regardless of theme or palette.

**Architecture:** Decode React Markdown's URL-encoded local image path once at the preview boundary, then pass the resulting native path through the existing Tauri asset protocol. Remove the frontend-to-native palette icon update path and regenerate every packaged platform icon from the original green SVG.

**Tech Stack:** React, TypeScript, Vitest, Tauri 2, Rust, Tauri icon generator.

## Global Constraints

- Keep note images as normal files in sibling `<note>.assets` directories.
- Do not change remote, data, or existing asset URL behavior.
- Use one static green Margin icon on every platform and for every palette.
- Run frontend and native suites sequentially during final verification.

---

### Task 1: Decode local Markdown image paths

**Files:**
- Modify: `src/main.test.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: React Markdown image `src` strings after URL transformation.
- Produces: a decoded native filesystem path passed to `convertFileSrc(path: string)`.

- [ ] **Step 1: Write the failing regression test**

Add a Markdown preview case using `![image](<Meeting Notes — Kickoff.assets/image.png>)`, the Windows note path `C:\Notes\Work\Meeting Notes — Kickoff.md`, and the literal expected call `C:\Notes\Work\Meeting Notes — Kickoff.assets\image.png`.

- [ ] **Step 2: Verify the test fails for double encoding**

Run: `pnpm exec vitest run src/main.test.tsx`

Expected: FAIL because `convertFileSrc` receives `%20` and `%E2%80%94` in the filesystem path.

- [ ] **Step 3: Decode exactly once at the local-image boundary**

Before separator conversion, use guarded `decodeURIComponent(src)` for local URLs. If decoding throws on a malformed escape, retain the original string.

- [ ] **Step 4: Verify the preview test passes**

Run: `pnpm exec vitest run src/main.test.tsx`

Expected: PASS with the decoded Windows path.

### Task 2: Revert theme-dependent icons

**Files:**
- Modify: `src/main.test.tsx`
- Modify: `src/main.tsx`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/icons/app-icon.svg`
- Regenerate: `src-tauri/icons/**`
- Modify: `PRODUCT_SPEC.md`

**Interfaces:**
- Consumes: theme and palette settings for UI colors only.
- Produces: one packaged green icon with no runtime palette-icon command.

- [ ] **Step 1: Change the frontend behavior test first**

Change the appearance-switch test to assert that no `set_runtime_palette_icon` invocation occurs after changing appearance.

- [ ] **Step 2: Verify the test fails**

Run: `pnpm exec vitest run src/main.test.tsx`

Expected: FAIL because the current effect still invokes `set_runtime_palette_icon`.

- [ ] **Step 3: Remove runtime icon swapping**

Keep theme/palette DOM attributes and persistence, but remove the frontend invocation. Remove `runtime_icon_bytes`, `set_runtime_palette_icon`, the macOS AppKit icon helper/imports, command registration, and the obsolete Rust palette-icon test.

- [ ] **Step 4: Restore and regenerate the green packaged icon**

Restore the green `app-icon.svg` colors (`#246747`, `#fffdf7`, `#d8ebdd`, `#d7f0dc`) and run `pnpm tauri icon src-tauri/icons/app-icon.svg`.

- [ ] **Step 5: Update the product contract**

State in `PRODUCT_SPEC.md` that Margin uses one packaged green icon and palette changes do not change it.

### Task 3: Release verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Bump the patch version and changelog**

Set all app versions to `0.4.6` and document both fixes under `0.4.6 — 2026-08-09`.

- [ ] **Step 2: Run sequential verification**

Run, in order: `pnpm test`, `pnpm build`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `git diff --check`.

- [ ] **Step 3: Publish only after CI passes**

Commit the exact files, push the branch, open one pull request, wait for all required checks, merge, tag `v0.4.6`, wait for signed release artifacts, verify the Windows installer, and publish the release.

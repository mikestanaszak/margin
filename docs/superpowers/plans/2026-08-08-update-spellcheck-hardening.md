# Update and spell-check hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Margin's existing explicit update-restart flow, enforce edit-only native spell check, and keep GitHub Actions lean while validating release artifacts before publication.

**Architecture:** The React app owns update state and calls Tauri plugins only at its boundary; a small exported helper makes restart state transitions unit-testable. CodeMirror continues to rely on the platform webview for spelling dictionaries, with its editable DOM attribute asserted in tests. A standalone Node validator consumes GitHub release JSON and `latest.json`, while a final release-workflow job uses it only after all platform bundles upload.

**Tech Stack:** React 18, TypeScript, Vitest, CodeMirror 6, Tauri 2 updater/process plugins, Node.js ESM, GitHub Actions.

## Global Constraints

- Preserve daily automatic update discovery and the Settings manual check.
- Never download, install, restart, or publish a release without an explicit user/release action.
- Support Windows, Apple Silicon macOS, and x64 Linux release artifacts.
- Native spelling uses the operating-system webview only; add no cloud service, dictionary manager, or setting.
- Use Windows Command Prompt and pnpm for repository commands.
- Do not modify the user's detached `PRODUCT_SPEC.md` conflict; this branch starts from clean `origin/main`.

---

### Task 1: Audit current GitHub Actions and record the keep/consolidate/remove decision

**Files:**
- Create: `docs/workflow-audit-2026-08-08.md`
- Inspect: `.github/workflows/test.yml`
- Inspect: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the two existing workflow YAML files and recent GitHub Actions run history.
- Produces: a concise documented verdict for every current workflow/job that Task 4 follows.

- [ ] **Step 1: Capture the current workflow inventory and recent-run evidence**

Run:

```cmd
dir /b .github\workflows
gh run list --repo mikestanaszak/margin --limit 20
```

Record each workflow's triggers, permissions, jobs, supported platforms, and its most recent successful or cancelled result.

- [ ] **Step 2: Write the audit with an explicit decision for every workflow**

Create `docs/workflow-audit-2026-08-08.md` with this structure:

```markdown
# GitHub Actions audit — 2026-08-08

## Decision summary

| Workflow | Decision | Reason |
| --- | --- | --- |
| Test | Keep | Required PR gate: frontend/Rust validation on Windows and Linux package smoke coverage. |
| Release | Keep and extend | Required signed Windows, Apple Silicon macOS, and Linux publication path. |

## Trigger and permission review

...

## Changes made from this audit

- Keep `workflow_dispatch` on Test as the outage recovery path.
- Add the release-artifact verification gate described in Task 4.
```

State explicitly if there are no redundant workflows to remove; do not remove a workflow merely because it has a different trigger from another.

- [ ] **Step 3: Review the audit against the global constraints**

Confirm the document preserves all three safeguards: PR validation, tag-triggered three-platform release, and manual recovery dispatch. Confirm it does not propose broader permissions or a new third-party action.

- [ ] **Step 4: Commit the audit**

```cmd
git add -- docs/workflow-audit-2026-08-08.md
git commit -m "Audit GitHub Actions workflows"
```

### Task 2: Make the existing update restart flow resilient and testable

**Files:**
- Modify: `src/main.tsx:91-100, 373-384, 1835-1844, 2840-2905`
- Modify: `src/main.test.tsx`

**Interfaces:**
- Consumes: `relaunch(): Promise<void>` from `@tauri-apps/plugin-process` and the existing `UpdateState` union.
- Produces: exported `UpdateState`, `restartInstalledUpdate(relaunchApp, setState, setError): Promise<void>`, and an `UpdateDialog` that represents `ready` and `restarting` states.

- [ ] **Step 1: Write failing unit tests for restart state transitions**

In `src/main.test.tsx`, mock the Tauri process module and import the exported helper. Add one success and one failure test:

```ts
it("marks an installed update as restarting only after the user chooses restart", async () => {
  const states: UpdateState[] = [];
  const errors: string[] = [];
  const relaunchApp = vi.fn().mockResolvedValue(undefined);

  await restartInstalledUpdate(relaunchApp, (state) => states.push(state), (error) => errors.push(error));

  expect(relaunchApp).toHaveBeenCalledOnce();
  expect(states).toEqual(["restarting"]);
  expect(errors).toEqual([""]);
});

it("returns to ready and reports a restart failure", async () => {
  const states: UpdateState[] = [];
  const errors: string[] = [];
  const relaunchApp = vi.fn().mockRejectedValue(new Error("permission denied"));

  await restartInstalledUpdate(relaunchApp, (state) => states.push(state), (error) => errors.push(error));

  expect(states).toEqual(["restarting", "ready"]);
  expect(errors.at(-1)).toContain("Could not restart Margin");
});
```

Also render `UpdateDialog` in `ready` and `restarting` states. Assert **Restart Margin** is enabled in `ready`, changes to **Restarting Margin…** and is disabled in `restarting`.

- [ ] **Step 2: Run the focused test file and verify the new tests fail for missing behavior**

Run:

```cmd
pnpm test -- src/main.test.tsx
```

Expected: FAIL because `restartInstalledUpdate` and the `restarting` dialog behavior do not exist.

- [ ] **Step 3: Implement the minimum restart helper and wire it to App**

In `src/main.tsx`, export the extended state union and add the exported helper:

```ts
export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "error";

export async function restartInstalledUpdate(
  relaunchApp: () => Promise<void>,
  setState: (state: UpdateState) => void,
  setError: (message: string) => void,
): Promise<void> {
  setState("restarting");
  setError("");
  try {
    await relaunchApp();
  } catch (error) {
    setState("ready");
    setError(`Could not restart Margin: ${String(error)}`);
  }
}
```

Replace the inline `void relaunch()` callback with `void restartInstalledUpdate(relaunch, setUpdateState, setUpdateError)`. In `UpdateDialog`, derive `restarting` from state, display a restarting status, and disable the primary restart button while it is active. Preserve the existing user-click-only install and skip behavior.

- [ ] **Step 4: Run the focused test file and verify it passes**

Run:

```cmd
pnpm test -- src/main.test.tsx
```

Expected: PASS, including the new restart success/failure and dialog-state assertions.

- [ ] **Step 5: Commit the update hardening**

```cmd
git add -- src/main.tsx src/main.test.tsx
git commit -m "Harden update restart flow"
```

### Task 3: Enforce native spell check for editable notes only

**Files:**
- Modify: `src/MarkdownEditor.tsx:309-326`
- Modify: `src/MarkdownEditor.test.ts`

**Interfaces:**
- Consumes: `MarkdownEditorProps.spellCheck?: boolean` and `readOnly?: boolean`.
- Produces: a CodeMirror `.cm-content` element with `spellcheck="true"` only when the editor is editable and spell check is enabled.

- [ ] **Step 1: Write failing DOM assertions for editable and read-only editors**

Add this test in `src/MarkdownEditor.test.ts`:

```ts
it("enables native spell check only for editable notes", () => {
  const editable = render(
    createElement(MarkdownEditor, {
      notePath: "editable.md",
      value: "A misspelled note",
      onChange: vi.fn(),
    }),
  );
  expect(editable.container.querySelector(".cm-content")).toHaveAttribute("spellcheck", "true");
  editable.unmount();

  const readOnly = render(
    createElement(MarkdownEditor, {
      notePath: "outside.md",
      value: "Read-only note",
      onChange: vi.fn(),
      readOnly: true,
    }),
  );
  expect(readOnly.container.querySelector(".cm-content")).toHaveAttribute("spellcheck", "false");
});
```

- [ ] **Step 2: Run the focused editor test and verify the read-only assertion fails**

Run:

```cmd
pnpm test -- src/MarkdownEditor.test.ts
```

Expected: FAIL because the current fixed editor extension sets spellcheck to `true` even when `readOnly` is true.

- [ ] **Step 3: Make the content attribute explicitly edit-only**

Replace the existing `spellcheck` content attribute with:

```ts
spellcheck: !readOnly && spellCheck ? "true" : "false",
```

Do not add any new setting or dictionary dependency. Preview stays outside this component and therefore remains free of editable spell-check DOM.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```cmd
pnpm test -- src/MarkdownEditor.test.ts
```

Expected: PASS with both editable and read-only assertions.

- [ ] **Step 5: Commit the spell-check boundary**

```cmd
git add -- src/MarkdownEditor.tsx src/MarkdownEditor.test.ts
git commit -m "Test edit-only spell check"
```

### Task 4: Validate release artifacts and update the release workflow

**Files:**
- Create: `scripts/verify-release-assets.mjs`
- Create: `scripts/verify-release-assets.test.ts`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `--tag <vX.Y.Z> --release <release.json> --latest <latest.json>` CLI arguments.
- Produces: exit code `0` only when the release assets and updater manifest match the versioned, three-platform contract; otherwise writes one missing/mismatched requirement per line to stderr and exits `1`.

- [ ] **Step 1: Write failing validator tests with release fixtures**

Create `scripts/verify-release-assets.test.ts`, import `validateReleaseAssets` from the ESM validator, and define a complete fixture with these names for tag `v0.3.2`:

```ts
[
  "Margin_0.3.2_x64-setup.exe",
  "Margin_0.3.2_x64-setup.exe.sig",
  "Margin_0.3.2_aarch64.dmg",
  "Margin_0.3.2_aarch64.app.tar.gz",
  "Margin_0.3.2_aarch64.app.tar.gz.sig",
  "Margin_0.3.2_amd64.deb",
  "Margin_0.3.2_amd64.deb.sig",
  "Margin_0.3.2_amd64.AppImage",
  "Margin_0.3.2_amd64.AppImage.sig",
  "latest.json",
]
```

Assert that the complete fixture and `{ version: "0.3.2", platforms: { ... } }` manifest return `[]`. Add separate tests that remove the macOS signature, remove the Linux AppImage, and provide `{ version: "0.3.1" }`; each must return a diagnostic containing the missing asset or version mismatch.

- [ ] **Step 2: Run the validator tests and verify they fail because the module is absent**

Run:

```cmd
pnpm test -- scripts/verify-release-assets.test.ts
```

Expected: FAIL with a module-not-found error for `scripts/verify-release-assets.mjs`.

- [ ] **Step 3: Implement the pure validator and CLI wrapper**

Export this public function from `scripts/verify-release-assets.mjs`:

```js
export function validateReleaseAssets(tag, assetNames, latestManifest) {
  const version = tag.replace(/^v/, "");
  const required = [
    `Margin_${version}_x64-setup.exe`,
    `Margin_${version}_x64-setup.exe.sig`,
    `Margin_${version}_aarch64.dmg`,
    `Margin_${version}_aarch64.app.tar.gz`,
    `Margin_${version}_aarch64.app.tar.gz.sig`,
    `Margin_${version}_amd64.deb`,
    `Margin_${version}_amd64.deb.sig`,
    `Margin_${version}_amd64.AppImage`,
    `Margin_${version}_amd64.AppImage.sig`,
    "latest.json",
  ];
  const names = new Set(assetNames);
  const errors = required.filter((name) => !names.has(name)).map((name) => `Missing release asset: ${name}`);
  if (latestManifest.version !== version) errors.push(`Updater manifest version ${latestManifest.version} does not match ${version}`);
  return errors;
}
```

Parse the three CLI arguments, read the JSON files, call the function with `release.assets.map((asset) => asset.name)`, print errors with `console.error`, and set `process.exitCode = 1` only when errors exist.

- [ ] **Step 4: Add a final release-validation job after the publish matrix**

Modify `.github/workflows/release.yml` to add `verify-release` with `needs: publish`, `runs-on: ubuntu-22.04`, and read-only contents permission. Its steps must:

```yaml
- uses: actions/checkout@v4
- name: Read draft release metadata
  env:
    GH_TOKEN: ${{ github.token }}
  run: gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${GITHUB_REF_NAME}" > release.json
- name: Download updater manifest
  env:
    GH_TOKEN: ${{ github.token }}
  run: gh release download "${GITHUB_REF_NAME}" --pattern latest.json --dir release-assets
- name: Verify published artifact contract
  run: node scripts/verify-release-assets.mjs --tag "${GITHUB_REF_NAME}" --release release.json --latest release-assets/latest.json
```

Do not change `releaseDraft: true`; the workflow must still produce a draft for the release owner to publish deliberately.

- [ ] **Step 5: Run validator tests and review workflow syntax**

Run:

```cmd
pnpm test -- scripts/verify-release-assets.test.ts
git diff --check
```

Expected: PASS. Confirm `verify-release` depends on the entire three-platform `publish` matrix and has no `contents: write` permission.

- [ ] **Step 6: Commit the release gate**

```cmd
git add -- scripts/verify-release-assets.mjs scripts/verify-release-assets.test.ts .github/workflows/release.yml
git commit -m "Validate release artifacts before publication"
```

### Task 5: Integrate and validate the completed hardening work

**Files:**
- Modify if needed: `CHANGELOG.md`
- Inspect: `PRODUCT_SPEC.md`, `.github/workflows/test.yml`, `.github/workflows/release.yml`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: a green feature branch whose documented behavior matches the product spec and release process.

- [ ] **Step 1: Update product documentation only when behavior changed**

Review `PRODUCT_SPEC.md` against the final implementation. If its update and spell-check descriptions already match the shipped behavior, leave it unchanged. Add a concise Unreleased entry to `CHANGELOG.md` only if the repository maintains one; otherwise do not invent a release version before release planning.

- [ ] **Step 2: Run the complete local verification suite**

Run:

```cmd
pnpm build
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all commands pass with no formatting changes required.

- [ ] **Step 3: Perform the desktop smoke checks**

Run:

```cmd
pnpm tauri dev
```

In the native app, manually confirm that an editable note offers operating-system spell check, Preview is not editable, and the update dialog only exposes **Restart Margin** after an explicit **Update now** operation. Stop the development app after the smoke check.

- [ ] **Step 4: Commit any documentation-only integration change**

If Step 1 changed documentation:

```cmd
git add -- CHANGELOG.md PRODUCT_SPEC.md
git commit -m "Document update hardening"
```

If Step 1 made no change, do not create an empty commit.

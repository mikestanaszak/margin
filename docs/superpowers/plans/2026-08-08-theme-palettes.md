# Theme Palettes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ink, Mint, and Linen palettes that work with existing System, Light, and Dark appearances, and update running desktop icons where supported.

**Architecture:** A small frontend palette module owns known identifiers, local-storage fallback, and root attributes. CSS maps palette/appearance combinations to semantic tokens. Settings exposes a swatch picker and calls one native command after a palette change. Rust accepts only known values and uses compiled-in PNGs to update windows on Windows/macOS, while Linux returns success without changing its packaged icon.

**Tech Stack:** React, TypeScript, CSS custom properties, Vitest, Tauri 2, Rust.

## Global Constraints

- Keep Markdown notes and library metadata untouched; preferences live in local storage.
- Mint is the default palette for absent or invalid stored data.
- System/Light/Dark behavior must remain independent from palette selection.
- Linux must keep the bundle icon and treat runtime icon switching as a no-op.
- Use only Mint, Ink, and Linen identifiers across the frontend-native boundary.

---

### Task 1: Palette preference boundary

**Files:**
- Create: `src/theme-palettes.ts`
- Create: `src/theme-palettes.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces `type Palette = "ink" | "mint" | "linen"`, `paletteStorageKey`, `loadPalette()`, and `paletteOptions`.
- `App` consumes `Palette`, stores it in React state, and writes `document.documentElement.dataset.palette`.

- [ ] **Step 1: Write the failing tests**

```ts
it("falls back to Mint for absent or invalid saved palettes", () => {
  expect(loadPalette(null)).toBe("mint");
  expect(loadPalette("violet")).toBe("mint");
});

it("accepts each shipped palette", () => {
  expect(paletteOptions.map(({ id }) => id)).toEqual(["ink", "mint", "linen"]);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- src/theme-palettes.test.ts`

Expected: FAIL because `theme-palettes.ts` does not exist.

- [ ] **Step 3: Implement the minimal preference module and App wiring**

```ts
export type Palette = "ink" | "mint" | "linen";
export const paletteStorageKey = "margin.palette";
export function loadPalette(value: string | null): Palette {
  return value === "mint" || value === "linen" || value === "ink" ? value : "mint";
}
```

Initialize App state from `loadPalette(localStorage.getItem(paletteStorageKey))`; persist it and set the root `data-palette` attribute in an effect next to the existing theme effect.

- [ ] **Step 4: Verify green**

Run: `pnpm test -- src/theme-palettes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```cmd
git add -- src/theme-palettes.ts src/theme-palettes.test.ts src/main.tsx
git commit -m "Add palette preference state"
```

### Task 2: Palette tokens and Settings picker

**Files:**
- Modify: `src/styles.css`
- Modify: `src/main.tsx`
- Modify: `src/main.test.tsx`

**Interfaces:**
- Consumes `Palette`, `paletteOptions`, `palette`, and `onPalette` from Task 1.
- Produces a `PalettePicker` control in `SettingsDialog` and complete token selectors for Ink, Mint, Linen, light, dark, and system-dark appearances.

- [ ] **Step 1: Write the failing UI tests**

```tsx
it("changes the palette immediately from Settings", async () => {
  render(<App />);
  await userEvent.click(screen.getByLabelText("Settings"));
  await userEvent.click(screen.getByRole("radio", { name: "Linen" }));
  expect(document.documentElement.dataset.palette).toBe("linen");
});
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm test -- src/main.test.tsx`

Expected: FAIL because Settings has no palette radio control.

- [ ] **Step 3: Implement the picker and token matrix**

Add an accessible `fieldset` labelled Palette below Appearance. Each palette is a radio button with a real color swatch, label, selected state, and immediate `onPalette` call. Add CSS semantic tokens for `:root[data-palette="ink"]`, `mint`, and `linen`, then pair them with `data-theme="dark"` and the existing system-dark media query. Keep every existing selector consuming semantic variables rather than hard-coded palette colors.

- [ ] **Step 4: Verify green**

Run: `pnpm test -- src/main.test.tsx`

Expected: PASS, including the new picker test and existing appearance/Mermaid tests.

- [ ] **Step 5: Commit**

```cmd
git add -- src/main.tsx src/main.test.tsx src/styles.css
git commit -m "Add palette picker and theme tokens"
```

### Task 3: Best-effort runtime desktop icons

**Files:**
- Create: `src-tauri/icons/runtime/ink.png`
- Create: `src-tauri/icons/runtime/mint.png`
- Create: `src-tauri/icons/runtime/linen.png`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes the Task 1 `Palette` value and invokes `set_runtime_palette_icon({ palette })`.
- Produces a native command that rejects unknown values, returns success on Linux, and updates every open Margin window on Windows/macOS.

- [ ] **Step 1: Write failing native tests**

```rust
#[test]
fn runtime_palette_icon_accepts_only_shipped_palettes() {
    assert!(runtime_icon_bytes("ink").is_ok());
    assert!(runtime_icon_bytes("mint").is_ok());
    assert!(runtime_icon_bytes("linen").is_ok());
    assert!(runtime_icon_bytes("violet").is_err());
}
```

- [ ] **Step 2: Verify the test fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime_palette_icon_accepts_only_shipped_palettes`

Expected: FAIL because `runtime_icon_bytes` does not exist.

- [ ] **Step 3: Implement minimal native behavior**

Create 512px PNG variants from the existing Margin mark; configure Mint as the static bundle icon. Enable Tauri PNG image support. Implement `runtime_icon_bytes(palette)` with `include_bytes!` assets, then `set_runtime_palette_icon` to set each webview window icon on Windows/macOS. Use `#[cfg(target_os = "linux")]` to return `Ok(())` without applying an icon. In App's palette effect, invoke the command and swallow failures so visual preference persistence never fails.

- [ ] **Step 4: Verify green**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime_palette_icon_accepts_only_shipped_palettes`

Expected: PASS.

- [ ] **Step 5: Commit**

```cmd
git add -- src-tauri/icons/runtime src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/tauri.conf.json src/main.tsx
git commit -m "Update runtime icon for selected palette"
```

### Task 4: Product and release completion

**Files:**
- Modify: `PRODUCT_SPEC.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md` if it contains a theme feature list
- Test: `src/theme-palettes.test.ts`, `src/main.test.tsx`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes all completed palette behavior.
- Produces accurate shipped-product and release documentation.

- [ ] **Step 1: Write a failing documentation assertion only if test infrastructure already checks this text**

Do not add a documentation-only test suite. Existing behavioral coverage from Tasks 1-3 is the test gate.

- [ ] **Step 2: Update user documentation**

Move theme palettes from Planned to shipped behavior, state that Ink/Mint/Linen work with System/Light/Dark, and state the Windows/macOS runtime icon behavior with Linux's packaged-icon exception. Add the release's user-visible changes to `CHANGELOG.md` only when its version is chosen.

- [ ] **Step 3: Run the full validation suite**

Run:

```cmd
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform native smoke checks**

Run `pnpm tauri dev` on Windows and macOS. Confirm each palette changes immediately, appearance selection still follows System/Light/Dark, Mint/Ink/Linen persist after relaunch, and Windows/macOS update running icons without breaking Settings. Confirm Linux remains usable with its static bundle icon.

- [ ] **Step 5: Commit and prepare PR**

```cmd
git add -- PRODUCT_SPEC.md CHANGELOG.md README.md
git commit -m "Document theme palettes"
```

## Plan self-review

- Scope coverage: Tasks 1-3 cover palette persistence, token matrix, accessible settings UI, compiled runtime icons, platform policy, and fallback behavior. Task 4 covers product/release documentation and validation.
- No placeholders: every behavior, command, test target, identifier, and platform rule is explicit.
- Type consistency: `Palette` uses only `ink | mint | linen` across App state, Settings, CSS attributes, invocation, and Rust validation.

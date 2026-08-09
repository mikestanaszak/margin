# Editor Images, Discoverability, and Paper Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image insertion discoverable and reliable, conceal managed asset directories from navigation, improve feature documentation and code-fence completion contrast, and add a tan Paper palette.

**Architecture:** Keep image file persistence in the existing Rust commands. Extend the React editor's input normalization so the native bridge receives a real image `File` from both browser-style and desktop-style data transfer APIs. The library snapshot remains the single source for navigation, filtering companion directories before the UI receives them.

**Tech Stack:** React 18, TypeScript, CodeMirror 6, Vitest, Tauri 2, Rust, CSS custom properties.

## Global Constraints

- Note files remain portable UTF-8 Markdown; image files remain in adjacent `<note>.assets` folders.
- The Rust import command remains the authority for image type and 25 MB validation.
- Unmanaged/external notes never expose image insertion actions.
- Do not intercept ordinary text pastes or non-image drops.
- Keep image lifecycle behavior for rename, move, trash, restore, and permanent delete unchanged.

---

### Task 0: Make Mermaid preview tests deterministic

**Files:**
- Modify: `src/main.test.tsx`
- Test: `src/MermaidDiagram.test.tsx`

**Interfaces:**
- The broad Markdown preview suite consumes a deterministic Mermaid diagram test double and verifies that Mermaid fences reach it with their unmodified source.
- The dedicated Mermaid diagram suite uses a deterministic `mermaid` module mock and is responsible for renderer queueing, malformed-diagram fallback, strict-renderer output handling, and light/dark regeneration.

- [ ] **Step 1: Write a focused preview integration assertion that only verifies Mermaid fences mount the diagram component**

```tsx
vi.mock("./MermaidDiagram", () => ({
  default: ({ source }: { source: string }) => <figure role="img" aria-label="Mermaid diagram">{source}</figure>,
}));
```

- [ ] **Step 2: Run the full frontend suite and record the pre-change timeout under concurrent test load**

Run: `pnpm test`

- [ ] **Step 3: Isolate the preview suite from the heavyweight Mermaid renderer**

Mock only `MermaidDiagram` in `src/main.test.tsx`; move renderer-specific assertions to `src/MermaidDiagram.test.tsx` and extend its existing controlled module mock to resolve valid SVG or reject malformed source. Do not change production Mermaid loading, rendering, queueing, or test timeouts.

- [ ] **Step 4: Run the complete frontend suite twice and commit**

Run: `pnpm test && pnpm test`

### Task 1: Normalize editor image input and toolbar placement

**Files:**
- Modify: `src/MarkdownEditor.tsx`
- Test: `src/MarkdownEditor.test.ts`

**Interfaces:**
- Produces `imageFileFromDataTransfer(dataTransfer: DataTransfer | null): File | null` for drop input.
- Produces `imageFileFromClipboard(clipboardData: DataTransfer | null): File | null` for pasted image data.
- Consumes `onImageFile(file, source)` and `onInsertImage()` props without changing their public signatures.

- [ ] **Step 1: Write failing editor tests**

```ts
it("passes a desktop image drop with an empty MIME type to the importer", () => {
  const onImageFile = vi.fn();
  const { container } = render(createElement(MarkdownEditor, { notePath: "note.md", value: "", onChange: vi.fn(), onImageFile }));
  fireEvent.drop(container.querySelector(".cm-content")!, { dataTransfer: { files: [new File(["image"], "photo.png", { type: "" })] } });
  expect(onImageFile).toHaveBeenCalledWith(expect.objectContaining({ name: "photo.png" }), "drop");
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because empty-MIME files are ignored**

Run: `pnpm test -- src/MarkdownEditor.test.ts`

- [ ] **Step 3: Add minimal input normalization and move the Image button**

```ts
function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}
```

Use clipboard items' `getAsFile()` when the file list contains no image. Render the Image button directly after the existing table button inside `markdown-editor-toolbar`; remove the standalone editor button.

- [ ] **Step 4: Add tests for clipboard-item images, ordinary text paste pass-through, and Image-after-Table ordering**

- [ ] **Step 5: Run focused editor tests and commit**

Run: `pnpm test -- src/MarkdownEditor.test.ts`

### Task 2: Filter companion asset directories in the native index

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `is_managed_asset_directory(path: &Path) -> bool` used by `WalkDir::filter_entry`.
- Keeps markdown files inside normal folders indexed and all `<note>.assets` directory paths out of `LibrarySnapshot.folders`.

- [ ] **Step 1: Write a failing snapshot test**

```rust
#[test]
fn library_snapshot_omits_note_asset_directories() {
    // Create Project.md, Project.assets/photo.png, and Projects/Plan.assets/photo.png.
    // Assert neither asset directory nor a child is present in snapshot.folders.
}
```

- [ ] **Step 2: Run the targeted Rust test and confirm asset folders are currently returned**

Run: `cargo test --manifest-path src-tauri/Cargo.toml library_snapshot_omits_note_asset_directories`

- [ ] **Step 3: Filter only managed asset directory names during traversal**

```rust
.filter_entry(|entry| {
    entry.file_name() != ".markdown-notes" && !is_managed_asset_directory(entry.path())
})
```

- [ ] **Step 4: Run the targeted Rust test and related lifecycle tests; format and commit**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`

### Task 3: Add Paper palette and readable completion colors

**Files:**
- Modify: `src/theme-palettes.ts`
- Modify: `src/theme-palettes.test.ts`
- Modify: `src/styles.css`
- Modify: `src/MarkdownEditor.tsx`
- Modify: `src/MarkdownEditor.test.ts`
- Create: `src-tauri/icons/runtime/paper.png`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Extends `Palette` to include `"paper"` and `paletteOptions` with `{ id: "paper", label: "Paper" }`.
- Extends `runtime_icon_bytes` to map `"paper"` to the shipped Paper PNG and updates every visible webview window's native toolbar/title-bar icon on supported platforms.
- Uses CSS custom properties for completion foreground, panel background, selected-row background, and detail text.

- [ ] **Step 1: Write failing palette and completion-style tests**

```ts
expect(loadPalette("paper")).toBe("paper");
expect(paletteOptions.map(({ id }) => id)).toContain("paper");
expect(editorCompletionTheme[".cm-tooltip-autocomplete"]).toMatchObject({ color: "var(--completion-foreground)" });
```

- [ ] **Step 2: Run the targeted tests and confirm Paper is rejected and completion styles are absent**

Run: `pnpm test -- src/theme-palettes.test.ts src/MarkdownEditor.test.ts`

- [ ] **Step 3: Implement the palette, runtime icon, and CodeMirror completion theme**

Define tan light and dark Paper tokens alongside Mint, Ink, and Linen. Use distinct, accessible foreground/background/selection/detail colors in the CodeMirror extension so all palettes inherit their values. Add a Paper runtime PNG matching the existing icon dimensions and native mapping. Trace the existing window, tray, and application-icon branches and extend the platform-specific update path only where it does not update the visible toolbar/title-bar icon.

- [ ] **Step 4: Run focused TypeScript and Rust palette tests; commit**

Run: `pnpm test -- src/theme-palettes.test.ts src/MarkdownEditor.test.ts && cargo test --manifest-path src-tauri/Cargo.toml runtime_palette_icon_accepts_only_shipped_palettes`

### Task 4: Document feature locations and backlinks

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT_SPEC.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Documents the exact `[[Note title]]` inbound-link condition for `Linked from`.
- Documents edit toolbar placement, image imports, hidden asset directories, and the Paper palette.

- [ ] **Step 1: Add a readable Feature tour section to README**

Include short subsections for editing and preview tools, image input, links/backlinks, navigation, capture/templates, and settings/themes. State that image folders are companion folders not shown in navigation.

- [ ] **Step 2: Update the product behavior and release notes**

Describe Paper, completion contrast, and image editor input behavior in the product spec and unreleased/release entry.

- [ ] **Step 3: Review prose against implementation and commit**

Run: `git diff --check`

### Task 5: Audit, package, and release

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run complete automated verification**

Run: `pnpm test`, `pnpm build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.

- [ ] **Step 2: Manually audit the desktop flow**

Use `pnpm tauri dev` with a managed note. Verify picker, empty-MIME desktop file drag/drop, image paste, normal text paste, toolbar placement, hidden `.assets` folder, rendered preview, Paper light/dark palette, autocomplete readability, and a visible native icon change after each palette selection for the main and capture windows.

- [ ] **Step 3: Bump the patch release and commit**

Update all application version sources and add a dated `CHANGELOG.md` entry describing user-visible changes.

- [ ] **Step 4: Push a protected-branch PR, merge after required checks, tag, and publish the release**

Verify the attached release assets and updater manifest before changing the GitHub draft to published.

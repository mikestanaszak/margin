# Table, outline, and roadmap triage

## Scope

Address the two open bug reports, then document the remaining open feature
requests as upcoming work:

- #25: Keep the preview table-editor control correctly positioned and legible
  on macOS.
- #26: Keep the outline and document synchronized after an outline heading is
  clicked in a long note.
- #27–#31: Record themes, edit-mode spell check, code-fence autocomplete,
  code-block copy controls, and Mermaid diagrams in `PRODUCT_SPEC.md`.

The existing AI-agent roadmap and code-fence-autocomplete roadmap entries are
both retained when resolving the current product-spec conflict.

## Approach

Use the existing preview/table and outline-scroll components rather than adding
new panels or global state:

1. Make the table-editor trigger a table-scoped overlay with stable inset and
   stacking rules, so macOS WebKit does not collapse it into a table corner.
2. Route outline-heading clicks through the same active-section/scroll
   coordinator that handles editor scrolling. The target heading becomes active
   immediately, then normal scroll observation keeps the outline aligned.
3. Keep feature requests as concise planned bullets only; they do not alter
   current runtime behavior.

## Error handling and compatibility

- The table control remains keyboard reachable and does not obstruct table
  content until the table is hovered or focused.
- A missing or stale heading target is a no-op rather than a failed scroll.
- Long-note scrolling avoids writing selection state or triggering unnecessary
  preview recomputation.
- The product-spec conflict resolution preserves both lines before adding the
  new issue-derived roadmap items.

## Verification

- Add focused regression coverage for the table control's preview layout and
  outline click synchronization in a long note.
- Run `pnpm build`, `pnpm test`, and `cargo test --manifest-path
  src-tauri/Cargo.toml`.
- Manually exercise the two affected preview flows in Tauri on Windows; CI
  continues to package Linux as the cross-platform build guard.

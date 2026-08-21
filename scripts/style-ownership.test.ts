import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const readStyle = (path: string) => readFileSync(path, "utf8");

describe("style ownership", () => {
  test("keeps app composition separate from feature presentation", () => {
    const shared = readStyle("src/styles.css");
    const app = readStyle("src/app/app.css");
    const library = readStyle("src/features/library/library.css");
    const preview = readStyle("src/features/preview/preview.css");
    const settings = readStyle("src/features/settings/settings.css");

    expect(shared).not.toContain(".app-shell");
    expect(app).not.toMatch(/\.sidebar\s*\{|\.preview\s*\{|\.settings-dialog\s*\{|\.capture-card\s*\{/);
    expect(library).toContain(".sidebar");
    expect(preview).toContain(".preview");
    expect(preview).toContain(".table-editor-grid");
    expect(settings).toContain(".settings-dialog");
    expect(settings).not.toContain(".table-editor-dialog");
  });

  test("preserves the final-effective feature declarations", () => {
    const app = readStyle("src/app/app.css");
    const preview = readStyle("src/features/preview/preview.css");

    expect(preview).toContain(
      ".preview .hljs-keyword, .preview .hljs-selector-tag, .preview .hljs-literal { color: #ff7b72; }",
    );
    expect(preview).toContain(
      ".table-column-actions { position: absolute; top: 6px; right: 4px; display: flex; gap: 1px; }",
    );
    expect(preview).toContain(
      ".table-row-action { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 29px; min-width: 29px !important; padding: 3px 0 !important; background: var(--surface-soft); }",
    );
    expect(preview.match(/\.table-row-action \{/g)).toHaveLength(1);
    expect(preview).toContain(".table-row-action button { position: static; }");
    expect(app).toContain(".compare { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }");
  });

  test("keeps fenced code aligned with normal preview content", () => {
    const preview = readStyle("src/features/preview/preview.css");

    expect(preview).toContain(".preview pre { margin: 1.5em 0; padding: 15px 17px;");
    expect(preview).not.toMatch(/\.preview-code-block pre\s*\{[^}]*padding-top/);
  });
});

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
    expect(preview).toContain(".preview .hljs-keyword");
    expect(preview).toContain(".table-column-actions");
    expect(preview).toContain(".table-drag-handle");
    expect(settings).toContain(".settings-dialog");
    expect(settings).not.toContain(".table-editor-dialog");
    expect(app).toContain(".compare");
  });
});

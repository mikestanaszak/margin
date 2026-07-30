import { describe, expect, it } from "vitest";
import {
  clamp,
  fileStem,
  formatShortcut,
  hasUnsavedChanges,
  matchesShortcut,
  nativeShortcut,
  normalizedKey,
  parseMarkdownTables,
  replaceMarkdownTable,
  splitTableCells,
  titleFromBody,
  toggleTask,
  wikiTargets,
} from "./note-utils";

describe("note identity and navigation helpers", () => {
  it("uses the first level-one heading as the title", () => {
    expect(titleFromBody("intro\n# Canonical title\n# Later title")).toBe("Canonical title");
    expect(titleFromBody("## Not a title")).toBe("Untitled");
    expect(fileStem("C:\\Notes\\Café.md")).toBe("Café");
    expect(fileStem("/notes/README.MD")).toBe("README");
  });

  it("finds wiki-link targets while ignoring aliases", () => {
    expect(wikiTargets("[[Project Alpha]] and [[Café Notes|the café]]")).toEqual([
      "Project Alpha",
      "Café Notes",
    ]);
  });

  it("detects every persisted field that can be dirty", () => {
    const original = { path: "a.md", title: "A", body: "# A", tags: ["one", "two"] };
    expect(hasUnsavedChanges(original, { ...original })).toBe(false);
    expect(hasUnsavedChanges({ ...original, body: "# A\nchanged" }, original)).toBe(true);
    expect(hasUnsavedChanges({ ...original, tags: ["two", "one"] }, original)).toBe(true);
    expect(hasUnsavedChanges(original, null)).toBe(true);
  });
});

describe("keyboard shortcuts", () => {
  it("matches the key and the exact modifier set", () => {
    const matching = new KeyboardEvent("keydown", {
      key: "P",
      code: "KeyP",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(matchesShortcut(matching, "ctrl+shift+p")).toBe(true);
    expect(matchesShortcut(matching, "ctrl+p")).toBe(false);
    expect(matchesShortcut(matching, "meta+shift+p")).toBe(false);
  });

  it("normalizes Space and converts bindings for the native plugin", () => {
    expect(normalizedKey({ key: " ", code: "Space" })).toBe("space");
    expect(nativeShortcut("ctrl+alt+shift+space")).toBe("Control+Alt+Shift+Space");
    expect(nativeShortcut("ctrl+\\")).toBe("Control+Backslash");
    expect(formatShortcut("ctrl+shift+p")).toContain("P");
  });
});

describe("interactive Markdown transformations", () => {
  it("toggles only the requested task across bullet and numbered lists", () => {
    const markdown = "- [ ] first\n* [x] second\n1. [X] third\nplain [ ] text";
    expect(toggleTask(markdown, 1, false)).toBe(
      "- [ ] first\n* [ ] second\n1. [X] third\nplain [ ] text",
    );
    expect(toggleTask(markdown, 2, true)).toContain("1. [x] third");
    expect(toggleTask(markdown, 99, true)).toBe(markdown);
  });

  it("parses tables, alignment dividers, and escaped pipes", () => {
    expect(splitTableCells("| Name | A\\|B |")).toEqual(["Name", "A|B"]);
    const markdown = [
      "Before",
      "| Name | Status |",
      "| :--- | ---: |",
      "| Margin | Ready |",
      "",
      "| Key | Value |",
      "| --- | --- |",
      "| one | two |",
    ].join("\n");
    expect(parseMarkdownTables(markdown)).toEqual([
      { start: 1, end: 4, headers: ["Name", "Status"], rows: [["Margin", "Ready"]] },
      { start: 5, end: 8, headers: ["Key", "Value"], rows: [["one", "two"]] },
    ]);
  });

  it("replaces one table and safely escapes edited cell content", () => {
    const markdown = "# Plan\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter";
    expect(
      replaceMarkdownTable(markdown, 0, ["Name", "Notes"], [["Margin", "a|b\nnext"]]),
    ).toBe("# Plan\n\n| Name | Notes |\n| --- | --- |\n| Margin | a\\|b next |\n\nAfter");
    expect(replaceMarkdownTable(markdown, 3, [], [])).toBe(markdown);
  });
});

describe("layout bounds", () => {
  it("clamps sidebar values", () => {
    expect(clamp(100, 180, 520)).toBe(180);
    expect(clamp(700, 180, 520)).toBe(520);
    expect(clamp(320, 180, 520)).toBe(320);
  });
});

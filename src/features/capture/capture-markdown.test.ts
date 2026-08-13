import { describe, expect, it } from "vitest";
import { captureMarkdownEdit } from "./capture-markdown";

describe("quick capture Markdown assistance", () => {
  it("continues lists and tasks, exits an empty marker, and indents with Tab", () => {
    expect(captureMarkdownEdit("- First", 7, 7, "Enter")).toEqual({
      value: "- First\n- ",
      selectionStart: 10,
      selectionEnd: 10,
    });
    expect(captureMarkdownEdit("- [x] Done", 10, 10, "Enter")).toEqual({
      value: "- [x] Done\n- [ ] ",
      selectionStart: 17,
      selectionEnd: 17,
    });
    expect(captureMarkdownEdit("3. Third", 8, 8, "Enter")).toEqual({
      value: "3. Third\n4. ",
      selectionStart: 12,
      selectionEnd: 12,
    });
    expect(captureMarkdownEdit("- ", 2, 2, "Enter")).toEqual({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    expect(captureMarkdownEdit("- Child", 7, 7, "Tab")).toEqual({
      value: "  - Child",
      selectionStart: 9,
      selectionEnd: 9,
    });
    expect(captureMarkdownEdit("  - Child", 9, 9, "Tab", true)).toEqual({
      value: "- Child",
      selectionStart: 7,
      selectionEnd: 7,
    });
  });
});

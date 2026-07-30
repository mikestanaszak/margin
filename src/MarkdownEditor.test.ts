import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyHeading,
  captureViewState,
  insertLink,
  insertTable,
  selectionFromSaved,
  wrapSelection,
} from "./MarkdownEditor";

const views: EditorView[] = [];

function editor(doc: string, anchor = 0, head = anchor) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
});

describe("Markdown editor formatting", () => {
  it("wraps, unwraps, and preserves the selected text", () => {
    const view = editor("Make Margin calm", 5, 11);
    wrapSelection(view, "**");
    expect(view.state.doc.toString()).toBe("Make **Margin** calm");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "Margin",
    );
    wrapSelection(view, "**");
    expect(view.state.doc.toString()).toBe("Make Margin calm");
  });

  it("inserts a Markdown link with its cursor in the URL", () => {
    const view = editor("Open Margin", 5, 11);
    insertLink(view);
    expect(view.state.doc.toString()).toBe("Open [Margin]()");
    expect(view.state.selection.main.head).toBe(14);
  });

  it("applies headings to every selected line", () => {
    const view = editor("First\n### Second", 0, 16);
    applyHeading(view, 2);
    expect(view.state.doc.toString()).toBe("## First\n## Second");
  });

  it("inserts bounded tables without joining surrounding prose", () => {
    const view = editor("BeforeAfter", 6);
    insertTable(view, 2, 2);
    expect(view.state.doc.toString()).toBe(
      "Before\n\n| Column 1 | Column 2 |\n| --- | --- |\n|   |   |\n|   |   |\n\nAfter",
    );
    expect(view.state.selection.main.head).toBe(10);
  });
});

describe("editor view-state restoration", () => {
  it("captures scroll and clamps restored selections after external edits", () => {
    const view = editor("0123456789", 8, 10);
    view.scrollDOM.scrollTop = 120;
    const saved = captureViewState(view);
    const restored = selectionFromSaved(saved, 4);
    expect(restored.main.anchor).toBe(4);
    expect(restored.main.head).toBe(4);
    expect(saved.scrollTop).toBe(120);
  });
});

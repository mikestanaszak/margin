import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import {
  applyHeading,
  captureViewState,
  insertLink,
  insertTable,
  MarkdownEditor,
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

function editorWithHistory(doc: string) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history({ minDepth: 500, newGroupDelay: 300 })],
    }),
  });
  views.push(view);
  return view;
}

function appendText(view: EditorView, text: string, time: number) {
  const position = view.state.doc.length;
  view.dispatch({
    changes: { from: position, insert: text },
    annotations: [Transaction.userEvent.of("input.type"), Transaction.time.of(time)],
  });
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

  it("does not apply formatting shortcuts to read-only documents", () => {
    const onChange = vi.fn();
    const { container } = render(
      createElement(MarkdownEditor, {
        notePath: "outside.md",
        value: "Read-only external note",
        onChange,
        readOnly: true,
      }),
    );
    const content = container.querySelector<HTMLElement>(".cm-content");
    expect(content).not.toBeNull();

    fireEvent.keyDown(content!, { key: "b", ctrlKey: true });

    expect(content).toHaveTextContent("Read-only external note");
    expect(onChange).not.toHaveBeenCalled();
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

describe("editor undo history", () => {
  it("keeps many distinct typing operations available to undo", () => {
    const view = editorWithHistory("");
    appendText(view, "first", 1_000);
    appendText(view, " second", 1_400);
    appendText(view, " third", 1_800);

    expect(undoDepth(view.state)).toBe(3);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("first second");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("first");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
  });
});

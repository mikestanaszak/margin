import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import {
  CompletionContext,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { all as highlightLanguages, createLowlight } from "lowlight";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, createRef } from "react";
import {
  applyHeading,
  captureViewState,
  closeCodeFence,
  exitEmptyListItem,
  insertLink,
  insertTable,
  MarkdownEditor,
  type MarkdownEditorHandle,
  codeFenceLanguageCompletions,
  selectionFromSaved,
  wrapSelection,
} from "./MarkdownEditor";
import { isMac } from "./platform";

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

async function languageCompletions(doc: string) {
  const state = EditorState.create({ doc });
  return await codeFenceLanguageCompletions(
    new CompletionContext(state, doc.length, true),
  );
}

describe("code-fence language autocomplete", () => {
  it("suggests supported Highlight.js names and aliases after an opening fence", async () => {
    const result = await languageCompletions("```typ");

    expect(result).not.toBeNull();
    expect(result?.from).toBe(3);
    expect(result?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(["typescript", "ts"]),
    );
  });

  it("keeps a custom fence identifier completable", async () => {
    const result = await languageCompletions("```futurelang");

    expect(result).not.toBeNull();
    expect(result?.from).toBe(3);
  });

  it("only suggests language identifiers Highlight.js supports", async () => {
    const result = await languageCompletions("```");
    const highlighter = createLowlight(highlightLanguages);

    expect(result?.options.filter(({ label }) => !highlighter.registered(label))).toEqual([]);
  });

  it.each([
    "typescript",
    "```typescript\nconst value = 1",
    "Text ```typescript",
    "    ```typescript",
  ])("does not suggest languages outside a fence language position: %j", async (doc) => {
    expect(await languageCompletions(doc)).toBeNull();
  });

  it("dismisses language completion and indents when Tab is pressed", async () => {
    const editorRef = createRef<MarkdownEditorHandle>();
    const { container } = render(
      createElement(MarkdownEditor, {
        ref: editorRef,
        notePath: "tab.md",
        value: "```ts",
        onChange: vi.fn(),
      }),
    );
    const view = editorRef.current?.getView();
    const content = container.querySelector<HTMLElement>(".cm-content");
    expect(view).toBeDefined();
    expect(content).not.toBeNull();

    act(() => {
      view?.dispatch({ selection: { anchor: 5 } });
      if (view) startCompletion(view);
    });
    await waitFor(() => expect(completionStatus(view!.state)).toBe("active"));

    fireEvent.keyDown(content!, { key: "Tab" });

    expect(view?.state.doc.toString()).toBe("  ```ts");
    expect(completionStatus(view!.state)).toBeNull();
  });
});

describe("Markdown editor formatting", () => {
  it("highlights Markdown syntax while editing", () => {
    const { container } = render(
      createElement(MarkdownEditor, {
        notePath: "highlight.md",
        value: "# Heading\n\nSome **bold** text",
        onChange: vi.fn(),
      }),
    );
    const highlighted = Array.from(
      container.querySelectorAll(".cm-line span[class]"),
      (span) => span.textContent,
    );
    // Highlighted tokens are wrapped in generated classes; plain text is not.
    expect(highlighted).toEqual(expect.arrayContaining([" Heading", "bold"]));
    expect(highlighted).not.toContain("Some ");
  });

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

  it("toggles italic with asterisks without disturbing bold", () => {
    const word = editor("unbelievable", 2, 10);
    wrapSelection(word, "*");
    expect(word.state.doc.toString()).toBe("un*believab*le");

    const bold = editor("**bold**", 2, 6);
    wrapSelection(bold, "*");
    expect(bold.state.doc.toString()).toBe("***bold***");
    wrapSelection(bold, "*");
    expect(bold.state.doc.toString()).toBe("**bold**");

    const wholeBold = editor("**bold**", 0, 8);
    wrapSelection(wholeBold, "*");
    expect(wholeBold.state.doc.toString()).toBe("***bold***");

    const both = editor("***both***", 3, 7);
    wrapSelection(both, "**");
    expect(both.state.doc.toString()).toBe("*both*");
  });

  it("closes a new code fence on Enter, but not one that is already closed", () => {
    const open = editor("Intro\n  ~~~js", 13);
    expect(closeCodeFence(open)).toBe(true);
    expect(open.state.doc.toString()).toBe("Intro\n  ~~~js\n  \n  ~~~");
    expect(open.state.selection.main.head).toBe(16);

    const closed = editor("```\ncode\n```", 3);
    expect(closeCodeFence(closed)).toBe(false);
    expect(closeCodeFence(editor("```\ncode\n```", 12))).toBe(false);
  });

  it("ends a list with a blank line when Enter is pressed on an empty item", () => {
    const view = editor("- one\n- two\n- ", 14);
    expect(exitEmptyListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n- two\n\n");
    expect(view.state.selection.main.head).toBe(13);

    expect(exitEmptyListItem(editor("- ", 2))).toBe(false);
    expect(exitEmptyListItem(editor("- one\n  - ", 10))).toBe(false);
    expect(exitEmptyListItem(editor("- one\n- two", 11))).toBe(false);
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

  it("inserts a table after selected text instead of replacing it", () => {
    const view = editor("Keep this text", 5, 9);
    insertTable(view, 1, 1);
    expect(view.state.doc.toString()).toBe(
      "Keep this\n\n| Column 1 |\n| --- |\n|   |\n\n text",
    );
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

  it("applies italic, bold, and link shortcuts ahead of default bindings", () => {
    const editorRef = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = render(
      createElement(MarkdownEditor, {
        ref: editorRef,
        notePath: "format.md",
        value: "Make Margin calm",
        onChange,
      }),
    );
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    const view = editorRef.current!.getView()!;
    const press = (key: string) =>
      fireEvent.keyDown(content, { key, ctrlKey: !isMac, metaKey: isMac });
    const bubbledToWindow = vi.fn();
    window.addEventListener("keydown", bubbledToWindow);

    try {
      act(() => view.dispatch({ selection: { anchor: 5, head: 11 } }));
      press("i");
      expect(view.state.doc.toString()).toBe("Make *Margin* calm");
      press("b");
      expect(view.state.doc.toString()).toBe("Make ***Margin*** calm");
      press("k");
      expect(view.state.doc.toString()).toContain("[Margin]()");
    } finally {
      window.removeEventListener("keydown", bubbledToWindow);
    }
    expect(bubbledToWindow).not.toHaveBeenCalled();
  });

  it("keeps the primary Select All shortcut inside the editable note", () => {
    const editorRef = createRef<MarkdownEditorHandle>();
    const { container } = render(
      createElement(MarkdownEditor, {
        ref: editorRef,
        notePath: "select-all.md",
        value: "First line\nSecond line",
        onChange: vi.fn(),
      }),
    );
    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = editorRef.current?.getView();
    const bubbledToWindow = vi.fn();
    window.addEventListener("keydown", bubbledToWindow);

    try {
      fireEvent.keyDown(content!, {
        key: "a",
        ctrlKey: !isMac,
        metaKey: isMac,
      });
    } finally {
      window.removeEventListener("keydown", bubbledToWindow);
    }

    expect(view?.state.selection.main.from).toBe(0);
    expect(view?.state.selection.main.to).toBe(view?.state.doc.length);
    expect(bubbledToWindow).not.toHaveBeenCalled();
  });

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

  it("imports a desktop image drop when the file MIME type is unavailable", () => {
    const onImageFile = vi.fn();
    const { container } = render(
      createElement(MarkdownEditor, {
        notePath: "editable.md",
        value: "",
        onChange: vi.fn(),
        onImageFile,
      }),
    );
    const image = new File(["image"], "photo.png", { type: "" });
    const content = container.querySelector<HTMLElement>(".cm-content");

    fireEvent.drop(content!, { dataTransfer: { files: [image] } });

    expect(onImageFile).toHaveBeenCalledWith(image, "drop");
  });

  it("imports an image from a clipboard item", () => {
    const onImageFile = vi.fn();
    const { container } = render(
      createElement(MarkdownEditor, {
        notePath: "editable.md",
        value: "",
        onChange: vi.fn(),
        onImageFile,
      }),
    );
    const image = new File(["image"], "", { type: "" });
    const content = container.querySelector<HTMLElement>(".cm-content");

    fireEvent.paste(content!, {
      clipboardData: {
        files: [],
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image,
          },
        ],
      },
    });

    expect(onImageFile).toHaveBeenCalledWith(image, "paste");
  });

  it("imports a clipboard image when the item MIME type is unavailable", () => {
    const onImageFile = vi.fn();
    const { container } = render(
      createElement(MarkdownEditor, {
        notePath: "editable.md",
        value: "",
        onChange: vi.fn(),
        onImageFile,
      }),
    );
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const content = container.querySelector<HTMLElement>(".cm-content");

    fireEvent.paste(content!, {
      clipboardData: {
        files: [],
        items: [
          {
            kind: "file",
            type: "",
            getAsFile: () => image,
          },
        ],
      },
    });

    expect(onImageFile).toHaveBeenCalledWith(image, "paste");
  });

  it("keeps Image out of the selection toolbar", async () => {
    const editorRef = createRef<MarkdownEditorHandle>();
    const { container } = render(
      createElement(MarkdownEditor, {
        ref: editorRef,
        notePath: "editable.md",
        value: "Select this text",
        onChange: vi.fn(),
      }),
    );

    const host = container.querySelector<HTMLElement>("[data-note-path='editable.md']");
    const view = editorRef.current?.getView();
    expect(host).not.toBeNull();
    expect(view).toBeDefined();
    vi.spyOn(host!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 400, 200),
    );
    vi.spyOn(view!, "coordsAtPos").mockReturnValue({
      top: 60,
      bottom: 72,
      left: 180,
      right: 190,
    });

    act(() => {
      view?.dispatch({ selection: { anchor: 0, head: 6 } });
    });

    await waitFor(() =>
      expect(container.querySelector(".markdown-editor-toolbar")).not.toBeNull(),
    );
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".markdown-editor-toolbar button"),
    );
    expect(buttons.some((button) => button.textContent === "Image")).toBe(false);
  });
});

describe("editor view-state restoration", () => {
  it("keeps the selection and undo history when the note is renamed", () => {
    const editorRef = createRef<MarkdownEditorHandle>();
    const props = { ref: editorRef, onChange: vi.fn() };
    const { rerender } = render(
      createElement(MarkdownEditor, { ...props, notePath: "Trip.md", value: "# Trip" }),
    );
    const view = editorRef.current!.getView()!;
    act(() => {
      view.dispatch({ changes: { from: 6, insert: " to" }, selection: { anchor: 9 } });
    });
    rerender(
      createElement(MarkdownEditor, { ...props, notePath: "Trip to.md", value: "# Trip to" }),
    );
    expect(editorRef.current!.getView()).toBe(view);
    expect(view.state.selection.main.head).toBe(9);
    expect(undoDepth(view.state)).toBe(1);
  });

  it("applies external text changes without moving the cursor", () => {
    const editorRef = createRef<MarkdownEditorHandle>();
    const props = { ref: editorRef, onChange: vi.fn(), notePath: "a.md" };
    const { rerender } = render(
      createElement(MarkdownEditor, { ...props, value: "![x](<A.assets/x.png>)\nEnd" }),
    );
    const view = editorRef.current!.getView()!;
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    rerender(
      createElement(MarkdownEditor, { ...props, value: "![x](<Longer.assets/x.png>)\nEnd" }),
    );
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(props.onChange).not.toHaveBeenCalled();
  });

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

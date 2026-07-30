import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: vi.fn() }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "test", hide: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));
const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import {
  CascadingNoteOptions,
  ConflictDialog,
  MarkdownPreview,
  QuickCaptureDialog,
  SettingsDialog,
  TableEditorDialog,
  activeOutlineAncestors,
  outlineTree,
} from "./main";

const notes = [
  {
    path: "C:/Notes/Work/Project Alpha.md",
    title: "Project Alpha",
    tags: ["work"],
    updated: 1,
    searchable_text: "project alpha",
    excerpt: "",
    folder: "Work",
  },
  {
    path: "C:/Notes/Personal/Café ideas.md",
    title: "Café ideas",
    tags: ["personal"],
    updated: 2,
    searchable_text: "café ideas",
    excerpt: "",
    folder: "Personal",
  },
];

describe("Markdown preview", () => {
  it("renders GFM and routes wiki and relative Markdown links inside the library", () => {
    const onOpen = vi.fn();
    const onEditTable = vi.fn();
    const onToggleTask = vi.fn();
    const markdown = [
      "# Project Alpha",
      "",
      "Open [[Café ideas|the café]] or [the same note](../Personal/Caf%C3%A9%20ideas.md#ideas).",
      "",
      "Visit [Margin](https://example.com).",
      "",
      "![Diagram](diagram.png)",
      "",
      "- [ ] first task",
      "- [x] second task",
      "",
      "| Name | Status |",
      "| --- | --- |",
      "| Margin | Ready |",
      "",
      "```TypeScript",
      "const ready = true;",
      "```",
    ].join("\n");
    render(
      <MarkdownPreview
        markdown={markdown}
        notePath={notes[0].path}
        notes={notes}
        onOpen={onOpen}
        onEditTable={onEditTable}
        onToggleTask={onToggleTask}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "the café" }));
    fireEvent.click(screen.getByRole("link", { name: "the same note" }));
    expect(onOpen).toHaveBeenNthCalledWith(1, notes[1]);
    expect(onOpen).toHaveBeenNthCalledWith(2, notes[1]);
    fireEvent.click(screen.getByRole("link", { name: "Margin" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect(screen.getByRole("img", { name: "Diagram" })).toHaveAttribute(
      "src",
      "asset://C:/Notes/Work/diagram.png",
    );

    const tasks = screen.getAllByRole("checkbox");
    expect(tasks[0]).not.toBeChecked();
    expect(tasks[1]).toBeChecked();
    fireEvent.click(tasks[0]);
    expect(onToggleTask).toHaveBeenCalledWith(0, true);

    fireEvent.click(screen.getByRole("button", { name: "Edit table 1" }));
    expect(onEditTable).toHaveBeenCalledWith(0);
    expect(document.querySelector("code.language-typescript")).toBeInTheDocument();
  });

  it("leaves missing wiki links visible without attempting navigation", () => {
    const onOpen = vi.fn();
    render(
      <MarkdownPreview
        markdown="See [[Missing note]]."
        notePath={notes[0].path}
        notes={notes}
        onOpen={onOpen}
        onEditTable={() => undefined}
        onToggleTask={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "Missing note" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("table editor", () => {
  it("edits cells and adds or removes rows and columns before applying", () => {
    const onApply = vi.fn();
    render(
      <TableEditorDialog
        table={{ start: 0, end: 3, headers: ["Name", "Status"], rows: [["Margin", "Ready"]] }}
        onClose={() => undefined}
        onApply={onApply}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Header 1" }), {
      target: { value: "Product" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add column after 2" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Header 3" }), {
      target: { value: "Owner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add row after 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Row 2, column 1" }), {
      target: { value: "Companion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete column 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(onApply).toHaveBeenCalledWith(
      ["Product", "Owner"],
      [
        ["Margin", ""],
        ["Companion", ""],
      ],
    );
  });
});

describe("navigation structures and safety dialogs", () => {
  it("builds a heading hierarchy and identifies the active ancestors", () => {
    const items = [
      { index: 0, level: 1, title: "Title" },
      { index: 1, level: 2, title: "Section" },
      { index: 2, level: 3, title: "Detail" },
      { index: 3, level: 2, title: "Next" },
    ];
    const tree = outlineTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((node) => node.title)).toEqual(["Section", "Next"]);
    expect(tree[0].children[0].children[0].title).toBe("Detail");
    expect([...activeOutlineAncestors(items, 2)]).toEqual([1, 0]);
  });

  it("renders nested folders and notes as cascading destination options", () => {
    render(
      <select aria-label="Destination">
        <CascadingNoteOptions targets={notes} folders={["Work", "Work/Research", "Personal"]} />
      </select>,
    );
    expect(screen.getByRole("option", { name: /Work/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Project Alpha/ })).toHaveValue(notes[0].path);
    expect(screen.getByRole("option", { name: /Café ideas/ })).toHaveValue(notes[1].path);
  });

  it("keeps both external-conflict choices explicit", () => {
    const onChoose = vi.fn();
    const base = {
      ...notes[0],
      body: "# Project Alpha\nMine",
      revision: "mine",
    };
    render(
      <ConflictDialog
        conflict={{ mine: base, disk: { ...base, body: "# Project Alpha\nDisk", revision: "disk" } }}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByText("Your unsaved edits have not been overwritten. Choose which version to keep.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use disk version" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect(onChoose.mock.calls).toEqual([["disk"], ["mine"]]);
  });

  it("saves quick capture with Ctrl+Enter and cancels with Escape", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<QuickCaptureDialog shortcut="Ctrl+Alt+Shift+Space" onSave={onSave} onClose={onClose} />);
    const input = screen.getByRole("textbox");
    expect(screen.getByRole("button", { name: "Save capture" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "A captured thought" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith("A captured thought");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes settings with Escape while retaining a scrollable settings panel", () => {
    const onClose = vi.fn();
    render(<SettingsDialog theme="system" onTheme={() => undefined} shortcuts={{ newNote: "ctrl+n", search: "ctrl+k", switcher: "ctrl+p", save: "ctrl+s", view: "ctrl+e", sidebar: "ctrl+\\", outline: "ctrl+shift+o", quickCapture: "ctrl+alt+shift+space" }} onShortcuts={() => undefined} quickCaptureStatus="Ready" library="C:/Notes" quickImportTargets={notes} quickImportDefaultPath="" onQuickImportDefaultPath={() => undefined} updateState="idle" updateMessage="" onCheckForUpdates={() => undefined} onChangeLibrary={() => undefined} onClose={onClose} />);
    expect(screen.getByRole("button", { name: "Change library" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Settings" }).parentElement).toHaveClass("settings-backdrop");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

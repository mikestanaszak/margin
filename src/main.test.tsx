import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: vi.fn() }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "test", hide: vi.fn() }),
}));
const { eventHandlers, listen } = vi.hoisted(() => {
  const eventHandlers = new Map<
    string,
    (event: { payload: unknown }) => void
  >();
  const listen = vi.fn(
    async (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ) => {
      eventHandlers.set(eventName, handler);
      return () => {
        if (eventHandlers.get(eventName) === handler)
          eventHandlers.delete(eventName);
      };
    },
  );
  return { eventHandlers, listen };
});
vi.mock("@tauri-apps/api/event", () => ({
  listen,
}));
const { open } = vi.hoisted(() => ({
  open: vi.fn((): Promise<string | undefined> => Promise.resolve(undefined)),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open,
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}));
const { convertFileSrc, invoke } = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn((command: string) =>
    Promise.resolve(
      command === "take_opened_markdown_files"
        ? []
        : command === "load_selected_library"
          ? null
          : undefined,
    ),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc,
  invoke,
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));
vi.mock("./MermaidDiagram", () => ({
  default: ({ source }: { source: string }) => (
    <figure role="img" aria-label="Mermaid diagram" data-source={source}>
      {source}
    </figure>
  ),
}));

import {
  App,
  ConflictDialog,
  createRefreshCoordinator,
  QuickCaptureDialog,
  UpdateDialog,
  restartInstalledUpdate,
  type UpdateState,
} from "./app/App";
import {
  CascadingNoteOptions,
  FolderNoteTree,
  FolderTree,
} from "./features/library/LibraryNavigation";
import { MarkdownPreview } from "./features/preview/MarkdownPreview";
import {
  activeOutlineAncestors,
  outlineTree,
} from "./features/preview/Outline";
import { TableEditorDialog } from "./features/preview/TableDialogs";
import { SettingsDialog } from "./features/settings/SettingsDialog";

const notes = [
  {
    id: "project-alpha",
    path: "C:/Notes/Work/Project Alpha.md",
    title: "Project Alpha",
    tags: ["work"],
    updated: 1,
    searchable_text: "project alpha",
    excerpt: "",
    folder: "Work",
  },
  {
    id: "cafe-ideas",
    path: "C:/Notes/Personal/Café ideas.md",
    title: "Café ideas",
    tags: ["personal"],
    updated: 2,
    searchable_text: "café ideas",
    excerpt: "",
    folder: "Personal",
  },
];

describe("update restart", () => {
  it("marks an installed update as restarting only after the user chooses restart", async () => {
    const states: UpdateState[] = [];
    const errors: string[] = [];
    const relaunchApp = vi.fn().mockResolvedValue(undefined);

    await restartInstalledUpdate(
      relaunchApp,
      (state) => states.push(state),
      (error) => errors.push(error),
    );

    expect(relaunchApp).toHaveBeenCalledOnce();
    expect(states).toEqual(["restarting"]);
    expect(errors).toEqual([""]);
  });

  it("returns to ready and reports a restart failure", async () => {
    const states: UpdateState[] = [];
    const errors: string[] = [];
    const relaunchApp = vi.fn().mockRejectedValue(new Error("permission denied"));

    await restartInstalledUpdate(
      relaunchApp,
      (state) => states.push(state),
      (error) => errors.push(error),
    );

    expect(states).toEqual(["restarting", "ready"]);
    expect(errors[errors.length - 1]).toContain("Could not restart Margin");
  });

  it("shows a disabled restarting control while a relaunch is in progress", () => {
    const props = {
      update: { version: "0.4.0", body: "Restart improvements" } as never,
      error: "",
      onClose: () => undefined,
      onInstall: () => undefined,
      onRestart: () => undefined,
      onSkip: () => undefined,
    };
    const { rerender } = render(<UpdateDialog {...props} state="ready" />);

    expect(screen.getByRole("button", { name: "Restart Margin" })).toBeEnabled();

    rerender(<UpdateDialog {...props} state="restarting" />);

    expect(
      screen.getByRole("button", { name: "Restarting Margin…" }),
    ).toBeDisabled();
  });
});

describe("Markdown preview", () => {
  it("copies fenced code without adding a control to inline code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MarkdownPreview
        markdown={[
          "Use `inline code` in prose.",
          "",
          "```TypeScript",
          "const ready = true;",
          "```",
        ].join("\n")}
        notePath={notes[0].path}
        notes={notes}
        onOpen={vi.fn()}
        onEditTable={vi.fn()}
        onToggleTask={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Copy code" })).toHaveLength(1);
    expect(screen.getByText("inline code", { selector: "code" }).parentElement).not.toHaveClass(
      "preview-code-block",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("const ready = true;\n"),
    );
    expect(screen.getByRole("button", { name: "Code copied" })).toBeInTheDocument();
  });

  it("reports a failed fenced-code copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(
      <MarkdownPreview
        markdown={"```text\nprivate value\n```"}
        notePath={notes[0].path}
        notes={notes}
        onOpen={vi.fn()}
        onEditTable={vi.fn()}
        onToggleTask={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(
      await screen.findByRole("button", { name: "Could not copy code" }),
    ).toBeInTheDocument();
  });

  it("passes Mermaid fence source to the diagram renderer", () => {
    const source = "flowchart LR\n  Start --> Finish";
    render(
      <MarkdownPreview
        markdown={["```mermaid", source, "```"].join("\n")}
        notePath={notes[0].path}
        notes={notes}
        onOpen={() => undefined}
        onEditTable={() => undefined}
        onToggleTask={() => undefined}
      />,
    );

    expect(screen.getByRole("img", { name: "Mermaid diagram" })).toHaveAttribute(
      "data-source",
      source,
    );
  });

  it("uses a native Windows path for a note image", () => {
    convertFileSrc.mockClear();
    render(
      <MarkdownPreview
        markdown="![Diagram](Plan.assets/diagram.png)"
        notePath={"C:\\Notes\\Work\\Plan.md"}
        notes={[]}
        onOpen={() => undefined}
        onEditTable={() => undefined}
        onToggleTask={() => undefined}
      />,
    );

    expect(screen.getByRole("img", { name: "Diagram" })).toBeInTheDocument();
    expect(convertFileSrc).toHaveBeenCalledWith(
      "C:\\Notes\\Work\\Plan.assets\\diagram.png",
    );
  });

  it("decodes spaces and Unicode before resolving a Windows image path", () => {
    convertFileSrc.mockClear();
    render(
      <MarkdownPreview
        markdown="![image](<Meeting Notes — Kickoff.assets/image.png>)"
        notePath={"C:\\Notes\\Work\\Meeting Notes — Kickoff.md"}
        notes={[]}
        onOpen={() => undefined}
        onEditTable={() => undefined}
        onToggleTask={() => undefined}
      />,
    );

    expect(screen.getByRole("img", { name: "image" })).toBeInTheDocument();
    expect(convertFileSrc).toHaveBeenCalledWith(
      "C:\\Notes\\Work\\Meeting Notes — Kickoff.assets\\image.png",
    );
  });

  it("renders GFM and routes wiki and relative Markdown links inside the library", () => {
    const onOpen = vi.fn();
    const onEditTable = vi.fn();
    const onToggleTask = vi.fn();
    const markdown = [
      "# Project Alpha",
      "",
      "Open [[Café ideas|the café]] or [the same note](../Personal/Caf%C3%A9%20ideas.md#ideas).",
      "",
      "Copy `value with spaces` as one token.",
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
    expect(invoke).toHaveBeenCalledWith("open_external_url", { url: "https://example.com" });
    fireEvent.doubleClick(screen.getByText("value with spaces", { selector: "code" }));
    expect(window.getSelection()?.toString()).toBe("value with spaces");
    expect(screen.getByRole("img", { name: "Diagram" })).toHaveAttribute(
      "src",
      "asset://C:/Notes/Work/diagram.png",
    );

    const tasks = screen.getAllByRole("checkbox");
    expect(tasks[0]).not.toBeChecked();
    expect(tasks[1]).toBeChecked();
    fireEvent.click(tasks[0]);
    expect(onToggleTask).toHaveBeenCalledWith(0, true);

    const tableEditButton = screen.getByRole("button", { name: "Edit table 1" });
    expect(
      tableEditButton.closest(".preview-table-shell")?.querySelector(".preview-table-toolbar"),
    ).not.toBeNull();
    fireEvent.click(tableEditButton);
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

describe("library index warnings", () => {
  it("shows library index warnings", async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "load_selected_library"
          ? "C:/Notes"
          : command === "load_library_snapshot"
            ? {
                notes: [],
                folders: [],
                trash: [],
                warnings: [
                  { path: "C:/Notes/Unreadable.md", kind: "unreadable_markdown" },
                ],
              }
            : command === "take_opened_markdown_files"
              ? []
              : undefined,
      ) as never,
    );
    try {
      render(<App />);

      expect(
        await screen.findByText("1 file could not be indexed"),
      ).toBeInTheDocument();
    } finally {
      invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === "take_opened_markdown_files"
            ? []
            : command === "load_selected_library"
              ? null
              : undefined,
        ),
      );
    }
  });
});

describe("ranked discovery presentation", () => {
  it("shows existing tags on note cards without an editing control", async () => {
    const taggedNote = { ...notes[0], tags: ["work", "planning"] };
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "load_selected_library"
          ? "C:/Notes"
          : command === "load_library_snapshot"
            ? { notes: [taggedNote], folders: ["Work"], trash: [], warnings: [] }
            : command === "take_opened_markdown_files"
              ? []
              : undefined,
      ) as never,
    );
    try {
      render(<App />);

      const tagLabels = await screen.findByLabelText("Tags: work, planning");
      expect(tagLabels).toHaveTextContent("#work#planning");
      expect(tagLabels.querySelectorAll("button, input")).toHaveLength(0);
    } finally {
      invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === "take_opened_markdown_files"
            ? []
            : command === "load_selected_library"
              ? null
              : undefined,
        ),
      );
    }
  });

  it("searches deleted notes only while the Trash filter is active", async () => {
    const deleted = {
      ...notes[0],
      id: "deleted-alpha",
      path: "C:/Notes/.markdown-notes/trash/Deleted Alpha.md",
      title: "Deleted Alpha",
      folder: "Trash",
    };
    invoke.mockImplementation(
      ((command: string, args?: { scope?: string }) =>
        Promise.resolve(
          command === "load_selected_library"
            ? "C:/Notes"
            : command === "load_library_snapshot"
              ? {
                  notes: [notes[0]],
                  folders: ["Work"],
                  trash: [deleted],
                  warnings: [],
                }
              : command === "search_library"
                ? args?.scope === "trash"
                  ? [{ ...deleted, score: 450 }]
                  : [{ ...notes[0], score: 450 }]
                : command === "take_opened_markdown_files"
                  ? []
                  : undefined,
        )) as never,
    );
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Trash 1" }));
      fireEvent.change(screen.getByPlaceholderText("Search notes"), {
        target: { value: "alpha" },
      });

      expect(
        await screen.findByRole("button", { name: /Deleted Alpha/ }),
      ).toBeInTheDocument();
      expect(invoke).toHaveBeenCalledWith("search_library", {
        libraryPath: "C:/Notes",
        query: "alpha",
        scope: "trash",
      });
    } finally {
      invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === "take_opened_markdown_files"
            ? []
            : command === "load_selected_library"
              ? null
              : undefined,
        ),
      );
    }
  });

  it("shows the same native search error in persistent Search", async () => {
    invoke.mockImplementation(
      ((command: string) => {
        if (command === "load_selected_library") return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes: [notes[0]],
            folders: ["Work"],
            trash: [],
            warnings: [],
          });
        if (command === "search_library")
          return Promise.reject(new Error("native index unavailable"));
        if (command === "take_opened_markdown_files") return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );
    try {
      render(<App />);
      await waitFor(() =>
        expect(document.querySelector(".nr-note-main")).not.toBeNull(),
      );
      fireEvent.change(screen.getByPlaceholderText("Search notes"), {
        target: { value: "alpha" },
      });

      expect(
        await screen.findByText("Search is unavailable right now."),
      ).toBeInTheDocument();
      expect(screen.queryByText("No notes here yet.")).not.toBeInTheDocument();
    } finally {
      invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === "take_opened_markdown_files"
            ? []
            : command === "load_selected_library"
              ? null
              : undefined,
        ),
      );
    }
  });
});

describe("navigation structures and safety dialogs", () => {
  it("preserves view mode between notes", async () => {
    const documents = new Map(
      notes.map((summary) => [
        summary.path,
        {
          path: summary.path,
          title: summary.title,
          tags: summary.tags,
          body:
            summary.path === notes[1].path
              ? "# Café ideas\nLoaded note B"
              : `# ${summary.title}`,
          updated: summary.updated,
          revision: `${summary.id}-revision`,
        },
      ]),
    );
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as { path?: string } | undefined;
        if (command === "load_selected_library") return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({ notes, folders: ["Work", "Personal"], trash: [], warnings: [] });
        if (command === "read_note") return Promise.resolve(documents.get(payload?.path || ""));
        if (command === "take_opened_markdown_files" || command === "find_backlinks")
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const projectButton = (await screen.findAllByRole("button", { name: /Project Alpha/ })).find(
        (button) => button.classList.contains("nr-note-main"),
      );
      expect(projectButton).toBeDefined();
      fireEvent.click(projectButton!);
      fireEvent.click(await screen.findByRole("button", { name: "Split view" }));
      expect(screen.getByRole("button", { name: "Split view" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      const cafeButton = screen
        .getAllByRole("button", { name: /Café ideas/ })
        .find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(cafeButton!);

      expect(
        await screen.findByText("Loaded note B", { selector: ".preview p" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Split view" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } finally {
      invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === "take_opened_markdown_files"
            ? []
            : command === "load_selected_library"
              ? null
              : undefined,
        ),
      );
    }
  });

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

  it("uses a plus control for subfolders and a double-click for folder renaming", () => {
    const onAddSubfolder = vi.fn();
    const onRename = vi.fn();
    render(<FolderTree folders={["Work", "Work/Research"]} counts={{ Work: 1, "Work/Research": 1 }} collapsed={[]} onSelect={() => undefined} onToggle={() => undefined} onAddSubfolder={onAddSubfolder} onRename={onRename} onDelete={() => undefined} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "Work 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add subfolder to Work" }));
    expect(onRename).toHaveBeenCalledWith("Work");
    expect(onAddSubfolder).toHaveBeenCalledWith("Work");
    expect(screen.queryByRole("button", { name: "Rename Work" })).not.toBeInTheDocument();
  });

  it("keeps selected-folder notes grouped under their nested folders", () => {
    const treeNotes = [
      { ...notes[0], folder: "Work/Ideas", title: "Idea one" },
      { ...notes[1], folder: "Work/Personal", title: "Personal one" },
      { ...notes[1], path: "C:/Notes/Work/Personal/Two.md", folder: "Work/Personal", title: "Personal two" },
    ];
    render(<FolderNoteTree root="Work" folders={["Work", "Work/Ideas", "Work/Personal"]} notes={treeNotes} renderNote={note => <p key={note.path}>{note.title}</p>} />);
    expect(screen.getByText("Ideas").closest("section")).toHaveTextContent("Ideas1Idea one");
    expect(screen.getByText("Personal").closest("section")).toHaveTextContent("Personal2Personal onePersonal two");
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
        conflict={{
          mine: base,
          disk: { ...base, body: "# Project Alpha\nDisk", revision: "disk" },
          path: base.path,
        }}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByText("Your unsaved edits have not been overwritten. Choose which version to keep.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use disk version" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect(onChoose.mock.calls).toEqual([["disk"], ["mine"]]);
  });

  it("saves quick capture with Ctrl+Enter, reports current feedback, and cancels with Escape", () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const { rerender } = render(
      <QuickCaptureDialog
        shortcut="Ctrl+Alt+Shift+Space"
        status="Adds to today’s Daily note"
        onSave={onSave}
        onClose={onClose}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(screen.getByText("Adds to today’s Daily note")).toBeInTheDocument();
    rerender(
      <QuickCaptureDialog
        shortcut="Ctrl+Alt+Shift+Space"
        status="Could not save quick note: disk full"
        onSave={onSave}
        onClose={onClose}
      />,
    );
    expect(
      screen.getByText("Could not save quick note: disk full"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save capture" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "A captured thought" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith("A captured thought");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes settings with Escape while retaining a scrollable settings panel", () => {
    const onClose = vi.fn();
    render(<SettingsDialog theme="system" onTheme={() => undefined} palette="mint" onPalette={() => undefined} shortcuts={{ newNote: "ctrl+n", search: "ctrl+k", switcher: "ctrl+p", save: "ctrl+s", view: "ctrl+e", sidebar: "ctrl+\\", outline: "ctrl+shift+o", quickCapture: "ctrl+alt+shift+space" }} onShortcuts={() => undefined} quickCaptureStatus="Ready" library="C:/Notes" quickImportTargets={notes} quickImportDefaultPath="" onQuickImportDefaultPath={() => undefined} updateState="idle" updateMessage="" onCheckForUpdates={() => undefined} onChangeLibrary={() => undefined} onClose={onClose} />);
    expect(screen.getByRole("button", { name: "Change library" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Settings" }).parentElement).toHaveClass("settings-backdrop");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("persists palette changes made through App Settings", () => {
    const previousPalette = localStorage.getItem("margin.palette");
    localStorage.setItem("margin.palette", "mint");
    try {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Settings"));
      fireEvent.click(screen.getByRole("radio", { name: "Linen" }));

      expect(document.documentElement.dataset.palette).toBe("linen");
      expect(localStorage.getItem("margin.palette")).toBe("linen");
    } finally {
      if (previousPalette === null) localStorage.removeItem("margin.palette");
      else localStorage.setItem("margin.palette", previousPalette);
      delete document.documentElement.dataset.palette;
    }
  });

  it("keeps Image beside Table in the persistent top edit bar", async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "load_selected_library"
          ? "C:/Notes"
          : command === "load_library_snapshot"
            ? { notes, folders: [], trash: [] }
            : command === "read_note"
              ? {
                  path: notes[0].path,
                  title: notes[0].title,
                  tags: [],
                  body: "# Project Alpha\n",
                  updated: 1,
                  revision: "test",
                }
              : command === "take_opened_markdown_files"
                ? []
                : command === "find_backlinks"
                  ? []
                  : undefined,
      ) as never,
    );
    try {
      const { container } = render(<App />);
      const noteButton = (await screen.findAllByRole("button", { name: /Project Alpha/ })).find(
        (button) => button.classList.contains("nr-note-main"),
      );
      expect(noteButton).toBeDefined();
      fireEvent.click(noteButton!);
      fireEvent.click(await screen.findByRole("button", { name: /Edit view/ }));

      await waitFor(() => {
        expect(container.querySelector(".editor-tools")).not.toBeNull();
      });
      const tools = container.querySelector(".editor-tools")!;
      const buttons = Array.from(tools.querySelectorAll("button"));
      const tableIndex = buttons.findIndex((button) => button.textContent === "Table");
      expect(buttons[tableIndex + 1]).toHaveTextContent("Image");
    } finally {
      invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === "take_opened_markdown_files"
            ? []
            : command === "load_selected_library"
              ? null
              : undefined,
        ),
      );
    }
  });

  it.each([
    {
      name: "the configured Daily template",
      templates: [
        { id: "first", name: "First", body: "# First template" },
        { id: "daily", name: "Daily note", body: "# Daily {{date}}" },
      ],
      expectedTemplate: /^# Daily (?!\{\{date\}\}).+$/,
    },
    {
      name: "the first template when Daily is absent",
      templates: [
        { id: "first", name: "First", body: "# First template" },
        { id: "second", name: "Second", body: "# Second template" },
      ],
      expectedTemplate: /^# First template$/,
    },
    {
      name: "the default Daily template when no templates are stored",
      templates: [],
      expectedTemplate: /^# (?!\{\{date\}\}).+\n\n## Priorities/,
    },
  ])("passes $name to fallback Quick Capture", async ({
    templates,
    expectedTemplate,
  }) => {
    const previousTemplates = localStorage.getItem("margin.templates");
    const previousShortcuts = localStorage.getItem("markdown-notes.shortcuts");
    localStorage.setItem("margin.templates", JSON.stringify(templates));
    localStorage.setItem("markdown-notes.shortcuts", "{}");
    invoke.mockReset();
    invoke.mockImplementation(
      ((command: string) => {
        if (command === "load_selected_library")
          return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes: [],
            folders: [],
            trash: [],
            warnings: [],
          });
        if (command === "take_opened_markdown_files") return Promise.resolve([]);
        if (command === "show_quick_capture")
          return Promise.reject(new Error("native window unavailable"));
        if (command === "append_quick_note")
          return Promise.resolve({
            id: "daily/2026-08-11",
            path: "C:/Notes/Daily/2026-08-11.md",
            title: "2026-08-11",
            tags: [],
            body: "",
            updated: 1,
            revision: "saved",
          });
        return Promise.resolve(undefined);
      }) as never,
    );

    const view = render(<App />);
    try {
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("load_library_snapshot", {
          libraryPath: "C:/Notes",
          force: false,
        }),
      );
      fireEvent.keyDown(window, {
        key: " ",
        code: "Space",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      });
      const input = await screen.findByPlaceholderText("Start typing…");
      fireEvent.change(input, { target: { value: "Fallback thought" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capture" }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("append_quick_note", {
          libraryPath: "C:/Notes",
          text: "Fallback thought",
          dailyTemplate: expect.stringMatching(expectedTemplate),
        }),
      );
    } finally {
      view.unmount();
      if (previousTemplates === null) localStorage.removeItem("margin.templates");
      else localStorage.setItem("margin.templates", previousTemplates);
      if (previousShortcuts === null)
        localStorage.removeItem("markdown-notes.shortcuts");
      else localStorage.setItem("markdown-notes.shortcuts", previousShortcuts);
      invoke.mockReset();
    }
  });

  it("treats an appended fallback capture as saved when refresh fails", async () => {
    const previousShortcuts = localStorage.getItem("markdown-notes.shortcuts");
    localStorage.setItem("markdown-notes.shortcuts", "{}");
    let snapshotCall = 0;
    let resolveAppend: (value: unknown) => void = () => undefined;
    const append = new Promise((resolve) => {
      resolveAppend = resolve;
    });
    invoke.mockReset();
    invoke.mockImplementation(
      ((command: string) => {
        if (command === "load_selected_library")
          return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return ++snapshotCall === 1
            ? Promise.resolve({
                notes: [],
                folders: [],
                trash: [],
                warnings: [],
              })
            : Promise.reject(new Error("refresh unavailable"));
        if (command === "take_opened_markdown_files") return Promise.resolve([]);
        if (command === "show_quick_capture")
          return Promise.reject(new Error("native window unavailable"));
        if (command === "append_quick_note") return append;
        return Promise.resolve(undefined);
      }) as never,
    );

    const view = render(<App />);
    try {
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("load_library_snapshot", {
          libraryPath: "C:/Notes",
          force: false,
        }),
      );
      fireEvent.keyDown(window, {
        key: " ",
        code: "Space",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      });
      const input = await screen.findByPlaceholderText("Start typing…");
      expect(screen.getByText("Adds to today’s Daily note")).toBeInTheDocument();
      vi.useFakeTimers();
      fireEvent.change(input, { target: { value: "Fallback thought" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capture" }));
      expect(screen.getByText("Saving…")).toBeInTheDocument();

      await act(async () => {
        resolveAppend({
          id: "daily/2026-08-11",
          path: "C:/Notes/Daily/2026-08-11.md",
          title: "2026-08-11",
          tags: [],
          body: "",
          updated: 1,
          revision: "saved",
        });
      });

      expect(
        screen.getByText("Saved to Daily/2026-08-11.md"),
      ).toBeInTheDocument();
      expect(input).toHaveValue("");
      expect(snapshotCall).toBe(2);
      expect(
        screen.queryByText(/Could not save quick note/),
      ).not.toBeInTheDocument();
      expect(
        invoke.mock.calls.filter(([command]) => command === "append_quick_note"),
      ).toHaveLength(1);

      act(() => vi.advanceTimersByTime(999));
      expect(screen.getByPlaceholderText("Start typing…")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(
        screen.queryByPlaceholderText("Start typing…"),
      ).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
      if (previousShortcuts === null)
        localStorage.removeItem("markdown-notes.shortcuts");
      else localStorage.setItem("markdown-notes.shortcuts", previousShortcuts);
      invoke.mockReset();
    }
  });

  it("keeps fallback text and shows the native save failure", async () => {
    const previousShortcuts = localStorage.getItem("markdown-notes.shortcuts");
    localStorage.setItem("markdown-notes.shortcuts", "{}");
    invoke.mockReset();
    invoke.mockImplementation(
      ((command: string) => {
        if (command === "load_selected_library")
          return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes: [],
            folders: [],
            trash: [],
            warnings: [],
          });
        if (command === "take_opened_markdown_files") return Promise.resolve([]);
        if (command === "show_quick_capture")
          return Promise.reject(new Error("native window unavailable"));
        if (command === "append_quick_note")
          return Promise.reject(new Error("disk full"));
        return Promise.resolve(undefined);
      }) as never,
    );

    const view = render(<App />);
    try {
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("load_library_snapshot", {
          libraryPath: "C:/Notes",
          force: false,
        }),
      );
      fireEvent.keyDown(window, {
        key: " ",
        code: "Space",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      });
      const input = await screen.findByPlaceholderText("Start typing…");
      fireEvent.change(input, { target: { value: "Do not lose this" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capture" }));

      expect(
        await screen.findByText("Could not save quick note: Error: disk full"),
      ).toBeInTheDocument();
      expect(input).toHaveValue("Do not lose this");
    } finally {
      view.unmount();
      if (previousShortcuts === null)
        localStorage.removeItem("markdown-notes.shortcuts");
      else localStorage.setItem("markdown-notes.shortcuts", previousShortcuts);
      invoke.mockReset();
    }
  });

  it.each(["switch", "clear"] as const)(
    "does not reactivate a renamed note when its delayed save resolves after %s",
    async (nextAction) => {
      const documents = new Map(
        notes.map((summary) => [
          summary.path,
          {
            path: summary.path,
            title: summary.title,
            tags: summary.tags,
            body: `# ${summary.title}\n\n- [ ] Task`,
            updated: summary.updated,
            revision: `${summary.id}-revision`,
          },
        ]),
      );
      let resolveSave: (value: unknown) => void = () => undefined;
      const delayedSave = new Promise((resolve) => {
        resolveSave = resolve;
      });
      const confirmMove = vi.spyOn(window, "confirm").mockReturnValue(true);
      invoke.mockImplementation(
        ((command: string, args?: unknown) => {
          const payload = args as { path?: string } | undefined;
          if (command === "load_selected_library")
            return Promise.resolve("C:/Notes");
          if (command === "load_library_snapshot")
            return Promise.resolve({
              notes,
              folders: ["Work", "Personal"],
              trash: [],
              warnings: [],
            });
          if (command === "read_note")
            return Promise.resolve(documents.get(payload?.path || ""));
          if (command === "save_note") return delayedSave;
          if (
            command === "take_opened_markdown_files" ||
            command === "find_backlinks"
          )
            return Promise.resolve([]);
          return Promise.resolve(undefined);
        }) as never,
      );

      try {
        const { container } = render(<App />);
        const projectButton = (await screen.findAllByRole("button", {
          name: /Project Alpha/,
        })).find((button) => button.classList.contains("nr-note-main"));
        expect(projectButton).toBeDefined();
        fireEvent.click(projectButton!);
        fireEvent.click(await screen.findByRole("checkbox"));
        fireEvent.keyDown(window, { key: "s", ctrlKey: true });
        await waitFor(() =>
          expect(invoke).toHaveBeenCalledWith(
            "save_note",
            expect.objectContaining({
              note: expect.objectContaining({ path: notes[0].path }),
            }),
          ),
        );

        if (nextAction === "switch") {
          const cafeButton = screen
            .getAllByRole("button", { name: /Café ideas/ })
            .find((button) => button.classList.contains("nr-note-main"));
          fireEvent.click(cafeButton!);
          await waitFor(() =>
            expect(
              container.querySelector(".nr-note-main[aria-current='page']"),
            ).toHaveTextContent("Café ideas"),
          );
        } else {
          fireEvent.contextMenu(projectButton!.closest("article")!, {
            clientX: 20,
            clientY: 20,
          });
          fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
          await waitFor(() =>
            expect(
              container.querySelector(".nr-note-main[aria-current='page']"),
            ).toBeNull(),
          );
        }

        await act(async () => {
          resolveSave({
            status: "saved",
            note: {
              ...documents.get(notes[0].path)!,
              path: "C:/Notes/Work/Project Alpha renamed.md",
              body: "# Project Alpha\n\n- [x] Task",
              revision: "saved-revision",
            },
          });
          await delayedSave;
          await Promise.resolve();
        });

        const activeNote = container.querySelector(
          ".nr-note-main[aria-current='page']",
        );
        if (nextAction === "switch")
          expect(activeNote).toHaveTextContent("Café ideas");
        else expect(activeNote).toBeNull();
      } finally {
        confirmMove.mockRestore();
        invoke.mockImplementation((command: string) =>
          Promise.resolve(
            command === "take_opened_markdown_files"
              ? []
              : command === "load_selected_library"
                ? null
                : undefined,
          ),
        );
      }
    },
  );

  it("keeps the static application icon when the appearance changes", () => {
    const previousPalette = localStorage.getItem("margin.palette");
    const previousTheme = localStorage.getItem("margin.theme");
    localStorage.setItem("margin.palette", "paper");
    localStorage.setItem("margin.theme", "light");
    try {
      render(<App />);
      invoke.mockClear();
      fireEvent.click(screen.getByLabelText("Settings"));
      fireEvent.change(screen.getByLabelText("Appearance"), {
        target: { value: "dark" },
      });

      expect(invoke).not.toHaveBeenCalledWith(
        "set_runtime_palette_icon",
        expect.anything(),
      );
    } finally {
      if (previousPalette === null) localStorage.removeItem("margin.palette");
      else localStorage.setItem("margin.palette", previousPalette);
      if (previousTheme === null) localStorage.removeItem("margin.theme");
      else localStorage.setItem("margin.theme", previousTheme);
      delete document.documentElement.dataset.palette;
      delete document.documentElement.dataset.theme;
    }
  });

  it("labels the palette choices and marks the current palette", () => {
    render(
      <SettingsDialog
        palette="mint"
        onPalette={() => undefined}
        theme="system"
        onTheme={() => undefined}
        shortcuts={{ newNote: "ctrl+n", search: "ctrl+k", switcher: "ctrl+p", save: "ctrl+s", view: "ctrl+e", sidebar: "ctrl+\\", outline: "ctrl+shift+o", quickCapture: "ctrl+alt+shift+space" }}
        onShortcuts={() => undefined}
        quickCaptureStatus="Ready"
        library="C:/Notes"
        quickImportTargets={notes}
        quickImportDefaultPath=""
        onQuickImportDefaultPath={() => undefined}
        updateState="idle"
        updateMessage=""
        onCheckForUpdates={() => undefined}
        onChangeLibrary={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("group", { name: "Palette" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mint" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Paper" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });
});

describe("save-aware quit", () => {
  const documents = new Map(
    notes.map((summary) => [
      summary.path,
      {
        path: summary.path,
        title: summary.title,
        tags: summary.tags,
        body: `# ${summary.title}\n\n- [ ] Task`,
        updated: summary.updated,
        revision: `${summary.id}-revision`,
      },
    ]),
  );

  const restoreDefaultInvoke = () => {
    eventHandlers.clear();
    open.mockReset();
    open.mockResolvedValue(undefined);
    invoke.mockClear();
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "take_opened_markdown_files"
          ? []
          : command === "load_selected_library"
            ? null
            : undefined,
      ),
    );
  };

  beforeEach(restoreDefaultInvoke);

  it("enqueues the dirty note and awaits every save queue before completing quit", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const firstSave = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondSave = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as { path?: string; note?: { path: string } } | undefined;
        if (command === "load_selected_library") return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes,
            folders: ["Work", "Personal"],
            trash: [],
            warnings: [],
          });
        if (command === "read_note")
          return Promise.resolve(documents.get(payload?.path || ""));
        if (command === "save_note")
          return payload?.note?.path === notes[0].path ? firstSave : secondSave;
        if (
          command === "take_opened_markdown_files" ||
          command === "find_backlinks"
        )
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const projectButton = (await screen.findAllByRole("button", {
        name: /Project Alpha/,
      })).find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(projectButton!);
      fireEvent.click(await screen.findByRole("checkbox"));
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          "save_note",
          expect.objectContaining({
            note: expect.objectContaining({ path: notes[0].path }),
          }),
        ),
      );

      const cafeButton = screen
        .getAllByRole("button", { name: /Café ideas/ })
        .find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(cafeButton!);
      await screen.findByText("Café ideas", { selector: ".preview h1" });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(
            ([command]) => command === "set_dirty_state",
          ).slice(-1)[0],
        ).toEqual(["set_dirty_state", { dirty: true }]),
      );
      fireEvent.click(screen.getByRole("checkbox"));
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("set_dirty_state", { dirty: true }),
      );
      await waitFor(() =>
        expect(eventHandlers.has("margin://request-quit")).toBe(true),
      );

      act(() => {
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 41 },
        });
      });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          "save_note",
          expect.objectContaining({
            note: expect.objectContaining({ path: notes[1].path }),
          }),
        ),
      );
      expect(invoke).not.toHaveBeenCalledWith("complete_quit_request", {
        requestId: 41,
        saved: true,
      });

      await act(async () => {
        resolveSecond({
          status: "saved",
          note: {
            ...documents.get(notes[1].path)!,
            body: "# Café ideas\n\n- [x] Task",
            revision: "cafe-saved",
          },
        });
        await secondSave;
      });
      expect(invoke).not.toHaveBeenCalledWith("complete_quit_request", {
        requestId: 41,
        saved: true,
      });

      await act(async () => {
        resolveFirst({
          status: "saved",
          note: {
            ...documents.get(notes[0].path)!,
            body: "# Project Alpha\n\n- [x] Task",
            revision: "project-saved",
          },
        });
        await firstSave;
      });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("complete_quit_request", {
          requestId: 41,
          saved: true,
        }),
      );
    } finally {
      restoreDefaultInvoke();
    }
  });

  it("saves an edit made while the quit flush is finishing before acknowledging quit", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const firstSave = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondSave = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    let saveCall = 0;
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as { path?: string } | undefined;
        if (command === "load_selected_library") return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes: [notes[0]],
            folders: ["Work"],
            trash: [],
            warnings: [],
          });
        if (command === "read_note")
          return Promise.resolve(documents.get(payload?.path || ""));
        if (command === "save_note") {
          saveCall += 1;
          return saveCall === 1 ? firstSave : secondSave;
        }
        if (
          command === "take_opened_markdown_files" ||
          command === "find_backlinks"
        )
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const projectButton = (await screen.findAllByRole("button", {
        name: /Project Alpha/,
      })).find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(projectButton!);
      fireEvent.click(await screen.findByRole("checkbox"));
      await waitFor(() =>
        expect(eventHandlers.has("margin://request-quit")).toBe(true),
      );

      act(() => {
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 61 },
        });
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(1),
      );

      fireEvent.click(screen.getByRole("checkbox"));
      await act(async () => {
        resolveFirst({
          status: "saved",
          note: {
            ...documents.get(notes[0].path)!,
            body: "# Project Alpha\n\n- [x] Task",
            revision: "first-quit-save",
          },
        });
        await firstSave;
      });

      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(2),
      );
      expect(invoke).not.toHaveBeenCalledWith("complete_quit_request", {
        requestId: 61,
        saved: true,
      });
      expect(invoke).toHaveBeenLastCalledWith(
        "save_note",
        expect.objectContaining({
          note: expect.objectContaining({
            path: notes[0].path,
            body: "# Project Alpha\n\n- [ ] Task",
          }),
        }),
      );

      await act(async () => {
        resolveSecond({
          status: "saved",
          note: {
            ...documents.get(notes[0].path)!,
            revision: "second-quit-save",
          },
        });
        await secondSave;
      });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("complete_quit_request", {
          requestId: 61,
          saved: true,
        }),
      );
    } finally {
      restoreDefaultInvoke();
    }
  });

  it("stops quit coordination after cancellation while the save queue converges", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const firstSave = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondSave = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    let saveCall = 0;
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as { path?: string } | undefined;
        if (command === "load_selected_library")
          return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes: [notes[0]],
            folders: ["Work"],
            trash: [],
            warnings: [],
          });
        if (command === "read_note")
          return Promise.resolve(documents.get(payload?.path || ""));
        if (command === "save_note") {
          saveCall += 1;
          return saveCall === 1 ? firstSave : secondSave;
        }
        if (
          command === "take_opened_markdown_files" ||
          command === "find_backlinks"
        )
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const projectButton = (await screen.findAllByRole("button", {
        name: /Project Alpha/,
      })).find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(projectButton!);
      fireEvent.click(await screen.findByRole("checkbox"));
      await waitFor(() =>
        expect(eventHandlers.has("margin://request-quit")).toBe(true),
      );

      act(() => {
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 81 },
        });
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(1),
      );
      fireEvent.click(screen.getByRole("checkbox"));
      act(() => {
        eventHandlers.get("margin://cancel-quit")?.({
          payload: { requestId: 81 },
        });
      });

      await act(async () => {
        resolveFirst({
          status: "saved",
          note: {
            ...documents.get(notes[0].path)!,
            body: "# Project Alpha\n\n- [x] Task",
            revision: "cancelled-request-save",
          },
        });
        await firstSave;
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(2),
      );
      expect(invoke).not.toHaveBeenCalledWith("complete_quit_request", {
        requestId: 81,
        saved: true,
      });

      act(() => {
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 82 },
        });
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(2),
      );
      await act(async () => {
        resolveSecond({
          status: "saved",
          note: {
            ...documents.get(notes[0].path)!,
            revision: "newer-request-save",
          },
        });
        await secondSave;
      });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("complete_quit_request", {
          requestId: 82,
          saved: true,
        }),
      );
    } finally {
      restoreDefaultInvoke();
    }
  });

  it.each(["conflict", "error"] as const)(
    "reports quit as unsaved and keeps %s recovery visible",
    async (failure) => {
      const disk = {
        ...documents.get(notes[0].path)!,
        body: "# Project Alpha\n\nChanged outside Margin",
        revision: "disk-revision",
      };
      invoke.mockImplementation(
        ((command: string, args?: unknown) => {
          const payload = args as { path?: string } | undefined;
          if (command === "load_selected_library")
            return Promise.resolve("C:/Notes");
          if (command === "load_library_snapshot")
            return Promise.resolve({
              notes: [notes[0]],
              folders: ["Work"],
              trash: [],
              warnings: [],
            });
          if (command === "read_note")
            return Promise.resolve(documents.get(payload?.path || ""));
          if (command === "save_note")
            return Promise.resolve(
              failure === "conflict"
                ? { status: "conflict", disk }
                : { status: "error", message: "disk full" },
            );
          if (
            command === "take_opened_markdown_files" ||
            command === "find_backlinks"
          )
            return Promise.resolve([]);
          return Promise.resolve(undefined);
        }) as never,
      );

      try {
        render(<App />);
        const projectButton = (await screen.findAllByRole("button", {
          name: /Project Alpha/,
        })).find((button) => button.classList.contains("nr-note-main"));
        fireEvent.click(projectButton!);
        fireEvent.click(await screen.findByRole("checkbox"));
        await waitFor(() =>
          expect(eventHandlers.has("margin://request-quit")).toBe(true),
        );

        act(() => {
          eventHandlers.get("margin://request-quit")?.({
            payload: { requestId: 52 },
          });
        });

        await waitFor(() =>
          expect(invoke).toHaveBeenCalledWith("complete_quit_request", {
            requestId: 52,
            saved: false,
          }),
        );
        if (failure === "conflict") {
          expect(
            screen.getByText(
              "Your unsaved edits have not been overwritten. Choose which version to keep.",
            ),
          ).toBeInTheDocument();
        } else {
          expect(screen.getByText("Save failed: disk full")).toBeInTheDocument();
        }
      } finally {
        restoreDefaultInvoke();
      }
    },
  );

  it("keeps a failed inactive draft recoverable and rejects a later quit", async () => {
    const projectWithTwoTasks = {
      ...documents.get(notes[0].path)!,
      body: "# Project Alpha\n\n- [ ] First task\n- [ ] Second task",
    };
    let resolveSave: (value: unknown) => void = () => undefined;
    let resolveRetry: (value: unknown) => void = () => undefined;
    const pendingSave = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const retrySave = new Promise((resolve) => {
      resolveRetry = resolve;
    });
    let saveCall = 0;
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as { path?: string } | undefined;
        if (command === "load_selected_library") return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes,
            folders: ["Work", "Personal"],
            trash: [],
            warnings: [],
          });
        if (command === "read_note")
          return Promise.resolve(
            payload?.path === notes[0].path
              ? projectWithTwoTasks
              : documents.get(payload?.path || ""),
          );
        if (command === "save_note") {
          saveCall += 1;
          return saveCall === 1 ? pendingSave : retrySave;
        }
        if (
          command === "take_opened_markdown_files" ||
          command === "find_backlinks"
        )
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const projectButton = (await screen.findAllByRole("button", {
        name: /Project Alpha/,
      })).find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(projectButton!);
      fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(1),
      );
      fireEvent.click(screen.getAllByRole("checkbox")[1]);

      const cafeButton = screen
        .getAllByRole("button", { name: /Café ideas/ })
        .find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(cafeButton!);
      await screen.findByText("Café ideas", { selector: ".preview h1" });
      await act(async () => {
        resolveSave({ status: "error", message: "disk full" });
        await pendingSave;
        await Promise.resolve();
      });

      expect(
        invoke.mock.calls
          .filter(([command]) => command === "set_dirty_state")
          .slice(-1)[0],
      ).toEqual(["set_dirty_state", { dirty: true }]);
      expect(
        screen.getByText("Project Alpha could not be saved: disk full"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Retry saving Project Alpha" }),
      ).toBeInTheDocument();

      act(() => {
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 71 },
        });
      });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("complete_quit_request", {
          requestId: 71,
          saved: false,
        }),
      );
      expect(invoke).not.toHaveBeenCalledWith("complete_quit_request", {
        requestId: 71,
        saved: true,
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Retry saving Project Alpha" }),
      );
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(2),
      );
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "save_note")
          .slice(-1)[0],
      ).toEqual([
        "save_note",
        expect.objectContaining({
          note: expect.objectContaining({
            path: notes[0].path,
            body: "# Project Alpha\n\n- [x] First task\n- [x] Second task",
          }),
        }),
      ]);
      expect(
        screen.getByText("Project Alpha could not be saved: disk full"),
      ).toBeInTheDocument();

      await act(async () => {
        resolveRetry({
          status: "saved",
          note: {
            ...projectWithTwoTasks,
            body: "# Project Alpha\n\n- [x] First task\n- [x] Second task",
            revision: "background-retry-saved",
          },
        });
        await retrySave;
      });
      await waitFor(() =>
        expect(
          screen.queryByText("Project Alpha could not be saved: disk full"),
        ).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          invoke.mock.calls
            .filter(([command]) => command === "set_dirty_state")
            .slice(-1)[0],
        ).toEqual(["set_dirty_state", { dirty: false }]),
      );

      act(() => {
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 72 },
        });
      });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("complete_quit_request", {
          requestId: 72,
          saved: true,
        }),
      );
    } finally {
      restoreDefaultInvoke();
    }
  });

  it("continues an inactive save queue to the newest edit after an older save succeeds", async () => {
    const initialProject = {
      ...documents.get(notes[0].path)!,
      body: "# Project Alpha\n\n- [ ] First task\n- [ ] Second task",
    };
    const firstSavedProject = {
      ...initialProject,
      body: "# Project Alpha\n\n- [x] First task\n- [ ] Second task",
      revision: "first-background-save",
    };
    const newestProject = {
      ...initialProject,
      body: "# Project Alpha\n\n- [x] First task\n- [x] Second task",
      revision: "newest-background-save",
    };
    let diskProject = initialProject;
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const firstSave = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondSave = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    let saveCall = 0;
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as { path?: string } | undefined;
        if (command === "load_selected_library")
          return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes,
            folders: ["Work", "Personal"],
            trash: [],
            warnings: [],
          });
        if (command === "read_note")
          return Promise.resolve(
            payload?.path === notes[0].path
              ? diskProject
              : documents.get(payload?.path || ""),
          );
        if (command === "save_note") {
          saveCall += 1;
          return saveCall === 1 ? firstSave : secondSave;
        }
        if (
          command === "take_opened_markdown_files" ||
          command === "find_backlinks"
        )
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const projectButton = (await screen.findAllByRole("button", {
        name: /Project Alpha/,
      })).find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(projectButton!);
      fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(1),
      );
      fireEvent.click(screen.getAllByRole("checkbox")[1]);

      const cafeButton = screen
        .getAllByRole("button", { name: /Café ideas/ })
        .find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(cafeButton!);
      await screen.findByText("Café ideas", { selector: ".preview h1" });

      diskProject = firstSavedProject;
      await act(async () => {
        resolveFirst({ status: "saved", note: firstSavedProject });
        await firstSave;
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(2),
      );
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "save_note")
          .slice(-1)[0],
      ).toEqual([
        "save_note",
        expect.objectContaining({
          note: expect.objectContaining({
            path: notes[0].path,
            body: newestProject.body,
          }),
        }),
      ]);
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "set_dirty_state")
          .slice(-1)[0],
      ).toEqual(["set_dirty_state", { dirty: true }]);

      fireEvent.click(projectButton!);
      await screen.findByText("Project Alpha", { selector: ".preview h1" });
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
      expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
      expect(screen.getAllByRole("checkbox")[1]).toBeChecked();

      diskProject = newestProject;
      await act(async () => {
        resolveSecond({ status: "saved", note: newestProject });
        await secondSave;
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls
            .filter(([command]) => command === "set_dirty_state")
            .slice(-1)[0],
        ).toEqual(["set_dirty_state", { dirty: false }]),
      );

      const externalAfterClean = {
        ...newestProject,
        body: "# Project Alpha\n\nChanged after clean convergence",
        revision: "external-after-clean",
      };
      fireEvent.click(cafeButton!);
      await screen.findByText("Café ideas", { selector: ".preview h1" });
      diskProject = externalAfterClean;
      fireEvent.click(projectButton!);
      expect(
        await screen.findByText("Changed after clean convergence", {
          selector: ".preview p",
        }),
      ).toBeInTheDocument();
    } finally {
      restoreDefaultInvoke();
    }
  });

  it("rebases a reopened edit through chained pending renames", async () => {
    const originalPath = notes[0].path;
    const renamedPathA = "C:/Notes/Work/Project Alpha renamed A.md";
    const renamedPathB = "C:/Notes/Work/Project Alpha renamed B.md";
    const initialProject = {
      ...documents.get(originalPath)!,
      body: "# Project Alpha\n\n- [ ] First task\n- [ ] Second task",
    };
    const firstSavedProject = {
      ...initialProject,
      path: renamedPathA,
      body: "# Project Alpha\n\n- [x] First task\n- [ ] Second task",
      revision: "first-renamed-save",
    };
    const newestProjectBody =
      "# Project Alpha\n\n- [x] First task\n- [x] Second task";
    const secondSavedProject = {
      ...firstSavedProject,
      path: renamedPathB,
      body: newestProjectBody,
      revision: "second-renamed-save",
    };
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    let resolveThird: (value: unknown) => void = () => undefined;
    const firstSave = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondSave = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    const thirdSave = new Promise((resolve) => {
      resolveThird = resolve;
    });
    let saveCall = 0;
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as { path?: string } | undefined;
        if (command === "load_selected_library")
          return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve({
            notes,
            folders: ["Work", "Personal"],
            trash: [],
            warnings: [],
          });
        if (command === "read_note")
          return Promise.resolve(
            payload?.path === originalPath
              ? initialProject
              : payload?.path === renamedPathA
                ? firstSavedProject
                : payload?.path === renamedPathB
                  ? secondSavedProject
                  : documents.get(payload?.path || ""),
          );
        if (command === "save_note") {
          saveCall += 1;
          return saveCall === 1
            ? firstSave
            : saveCall === 2
              ? secondSave
              : thirdSave;
        }
        if (
          command === "take_opened_markdown_files" ||
          command === "find_backlinks"
        )
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const originalButton = (await screen.findAllByRole("button", {
        name: /Project Alpha/,
      })).find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(originalButton!);
      fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(1),
      );
      fireEvent.click(screen.getAllByRole("checkbox")[1]);

      const cafeButton = screen
        .getAllByRole("button", { name: /Caf.* ideas/ })
        .find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(cafeButton!);
      await screen.findByText(notes[1].title, { selector: ".preview h1" });

      await act(async () => {
        resolveFirst({ status: "saved", note: firstSavedProject });
        await firstSave;
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(2),
      );
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "save_note")
          .slice(-1)[0],
      ).toEqual([
        "save_note",
        expect.objectContaining({
          note: expect.objectContaining({
            path: renamedPathA,
            body: newestProjectBody,
          }),
        }),
      ]);

      const renamedButton = screen
        .getAllByRole("button", { name: /Project Alpha/ })
        .find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(renamedButton!);
      await screen.findByText("Project Alpha", { selector: ".preview h1" });
      expect(document.querySelector(".note-file span")).toHaveAttribute(
        "title",
        renamedPathA,
      );
      expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
      expect(screen.getAllByRole("checkbox")[1]).toBeChecked();

      fireEvent.click(screen.getAllByRole("checkbox")[1]);
      await act(async () => {
        resolveSecond({ status: "saved", note: secondSavedProject });
        await secondSave;
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(3),
      );
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "save_note")
          .slice(-1)[0],
      ).toEqual([
        "save_note",
        expect.objectContaining({
          note: expect.objectContaining({
            path: renamedPathB,
            body: firstSavedProject.body,
          }),
        }),
      ]);
      expect(document.querySelector(".note-file span")).toHaveAttribute(
        "title",
        renamedPathB,
      );
      expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
      expect(screen.getAllByRole("checkbox")[1]).not.toBeChecked();

      await act(async () => {
        resolveThird({
          status: "saved",
          note: {
            ...secondSavedProject,
            body: firstSavedProject.body,
            revision: "post-rename-edit-save",
          },
        });
        await thirdSave;
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls
            .filter(([command]) => command === "set_dirty_state")
            .slice(-1)[0],
        ).toEqual(["set_dirty_state", { dirty: false }]),
      );
    } finally {
      restoreDefaultInvoke();
    }
  });

  it("keeps the originating library when a recovery retry conflicts", async () => {
    let resolveSave: (value: unknown) => void = () => undefined;
    let resolveRetryConflict: (value: unknown) => void = () => undefined;
    let resolveKeepMine: (value: unknown) => void = () => undefined;
    const pendingSave = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const retryConflict = new Promise((resolve) => {
      resolveRetryConflict = resolve;
    });
    const keepMineSave = new Promise((resolve) => {
      resolveKeepMine = resolve;
    });
    let saveCall = 0;
    open.mockResolvedValueOnce("D:/Other");
    invoke.mockImplementation(
      ((command: string, args?: unknown) => {
        const payload = args as {
          path?: string;
          libraryPath?: string;
        } | undefined;
        if (command === "load_selected_library")
          return Promise.resolve("C:/Notes");
        if (command === "load_library_snapshot")
          return Promise.resolve(
            payload?.libraryPath === "D:/Other"
              ? { notes: [], folders: [], trash: [], warnings: [] }
              : {
                  notes: [notes[0]],
                  folders: ["Work"],
                  trash: [],
                  warnings: [],
                },
          );
        if (command === "read_note")
          return Promise.resolve(documents.get(payload?.path || ""));
        if (command === "save_note") {
          saveCall += 1;
          return saveCall === 1
            ? pendingSave
            : saveCall === 2
              ? retryConflict
              : keepMineSave;
        }
        if (
          command === "take_opened_markdown_files" ||
          command === "find_backlinks"
        )
          return Promise.resolve([]);
        return Promise.resolve(undefined);
      }) as never,
    );

    try {
      render(<App />);
      const projectButton = (await screen.findAllByRole("button", {
        name: /Project Alpha/,
      })).find((button) => button.classList.contains("nr-note-main"));
      fireEvent.click(projectButton!);
      fireEvent.click(await screen.findByRole("checkbox"));
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(1),
      );

      fireEvent.click(screen.getByLabelText("Settings"));
      const settingsDialog = screen.getByRole("dialog", { name: "Settings" });
      const changeLibraryButton = Array.from(
        settingsDialog.querySelectorAll("button"),
      ).find((button) => button.textContent === "Change library");
      fireEvent.click(changeLibraryButton!);
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("save_selected_library", {
          libraryPath: "D:/Other",
        }),
      );
      fireEvent.keyDown(window, { key: "Escape" });

      await act(async () => {
        resolveSave({ status: "error", message: "old library unavailable" });
        await pendingSave;
        await Promise.resolve();
      });
      expect(
        screen.getByText(
          "Project Alpha could not be saved: old library unavailable",
        ),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Retry saving Project Alpha" }),
      );
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(2),
      );
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "save_note")
          .slice(-1)[0],
      ).toEqual([
        "save_note",
        expect.objectContaining({
          libraryPath: "C:/Notes",
          note: expect.objectContaining({ path: notes[0].path }),
        }),
      ]);

      const disk = {
        ...documents.get(notes[0].path)!,
        body: "# Project Alpha\n\nChanged outside Margin",
        revision: "old-library-conflict",
      };
      await act(async () => {
        resolveRetryConflict({ status: "conflict", disk });
        await retryConflict;
      });
      await waitFor(() =>
        expect(
          screen.queryByText(
            "Project Alpha could not be saved: old library unavailable",
          ),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.getByText(
          "Your unsaved edits have not been overwritten. Choose which version to keep.",
        ),
      ).toBeInTheDocument();
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "set_dirty_state")
          .slice(-1)[0],
      ).toEqual(["set_dirty_state", { dirty: true }]);

      fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
      await waitFor(() =>
        expect(
          invoke.mock.calls.filter(([command]) => command === "save_note"),
        ).toHaveLength(3),
      );
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "save_note")
          .slice(-1)[0],
      ).toEqual([
        "save_note",
        expect.objectContaining({
          libraryPath: "C:/Notes",
          note: expect.objectContaining({
            path: notes[0].path,
            body: "# Project Alpha\n\n- [x] Task",
            revision: "old-library-conflict",
          }),
        }),
      ]);
      expect(
        invoke.mock.calls
          .filter(([command]) => command === "set_dirty_state")
          .slice(-1)[0],
      ).toEqual(["set_dirty_state", { dirty: true }]);

      await act(async () => {
        resolveKeepMine({
          status: "saved",
          note: {
            ...documents.get(notes[0].path)!,
            body: "# Project Alpha\n\n- [x] Task",
            revision: "old-library-keep-mine-saved",
          },
        });
        await keepMineSave;
      });
      await waitFor(() =>
        expect(
          invoke.mock.calls
            .filter(([command]) => command === "set_dirty_state")
            .slice(-1)[0],
        ).toEqual(["set_dirty_state", { dirty: false }]),
      );
    } finally {
      restoreDefaultInvoke();
    }
  });

  it("ignores stale and duplicate quit request ids", async () => {
    try {
      invoke.mockClear();
      render(<App />);
      await waitFor(() =>
        expect(eventHandlers.has("margin://request-quit")).toBe(true),
      );

      act(() => {
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 8 },
        });
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 8 },
        });
        eventHandlers.get("margin://request-quit")?.({
          payload: { requestId: 7 },
        });
      });

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("complete_quit_request", {
          requestId: 8,
          saved: true,
        }),
      );
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === "complete_quit_request",
        ),
      ).toHaveLength(1);
    } finally {
      restoreDefaultInvoke();
    }
  });
});

describe("library refresh coordination", () => {
  it("runs a forced mutation refresh immediately after an in-flight normal poll", async () => {
    let releaseNormal: () => void = () => {};
    let releaseForced: () => void = () => {};
    const normal = new Promise<void>((resolve) => {
      releaseNormal = resolve;
    });
    const forced = new Promise<void>((resolve) => {
      releaseForced = resolve;
    });
    const calls: Array<{ path: string; force: boolean }> = [];
    const refresh = createRefreshCoordinator(async (request) => {
      calls.push(request);
      await (request.force ? forced : normal);
    });

    const polling = refresh({ path: "C:/Notes", force: false });
    const mutation = refresh({ path: "C:/Notes", force: true });
    expect(calls).toEqual([{ path: "C:/Notes", force: false }]);

    releaseNormal();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(calls).toEqual([
      { path: "C:/Notes", force: false },
      { path: "C:/Notes", force: true },
    ]);
    releaseForced();
    await Promise.all([polling, mutation]);
  });
});

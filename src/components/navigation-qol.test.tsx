import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { searchLibrary } = vi.hoisted(() => ({ searchLibrary: vi.fn() }));
vi.mock("../services/native", () => ({ native: { searchLibrary } }));
import {
  formatRelativeDate,
  NoteListItem,
  QuickSwitcher,
} from "./navigation-qol";

const notes = [
  {
    path: "C:/Notes/Work/Project Alpha.md",
    title: "Project Alpha",
    tags: ["work", "planning"],
    body: "# Project Alpha\nRelease checklist",
  },
  {
    path: "C:/Notes/Personal/Café ideas.md",
    title: "Café ideas",
    tags: ["personal"],
    body: "Espresso tasting notes",
  },
  {
    path: "C:/Notes/Reference.md",
    title: "Reference",
    tags: ["alpha"],
    body: "A project is mentioned only in the body",
  },
];

describe("relative dates", () => {
  it("formats second, day, and invalid timestamps", () => {
    const now = Date.UTC(2026, 6, 30, 12);
    expect(formatRelativeDate(now, now, "en")).toBe("now");
    expect(formatRelativeDate(now - 24 * 60 * 60 * 1000, now, "en")).toBe("yesterday");
    expect(formatRelativeDate("not-a-date", now, "en")).toBe("Unknown date");
  });
});

describe("quick switcher", () => {
  beforeEach(() => searchLibrary.mockReset());

  it("uses native ranked results and selects the active result with Enter", async () => {
    searchLibrary.mockImplementation((_library: string, query: string) =>
      Promise.resolve(query ? [notes[1]] : notes),
    );
    const onSelect = vi.fn();
    render(
      <QuickSwitcher
        library="C:/Notes"
        onSelect={onSelect}
        onClose={() => undefined}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Find a note" });
    fireEvent.change(input, { target: { value: "cafe" } });
    expect(
      await screen.findByRole("option", { name: /Café ideas/ }),
    ).toBeInTheDocument();
    expect(searchLibrary).toHaveBeenLastCalledWith("C:/Notes", "cafe");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(notes[1]);
  });

  it("supports recent results, arrow navigation, Escape, and an empty state", async () => {
    searchLibrary.mockImplementation((_library: string, query: string) =>
      Promise.resolve(query ? [] : notes),
    );
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickSwitcher
        library="C:/Notes"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Find a note" });
    await screen.findByRole("option", { name: /Project Alpha/ });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(notes[1]);
    fireEvent.change(input, { target: { value: "no-result-here" } });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("No matching notes"),
    );
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("note cards", () => {
  it("shows readable Markdown excerpts and exposes open, pin, and context actions", () => {
    const onOpen = vi.fn();
    const onTogglePin = vi.fn();
    const onContextMenu = vi.fn();
    const note = {
      path: "C:/Notes/Plan.md",
      title: "Plan",
      tags: ["work"],
      updated: Date.UTC(2026, 6, 29, 12),
      body: "# Plan\n- [x] Read [[Project Alpha|the plan]] and **ship it**",
    };
    render(
      <NoteListItem
        note={note}
        active
        dirty
        pinned
        now={Date.UTC(2026, 6, 30, 12)}
        locale="en"
        onOpen={onOpen}
        onTogglePin={onTogglePin}
        onContextMenu={onContextMenu}
      />,
    );
    expect(screen.getByText("Read the plan and ship it")).toBeInTheDocument();
    expect(screen.getByText("yesterday")).toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Plan").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Unpin Plan" }));
    fireEvent.contextMenu(screen.getByRole("article"), { clientX: 24, clientY: 36 });
    expect(onOpen).toHaveBeenCalledWith(note);
    expect(onTogglePin).toHaveBeenCalledWith(note);
    expect(onContextMenu).toHaveBeenCalledWith(note, { x: 24, y: 36 });
  });

  it("renders the compact excerpt supplied by a virtualized note list", () => {
    render(
      <NoteListItem
        note={{
          path: "C:/Notes/Compact.md",
          title: "Compact",
          tags: [],
          updated: Date.now(),
          body: "A compact card excerpt, not the full searchable note text.",
        }}
        onOpen={() => undefined}
      />,
    );

    expect(
      screen.getByText("A compact card excerpt, not the full searchable note text."),
    ).toBeInTheDocument();
  });
});

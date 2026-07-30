import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  formatRelativeDate,
  fuzzyScore,
  NoteListItem,
  QuickSwitcher,
  scoreNote,
  TagCombobox,
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

describe("search ranking and relative dates", () => {
  it("prefers consecutive word-start matches and title matches", () => {
    expect(fuzzyScore("pa", "Project Alpha")).toBeGreaterThan(
      fuzzyScore("pa", "A project") ?? -Infinity,
    );
    expect(fuzzyScore("zzz", "Project Alpha")).toBeNull();
    expect(scoreNote("alpha", notes[0])).toBeGreaterThan(scoreNote("alpha", notes[2]) ?? 0);
  });

  it("formats second, day, and invalid timestamps", () => {
    const now = Date.UTC(2026, 6, 30, 12);
    expect(formatRelativeDate(now, now, "en")).toBe("now");
    expect(formatRelativeDate(now - 24 * 60 * 60 * 1000, now, "en")).toBe("yesterday");
    expect(formatRelativeDate("not-a-date", now, "en")).toBe("Unknown date");
  });
});

function TagHarness({ onAdd }: { onAdd: (tag: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <TagCombobox
      options={["Work", "Planning", "work"]}
      selectedTags={["Work"]}
      inputValue={value}
      onInputValueChange={setValue}
      onAdd={onAdd}
    />
  );
}

describe("tag combobox", () => {
  it("filters duplicate tags and commits an existing tag from the keyboard", () => {
    const onAdd = vi.fn();
    render(<TagHarness onAdd={onAdd} />);
    const input = screen.getByRole("combobox", { name: "Add a tag" });
    fireEvent.change(input, { target: { value: "plan" } });
    expect(screen.queryByRole("option", { name: "#Work" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "#Planning" })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Planning");
    expect(input).toHaveValue("");
  });

  it("offers and commits a new tag", () => {
    const onAdd = vi.fn();
    render(<TagHarness onAdd={onAdd} />);
    const input = screen.getByRole("combobox", { name: "Add a tag" });
    fireEvent.change(input, { target: { value: "release" } });
    fireEvent.click(screen.getByRole("option", { name: /Create release/ }));
    expect(onAdd).toHaveBeenCalledWith("release");
  });
});

describe("quick switcher", () => {
  it("fuzzy-filters notes and selects the active result with Enter", () => {
    const onSelect = vi.fn();
    render(<QuickSwitcher notes={notes} onSelect={onSelect} onClose={() => undefined} />);
    const input = screen.getByRole("combobox", { name: "Find a note" });
    fireEvent.change(input, { target: { value: "cafe" } });
    expect(screen.getByRole("option", { name: /Café ideas/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(notes[1]);
  });

  it("supports arrow navigation, Escape, and an empty state", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<QuickSwitcher notes={notes} onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Find a note" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(notes[1]);
    fireEvent.change(input, { target: { value: "no-result-here" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching notes");
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
});

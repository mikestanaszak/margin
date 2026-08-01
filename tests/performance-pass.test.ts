import { describe, expect, it, vi } from "vitest";
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: vi.fn() }),
}));
import {
  extractOutlineItems,
  noteListVirtualizationThreshold,
  shouldVirtualizeNoteList,
} from "../src/main";
import {
  createLargeLibraryFixture,
  createLongNoteFixture,
} from "./performance-fixtures";

describe("large-library performance fixtures", () => {
  it("extracts a long-note outline within an interactive budget", () => {
    const start = performance.now();
    const outline = extractOutlineItems(createLongNoteFixture());

    expect(outline).toHaveLength(600);
    expect(performance.now() - start).toBeLessThan(250);
  });

  it("uses virtualization only for large flat note lists", () => {
    const library = createLargeLibraryFixture();

    expect(library).toHaveLength(1_000);
    expect(shouldVirtualizeNoteList(library.length, false)).toBe(true);
    expect(
      shouldVirtualizeNoteList(noteListVirtualizationThreshold - 1, false),
    ).toBe(false);
    expect(shouldVirtualizeNoteList(library.length, true)).toBe(false);
  });
});

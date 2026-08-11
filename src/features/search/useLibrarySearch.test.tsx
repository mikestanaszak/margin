import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteSummary } from "../../app/types";

const { searchLibrary } = vi.hoisted(() => ({ searchLibrary: vi.fn() }));

vi.mock("../../services/native", () => ({ native: { searchLibrary } }));

import { useLibrarySearch } from "./useLibrarySearch";

const note = (path: string, title: string, updated = 1): NoteSummary => ({
  id: path,
  path,
  title,
  tags: [],
  updated,
  excerpt: "",
  folder: "",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useLibrarySearch", () => {
  beforeEach(() => searchLibrary.mockReset());

  it("preserves native rank order while applying the current filter scope", async () => {
    searchLibrary.mockResolvedValue([
      note("C:/Notes/Outside.md", "Outside"),
      note("C:/Notes/Work/Second.md", "Second"),
      note("C:/Notes/Work/First.md", "First"),
    ]);

    const { result } = renderHook(() =>
      useLibrarySearch({
        library: "C:/Notes",
        query: "alpha",
        scope: ["C:/Notes/Work/Second.md", "C:/Notes/Work/First.md"],
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(searchLibrary).toHaveBeenCalledWith("C:/Notes", "alpha");
    expect(result.current.results.map((item) => item.title)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("discards an older request after the query changes", async () => {
    const older = deferred<NoteSummary[]>();
    const newer = deferred<NoteSummary[]>();
    searchLibrary
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const { result, rerender } = renderHook(
      ({ query }) =>
        useLibrarySearch({ library: "C:/Notes", query, scope: "all" }),
      { initialProps: { query: "old" } },
    );
    rerender({ query: "new" });

    await act(async () => newer.resolve([note("New.md", "New result")]));
    expect(result.current.results.map((item) => item.title)).toEqual([
      "New result",
    ]);

    await act(async () => older.resolve([note("Old.md", "Stale result")]));
    expect(result.current.results.map((item) => item.title)).toEqual([
      "New result",
    ]);
  });

  it("uses an empty query to request native recent notes", async () => {
    searchLibrary.mockResolvedValue([
      note("Newest.md", "Newest", 30),
      note("Older.md", "Older", 10),
    ]);

    const { result } = renderHook(() =>
      useLibrarySearch({ library: "C:/Notes", query: "", scope: "all" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(searchLibrary).toHaveBeenCalledWith("C:/Notes", "");
    expect(result.current.results.map((item) => item.title)).toEqual([
      "Newest",
      "Older",
    ]);
  });
});

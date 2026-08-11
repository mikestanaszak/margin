import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteSummary } from "../../app/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

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
  beforeEach(() => invoke.mockReset());

  it("preserves native rank order while applying the current filter scope", async () => {
    invoke.mockResolvedValue([
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
    expect(invoke).toHaveBeenCalledWith("search_library", {
      libraryPath: "C:/Notes",
      query: "alpha",
      scope: "notes",
    });
    expect(result.current.results.map((item) => item.title)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("discards an older request after the query changes", async () => {
    const older = deferred<NoteSummary[]>();
    const newer = deferred<NoteSummary[]>();
    invoke
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
    invoke.mockResolvedValue([
      note("Newest.md", "Newest", 30),
      note("Older.md", "Older", 10),
    ]);

    const { result } = renderHook(() =>
      useLibrarySearch({ library: "C:/Notes", query: "", scope: "all" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invoke).toHaveBeenCalledWith("search_library", {
      libraryPath: "C:/Notes",
      query: "",
      scope: "notes",
    });
    expect(result.current.results.map((item) => item.title)).toEqual([
      "Newest",
      "Older",
    ]);
  });

  it("requests the deleted-note index only for an explicit trash scope", async () => {
    invoke.mockResolvedValue([
      note("C:/Notes/.markdown-notes/trash/Deleted.md", "Deleted alpha"),
    ]);

    const { result } = renderHook(() =>
      useLibrarySearch({
        library: "C:/Notes",
        query: "alpha",
        source: "trash",
        scope: "all",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invoke).toHaveBeenCalledWith("search_library", {
      libraryPath: "C:/Notes",
      query: "alpha",
      scope: "trash",
    });
    expect(result.current.results.map((item) => item.title)).toEqual([
      "Deleted alpha",
    ]);
  });

  it("discards a prior library response after the library changes", async () => {
    const oldLibrary = deferred<NoteSummary[]>();
    const newLibrary = deferred<NoteSummary[]>();
    invoke
      .mockReturnValueOnce(oldLibrary.promise)
      .mockReturnValueOnce(newLibrary.promise);

    const { result, rerender } = renderHook(
      ({ library }) =>
        useLibrarySearch({ library, query: "alpha", scope: "all" }),
      { initialProps: { library: "C:/Old" } },
    );
    rerender({ library: "C:/New" });

    await act(async () =>
      newLibrary.resolve([note("C:/New/Alpha.md", "New library")]),
    );
    expect(result.current.results.map((item) => item.title)).toEqual([
      "New library",
    ]);

    await act(async () =>
      oldLibrary.resolve([note("C:/Old/Alpha.md", "Old library")]),
    );
    expect(result.current.results.map((item) => item.title)).toEqual([
      "New library",
    ]);
  });

  it("discards a prior response after the filter scope changes", async () => {
    const oldScope = deferred<NoteSummary[]>();
    const newScope = deferred<NoteSummary[]>();
    invoke.mockReturnValueOnce(oldScope.promise).mockReturnValueOnce(newScope.promise);
    const alpha = note("C:/Notes/Alpha.md", "Alpha");
    const beta = note("C:/Notes/Beta.md", "Beta");

    const { result, rerender } = renderHook(
      ({ scope }) =>
        useLibrarySearch({ library: "C:/Notes", query: "a", scope }),
      { initialProps: { scope: [alpha.path] as readonly string[] } },
    );
    rerender({ scope: [beta.path] });

    await act(async () => newScope.resolve([alpha, beta]));
    expect(result.current.results.map((item) => item.title)).toEqual(["Beta"]);

    await act(async () => oldScope.resolve([alpha, beta]));
    expect(result.current.results.map((item) => item.title)).toEqual(["Beta"]);
  });
});

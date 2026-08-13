import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { native } from "./native";

describe("native service", () => {
  beforeEach(() => invoke.mockClear());

  it("passes search arguments to the native command", async () => {
    await native.searchLibrary("C:/Notes", "alpha");
    await native.searchLibrary("C:/Notes", "alpha", "trash");

    expect(invoke).toHaveBeenNthCalledWith(1, "search_library", {
      libraryPath: "C:/Notes",
      query: "alpha",
      scope: "notes",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "search_library", {
      libraryPath: "C:/Notes",
      query: "alpha",
      scope: "trash",
    });
  });

  it("omits an absent Daily template while preserving a supplied template", async () => {
    await native.appendQuickNote("C:/Notes", "A thought");
    await native.appendQuickNote("C:/Notes", "A thought", "# Daily");

    expect(invoke).toHaveBeenNthCalledWith(1, "append_quick_note", {
      libraryPath: "C:/Notes",
      text: "A thought",
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        invoke.mock.calls[0][1],
        "dailyTemplate",
      ),
    ).toBe(false);
    expect(invoke).toHaveBeenNthCalledWith(2, "append_quick_note", {
      libraryPath: "C:/Notes",
      text: "A thought",
      dailyTemplate: "# Daily",
    });
  });
});

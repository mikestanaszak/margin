import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { native } from "./native";

describe("native service", () => {
  it("passes search arguments to the native command", async () => {
    await native.searchLibrary("C:/Notes", "alpha");

    expect(invoke).toHaveBeenCalledWith("search_library", {
      libraryPath: "C:/Notes",
      query: "alpha",
    });
  });
});

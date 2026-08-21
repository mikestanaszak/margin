import { afterEach, describe, expect, it } from "vitest";
import {
  applyStoredAppearance,
  loadTheme,
  storeAppearance,
  themeStorageKey,
} from "./appearance";
import { paletteStorageKey } from "./theme-palettes";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});

describe("shared appearance preferences", () => {
  it("falls back to system for absent or invalid themes", () => {
    expect(loadTheme(null)).toBe("system");
    expect(loadTheme("sepia")).toBe("system");
  });

  it("stores and applies the same appearance in any webview", () => {
    storeAppearance({ theme: "dark", palette: "paper" });
    expect(localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(localStorage.getItem(paletteStorageKey)).toBe("paper");

    applyStoredAppearance();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.palette).toBe("paper");
  });
});

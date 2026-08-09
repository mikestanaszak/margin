import { describe, expect, it } from "vitest";
import { loadPalette, paletteOptions } from "./theme-palettes";

describe("palette preferences", () => {
  it("falls back to Mint for absent or invalid saved palettes", () => {
    expect(loadPalette(null)).toBe("mint");
    expect(loadPalette("violet")).toBe("mint");
  });

  it("accepts each shipped palette", () => {
    expect(loadPalette("paper")).toBe("paper");
    expect(paletteOptions.map(({ id }) => id)).toEqual(["ink", "mint", "linen", "paper"]);
  });
});

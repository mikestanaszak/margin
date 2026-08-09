export type Palette = "ink" | "mint" | "linen";

export const paletteStorageKey = "margin.palette";

export const paletteOptions = [
  { id: "ink", label: "Ink" },
  { id: "mint", label: "Mint" },
  { id: "linen", label: "Linen" },
] satisfies { id: Palette; label: string }[];

export function loadPalette(value: string | null): Palette {
  return value === "ink" || value === "mint" || value === "linen" ? value : "mint";
}

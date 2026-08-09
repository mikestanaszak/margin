export type Palette = "ink" | "mint" | "linen" | "paper";

export const paletteStorageKey = "margin.palette";

export const paletteOptions = [
  { id: "ink", label: "Ink" },
  { id: "mint", label: "Mint" },
  { id: "linen", label: "Linen" },
  { id: "paper", label: "Paper" },
] satisfies { id: Palette; label: string }[];

export function loadPalette(value: string | null): Palette {
  return value === "ink" || value === "mint" || value === "linen" || value === "paper" ? value : "mint";
}

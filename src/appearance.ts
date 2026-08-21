import {
  loadPalette,
  paletteStorageKey,
  type Palette,
} from "./theme-palettes";

export type Theme = "system" | "light" | "dark";
export type Appearance = { theme: Theme; palette: Palette };
export const themeStorageKey = "markdown-notes.theme";

export function loadTheme(value: string | null): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function applyAppearance({ theme, palette }: Appearance) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = palette;
}

export function storeAppearance(preferences: Appearance) {
  localStorage.setItem(themeStorageKey, preferences.theme);
  localStorage.setItem(paletteStorageKey, preferences.palette);
}

export function applyStoredAppearance(): Appearance {
  const preferences = {
    theme: loadTheme(localStorage.getItem(themeStorageKey)),
    palette: loadPalette(localStorage.getItem(paletteStorageKey)),
  };
  applyAppearance(preferences);
  return preferences;
}

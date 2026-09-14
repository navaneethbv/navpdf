import type { Preferences } from "../types/document";

export type ThemePreference = Preferences["theme"];

export function resolveTheme(theme: ThemePreference, systemDark: boolean) {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function applyTheme(theme: ThemePreference, systemDark: boolean) {
  const resolved = resolveTheme(theme, systemDark);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

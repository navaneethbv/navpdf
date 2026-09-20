import type { ColorPalette, Preferences } from "../types/document";
import { customThemeTokens } from "./theme-colors";

const overrideTokens = [
  "surface",
  "surface-2",
  "canvas",
  "input",
  "ink",
  "muted",
  "line",
  "accent",
  "accent-strong",
  "accent-ink",
  "on-accent",
  "brand",
  "on-brand",
  "selection-fill",
  "accent-soft",
];

export type ThemePreference = Preferences["theme"];
export const colorPalettes: { value: ColorPalette; label: string }[] = [
  { value: "default", label: "Default · Forest green" },
  { value: "amber", label: "Amber · Golden yellow" },
  { value: "coral", label: "Coral · Warm orange" },
  { value: "ocean", label: "Ocean · Coastal blue" },
  { value: "violet", label: "Violet · Soft purple" },
  { value: "acrobat", label: "Acrobat · Neutral gray" },
  { value: "midnight", label: "Midnight · Indigo" },
  { value: "graphite", label: "Graphite · Monochrome" },
  { value: "rose", label: "Rose · Soft pink" },
  { value: "crimson", label: "Crimson · Ruby red" },
  { value: "mint", label: "Mint · Fresh green" },
  { value: "teal", label: "Teal · Lagoon" },
  { value: "lime", label: "Lime · Citrus green" },
  { value: "sepia", label: "Sepia · Warm paper" },
  { value: "slate", label: "Slate · Blue gray" },
];

export function resolveTheme(theme: ThemePreference, systemDark: boolean) {
  if (theme === "system") {
    return systemDark ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(
  theme: ThemePreference,
  systemDark: boolean,
  palettes?: Pick<Preferences, "lightPalette" | "darkPalette"> &
    Partial<Pick<Preferences, "lightOverrides" | "darkOverrides">>,
) {
  const resolved = resolveTheme(theme, systemDark);
  const palette = resolved === "dark" ? palettes?.darkPalette : palettes?.lightPalette;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.palette =
    colorPalettes.find((entry) => entry.value === palette)?.value ?? "default";
  document.documentElement.style.colorScheme = resolved;
  const root = document.documentElement;
  for (const token of overrideTokens) root.style.removeProperty(`--${token}`);
  const overrides = resolved === "dark" ? palettes?.darkOverrides : palettes?.lightOverrides;
  if (overrides) {
    const tokens = customThemeTokens(overrides);
    for (const [token, value] of Object.entries(tokens))
      root.style.setProperty(`--${token}`, value);
  }
}

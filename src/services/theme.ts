import type { ColorPalette, Preferences } from "../types/document";

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
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function applyTheme(
  theme: ThemePreference,
  systemDark: boolean,
  palettes?: Pick<Preferences, "lightPalette" | "darkPalette">,
) {
  const resolved = resolveTheme(theme, systemDark);
  const palette = resolved === "dark" ? palettes?.darkPalette : palettes?.lightPalette;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.palette =
    colorPalettes.find((entry) => entry.value === palette)?.value ?? "default";
  document.documentElement.style.colorScheme = resolved;
}

import type { ColorPalette, Preferences } from "../types/document";

export type ThemePreference = Preferences["theme"];
export const colorPalettes: { value: ColorPalette; label: string }[] = [
  { value: "default", label: "Default · Forest green" },
  { value: "amber", label: "Amber · Golden yellow" },
  { value: "coral", label: "Coral · Warm orange" },
  { value: "ocean", label: "Ocean · Coastal blue" },
  { value: "violet", label: "Violet · Soft purple" },
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

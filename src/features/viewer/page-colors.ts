// Replacement page colours for reading. PDF.js draws text and line art in the foreground colour
// and fills the page with the background colour; images keep their own colours.

import type { PageColorScheme, Preferences } from "../../types/document";

export interface PageColors {
  foreground: string;
  background: string;
}

const PRESETS = new Map<PageColorScheme, PageColors>([
  ["white-on-black", { foreground: "#ffffff", background: "#000000" }],
  ["yellow-on-black", { foreground: "#ffff00", background: "#000000" }],
  ["green-on-black", { foreground: "#00ff00", background: "#000000" }],
  ["black-on-white", { foreground: "#000000", background: "#ffffff" }],
]);

export const PAGE_COLOR_LABELS: Record<PageColorScheme, string> = {
  off: "Use the document's colours",
  "white-on-black": "White text on black",
  "yellow-on-black": "Yellow text on black",
  "green-on-black": "Green text on black",
  "black-on-white": "Black text on white",
  custom: "Custom colours",
};

/** The colours to draw pages with, or null to keep the document's own colours. */
export function pageColorsFor(
  preferences: Pick<Preferences, "pageColors" | "pageForeground" | "pageBackground">,
): PageColors | null {
  if (preferences.pageColors === "custom")
    return { foreground: preferences.pageForeground, background: preferences.pageBackground };
  return PRESETS.get(preferences.pageColors) ?? null;
}

/** WCAG relative luminance of a "#rrggbb" colour. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two "#rrggbb" colours, from 1 to 21. */
export function contrastRatio(first: string, second: string) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

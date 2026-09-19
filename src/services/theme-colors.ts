import type { ThemeOverrides } from "../types/document";

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

function channels(hex: string) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function readableText(background: string) {
  const [r, g, b] = channels(background).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

function mix(a: string, b: string, fraction: number) {
  const other = channels(b);
  return `#${channels(a)
    .map((channel, index) =>
      Math.round(channel * (1 - fraction) + other[index] * fraction)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function customThemeTokens(
  overrides: ThemeOverrides,
  baseBackground: string,
  baseAccent: string,
) {
  const background = isThemeColor(overrides.background) ? overrides.background : baseBackground;
  const accent = isThemeColor(overrides.accent) ? overrides.accent : baseAccent;
  const tokens: Record<string, string> = {};
  if (isThemeColor(overrides.background)) {
    const ink = readableText(background);
    // Move related surfaces away from the text color to retain its contrast.
    const shade = ink === "#000000" ? "#ffffff" : "#000000";
    Object.assign(tokens, {
      surface: background,
      "surface-2": mix(background, shade, 0.06),
      canvas: mix(background, shade, 0.14),
      input: background,
      ink,
      muted: ink,
      line: mix(background, ink, 0.4),
    });
  }
  if (isThemeColor(overrides.accent)) {
    const onAccent = readableText(accent);
    Object.assign(tokens, {
      accent,
      "accent-strong": mix(accent, onAccent === "#000000" ? "#ffffff" : "#000000", 0.12),
      "on-accent": onAccent,
      brand: accent,
      "on-brand": onAccent,
      "selection-fill": `rgb(${channels(accent).join(" ")} / 18%)`,
    });
  }
  if (Object.keys(tokens).length) {
    // Retain the surface foreground contrast for selected controls.
    tokens["accent-soft"] = background;
  }
  return tokens;
}

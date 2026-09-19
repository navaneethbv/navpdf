import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorPalettes } from "../../src/services/theme";

const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
function tokens(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing theme selector ${selector}`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1], match[2]]),
  );
}
function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe.each(["light", "dark"])("%s palette contrast", (mode) => {
  it.each(colorPalettes)("$value keeps UI text legible and PDF paper unchanged", ({ value }) => {
    const base = tokens(":root");
    const palette =
      value === "default" ? {} : tokens(`:root[data-theme="${mode}"][data-palette="${value}"]`);
    const resolved = {
      ...base,
      ...(mode === "dark" ? tokens(':root[data-theme="dark"]') : {}),
      ...palette,
    };
    for (const [foreground, background] of [
      ["ink", "surface"],
      ["ink", "surface-2"],
      ["ink", "input"],
      ["muted", "surface"],
      ["muted", "surface-2"],
      ["on-accent", "accent"],
      ["on-accent", "accent-strong"],
      ["on-brand", "brand"],
      ["ink", "accent-soft"],
    ]) {
      const a = luminance(resolved[foreground]);
      const b = luminance(resolved[background]);
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        `${mode}/${value}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(resolved.page).toBe(base.page);
    expect(resolved["page-ink"]).toBe(base["page-ink"]);
  });
});

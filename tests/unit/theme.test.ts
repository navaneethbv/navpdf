// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, colorPalettes, resolveTheme } from "../../src/services/theme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  document.documentElement.style.colorScheme = "";
});

describe("theme preferences", () => {
  it("resolves system mode from the operating system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("applies the resolved theme to the document", () => {
    applyTheme("dark", false);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    applyTheme("system", false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("uses independent palette choices when System changes modes", () => {
    const palettes = { lightPalette: "amber", darkPalette: "ocean" } as const;
    applyTheme("system", false, palettes);
    expect(document.documentElement.dataset.palette).toBe("amber");
    applyTheme("system", true, palettes);
    expect(document.documentElement.dataset.palette).toBe("ocean");
  });

  it.each(colorPalettes)("supports $value in both modes", ({ value }) => {
    const palettes = { lightPalette: value, darkPalette: value };
    for (const theme of ["light", "dark"] as const) {
      applyTheme(theme, false, palettes);
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(document.documentElement.dataset.palette).toBe(value);
    }
  });

  it("falls back to Default for legacy or unrecognized palette values", () => {
    applyTheme("light", false);
    expect(document.documentElement.dataset.palette).toBe("default");
    applyTheme("dark", false, { lightPalette: "amber", darkPalette: "unknown" } as never);
    expect(document.documentElement.dataset.palette).toBe("default");
  });
});

it("offers 15 distinct palettes for either mode", () => {
  expect(colorPalettes).toHaveLength(15);
  expect(new Set(colorPalettes.map(({ value }) => value)).size).toBe(15);
});

it("switches independent custom colors with System and removes overrides on reset", () => {
  const settings = {
    lightPalette: "amber",
    darkPalette: "ocean",
    lightOverrides: { background: "#ffffff", accent: "#ffff00" },
    darkOverrides: { background: "#101020", accent: "#ff8800" },
  } as const;
  applyTheme("system", false, settings);
  expect(document.documentElement.style.getPropertyValue("--surface")).toBe("#ffffff");
  expect(document.documentElement.style.getPropertyValue("--on-accent")).toBe("#000000");
  applyTheme("system", true, settings);
  expect(document.documentElement.style.getPropertyValue("--surface")).toBe("#101020");
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff8800");
  applyTheme("light", false);
  expect(document.documentElement.style.getPropertyValue("--surface")).toBe("");
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
});

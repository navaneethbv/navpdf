// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, resolveTheme } from "../../src/services/theme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
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
});

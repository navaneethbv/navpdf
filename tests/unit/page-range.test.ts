import { describe, expect, it } from "vitest";
import { parsePageRange } from "../../src/features/pages/page-range";

describe("page range parser", () => {
  it("returns sorted zero based indices for a custom range", () => {
    expect(parsePageRange("5, 2-3, 2", 6)).toEqual([1, 2, 4]);
  });

  it("rejects a range that matches no pages", () => {
    expect(() => parsePageRange("99", 10)).toThrow("No pages match");
  });

  it("rejects incomplete ranges", () => {
    expect(() => parsePageRange("3-", 10)).toThrow("Incomplete range");
  });
});

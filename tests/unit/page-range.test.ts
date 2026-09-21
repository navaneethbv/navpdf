import { describe, expect, it } from "vitest";
import { parsePageRange } from "../../src/features/pages/page-range";

describe("page range parser", () => {
  it("bounds huge ascending and descending ranges to existing pages", () => {
    expect(parsePageRange("0-9007199254740991", 3)).toEqual([0, 1, 2]);
    expect(parsePageRange("9007199254740991-2", 3)).toEqual([1, 2]);
    expect(() => parsePageRange("1000000000-2000000000", 3)).toThrow("No pages match");
  });

  it.each(["9007199254740992", "1-9007199254740992", "9".repeat(400)])(
    "rejects an unrepresentable page number: %s",
    (range) => {
      expect(() => parsePageRange(range, 3)).toThrow("safe integers");
    },
  );

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

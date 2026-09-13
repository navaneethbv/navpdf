import { describe, expect, it } from "vitest";
import { parsePageRange } from "../../src/features/pages/print-range";

describe("parsePageRange", () => {
  it("returns every page index for the whole document", () => {
    expect(parsePageRange("all", "", 1, 4)).toEqual([0, 1, 2, 3]);
  });

  it("returns only the current page", () => {
    expect(parsePageRange("current", "", 3, 4)).toEqual([2]);
  });

  it("parses mixed ranges and single pages", () => {
    expect(parsePageRange("custom", "1-3, 5", 1, 6)).toEqual([0, 1, 2, 4]);
  });

  it("sorts, deduplicates, and clamps out-of-range input", () => {
    expect(parsePageRange("custom", "5, 2-3, 2, 99", 1, 6)).toEqual([1, 2, 4]);
  });

  it("handles reversed ranges", () => {
    expect(parsePageRange("custom", "4-2", 1, 6)).toEqual([1, 2, 3]);
  });

  it("rejects a custom range that selects nothing", () => {
    expect(() => parsePageRange("custom", "", 1, 4)).toThrow(/page range/i);
    expect(() => parsePageRange("custom", "abc", 1, 4)).toThrow(/page range/i);
    expect(() => parsePageRange("custom", "99", 1, 4)).toThrow(/page range/i);
  });
});

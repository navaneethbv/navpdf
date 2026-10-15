import { describe, expect, it } from "vitest";
import {
  parseSelectionRange,
  presetSelection,
  reversePageOrder,
  moveSelectionBefore,
  fixedPageGroups,
  individualPageGroups,
} from "../../src/features/pages/page-selection";

describe("bounded page selections", () => {
  it("sorts and deduplicates mixed ranges, including descending ranges", () => {
    expect(parseSelectionRange("5-3, 1, 3", 5)).toEqual([0, 2, 3, 4]);
  });

  it.each(["", "1,", "1,,2", "3-", "1.2", "0", "1-6", "9007199254740992"])(
    "rejects an invalid range atomically: %s",
    (range) => expect(() => parseSelectionRange(range, 5)).toThrow(),
  );

  it("rejects oversized inputs before expanding them", () => {
    expect(() => parseSelectionRange("1,".repeat(10000), 5)).toThrow(/long/i);
    expect(() => reversePageOrder(Number.MAX_SAFE_INTEGER)).toThrow(/page count/i);
  });

  it("uses one-based odd/even numbers and inverts the selection", () => {
    expect(presetSelection("odd", 5, [])).toEqual([0, 2, 4]);
    expect(presetSelection("even", 5, [])).toEqual([1, 3]);
    expect(presetSelection("invert", 5, [0, 2, 4])).toEqual([1, 3]);
    expect(presetSelection("even", 1, [])).toEqual([]);
    expect(reversePageOrder(1)).toEqual([0]);
  });

  it("moves selections in source order before a page or to the end", () => {
    expect(moveSelectionBefore(6, [3, 1], 0)).toEqual([1, 3, 0, 2, 4, 5]);
    expect(moveSelectionBefore(6, [1, 3], 4)).toEqual([0, 2, 1, 3, 4, 5]);
    expect(moveSelectionBefore(6, [1, 3], "end")).toEqual([0, 2, 4, 5, 1, 3]);
  });

  it("rejects a destination in the selection and invalid or empty selections", () => {
    expect(() => moveSelectionBefore(4, [1, 2], 2)).toThrow(/outside the selection/);
    expect(() => moveSelectionBefore(4, [], "end")).toThrow(/Select/);
    expect(() => moveSelectionBefore(4, [4], "end")).toThrow(/outside/);
    expect(() => moveSelectionBefore(4, [1], 0.5)).toThrow(/destination/i);
    expect(() => moveSelectionBefore(4, [1], 4)).toThrow(/destination/i);
  });

  it("splits into complete fixed-size groups and a shorter final group", () => {
    expect(fixedPageGroups(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(fixedPageGroups(1, 1)).toEqual([[0]]);
    expect(individualPageGroups(5, [3, 1, 3])).toEqual([[1], [3]]);
  });

  it.each([0, -1, 1.5, Infinity, 6])("rejects an invalid group size: %s", (count) => {
    expect(() => fixedPageGroups(5, count)).toThrow(/Pages per file/);
  });

  it("bounds archive entries and rejects an empty export", () => {
    expect(() => fixedPageGroups(1001, 1)).toThrow(/1,000/);
    expect(() => individualPageGroups(4, [])).toThrow(/Select/);
  });
});

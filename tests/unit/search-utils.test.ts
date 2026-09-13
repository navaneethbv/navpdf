// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { boundedZoom, clampPage, snippet } from "../../src/utils/search";
import { positionSearchCursor } from "../../src/features/search/select-result";
import type { PDFFindController } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

describe("search utils", () => {
  it("builds a context snippet with ellipses", () => {
    const text = `lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ${"x".repeat(200)} end`;
    const out = snippet(text, 10, 5);
    expect(out).toContain("lorem");
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("…")).toBe(false);
    expect(out).not.toMatch(/\s{2,}/);
  });

  it("marks both ends when the match is in the middle", () => {
    const text = `${"a".repeat(100)}MATCH${"b".repeat(100)}`;
    const out = snippet(text, 100, 5);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("clamps page numbers to the document range", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(4.6, 10)).toBe(5);
    expect(clampPage(Number.NaN, 10)).toBe(1);
    expect(clampPage(3, 10)).toBe(3);
  });

  it("bounds zoom between 25% and 500%", () => {
    expect(boundedZoom(0)).toBe(0.25);
    expect(boundedZoom(99)).toBe(5);
    expect(boundedZoom(1.5)).toBe(1.5);
    expect(boundedZoom(Number.NaN)).toBe(1);
    expect(boundedZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("positionSearchCursor", () => {
  function findWith(matches: number[][], offset?: object) {
    return { pageMatches: matches, _offset: offset } as unknown as PDFFindController;
  }

  it("synchronizes the cursor before Find Again", () => {
    const offset = { pageIdx: 0, matchIdx: 0, wrapped: true };
    const find = findWith([[5, 20]], offset);
    expect(positionSearchCursor(find, 1, 1)).toBe(true);
    expect(offset).toMatchObject({ pageIdx: 0, matchIdx: 0, wrapped: false });
  });

  it("accepts a zero-offset match on the page", () => {
    const offset = { pageIdx: 3, matchIdx: 3, wrapped: false };
    const find = findWith([[0]], offset);
    expect(positionSearchCursor(find, 1, 0)).toBe(true);
    expect(offset.pageIdx).toBe(0);
  });

  it("rejects missing matches and missing cursor state", () => {
    expect(positionSearchCursor(findWith([[]], {}), 1, 0)).toBe(false);
    expect(
      positionSearchCursor(findWith([[4]], undefined), 1, 0),
    ).toBe(false);
    expect(positionSearchCursor(findWith([[4]], {}), 2, 0)).toBe(false);
  });
});

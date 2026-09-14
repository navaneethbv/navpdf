// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextSelectionGeometry } from "../../src/features/viewer/selection-geometry";

describe("readTextSelectionGeometry", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns rotated-page PDF quads for a selected text range", async () => {
    const root = document.createElement("div");
    const page = document.createElement("div");
    page.className = "page";
    page.dataset.pageNumber = "2";
    root.append(page);
    document.body.append(root);
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      right: 500,
      bottom: 650,
      width: 400,
      height: 600,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });
    const text = document.createElement("span");
    text.textContent = "mark this";
    page.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    vi.spyOn(range, "getClientRects").mockReturnValue([
      {
        left: 140,
        top: 110,
        right: 300,
        bottom: 130,
        width: 160,
        height: 20,
        x: 140,
        y: 110,
        toJSON: () => ({}),
      } as DOMRect,
    ]);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const result = await readTextSelectionGeometry(root, async () => ({
      width: 600,
      height: 400,
      convertToPdfPoint: (x, y) => [y, 600 - x],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ page: 2, text: "mark this" });
    expect(result[0].quads[0]).toMatchObject({ x1: 40, y1: 300, y2: 540 });
    expect(result[0].quads[0].x2).toBeCloseTo(53.3333, 4);
  });

  it("returns no geometry for an empty selection", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    expect(
      await readTextSelectionGeometry(root, async () => ({
        width: 1,
        height: 1,
        convertToPdfPoint: (x, y) => [x, y],
      })),
    ).toEqual([]);
  });
});

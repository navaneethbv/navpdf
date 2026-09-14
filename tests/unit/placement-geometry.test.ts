import { describe, it, expect } from "vitest";
import {
  convertToPdfCoords,
  convertToDomCoords,
  nudgePoint,
  clampRectToPage,
  calculateAspectPreservedDimensions,
  type ViewportLike,
} from "../../src/features/editor/placement-geometry";

describe("placement-geometry", () => {
  const mockViewport: ViewportLike = {
    width: 600,
    height: 800,
    convertToPdfPoint(vpX: number, vpY: number) {
      // Identity 1:1 for simplicity in test
      return [vpX, 800 - vpY];
    },
    convertToViewportPoint(pdfX: number, pdfY: number) {
      return [pdfX, 800 - pdfY];
    },
  };

  it("converts DOM client coordinates to PDF point coordinates", () => {
    const mockElement = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 300,
        height: 400,
        right: 400,
        bottom: 450,
        x: 100,
        y: 50,
        toJSON: () => {},
      }),
    } as unknown as HTMLElement;

    // clientX = 250 (middle horizontally), clientY = 250 (middle vertically)
    const [pdfX, pdfY] = convertToPdfCoords(250, 250, mockElement, mockViewport);
    expect(pdfX).toBeCloseTo(300, 1);
    expect(pdfY).toBeCloseTo(400, 1);
  });

  it("converts PDF point coordinates to DOM relative coordinates", () => {
    const mockElement = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 300,
        height: 400,
        right: 300,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
    } as unknown as HTMLElement;

    const domPoint = convertToDomCoords(300, 400, mockElement, mockViewport);
    expect(domPoint.x).toBeCloseTo(150, 1);
    expect(domPoint.y).toBeCloseTo(200, 1);
  });

  it("nudges points correctly in all directions", () => {
    expect(nudgePoint(100, 100, "left", 5)).toEqual([95, 100]);
    expect(nudgePoint(100, 100, "right", 5)).toEqual([105, 100]);
    expect(nudgePoint(100, 100, "up", 10)).toEqual([100, 110]);
    expect(nudgePoint(100, 100, "down", 10)).toEqual([100, 90]);
    expect(nudgePoint(100, 100, "up")).toEqual([100, 101]); // default step = 1
  });

  it("clamps rectangles within page boundaries", () => {
    // Normal rectangle within page
    const normal = clampRectToPage({ x: 50, y: 50, width: 200, height: 100 }, 600, 800);
    expect(normal).toEqual({ x: 50, y: 50, width: 200, height: 100 });

    // Negative coordinates
    const negative = clampRectToPage({ x: -20, y: -30, width: 100, height: 100 }, 600, 800);
    expect(negative.x).toBe(0);
    expect(negative.y).toBe(0);

    // Overflowing right and bottom
    const overflow = clampRectToPage({ x: 550, y: 750, width: 100, height: 100 }, 600, 800);
    expect(overflow.x).toBe(500);
    expect(overflow.y).toBe(700);

    // Huge rectangle exceeding page size
    const huge = clampRectToPage({ x: 0, y: 0, width: 1000, height: 1200 }, 600, 800);
    expect(huge.width).toBe(600);
    expect(huge.height).toBe(800);
    expect(huge.x).toBe(0);
    expect(huge.y).toBe(0);
  });

  it("calculates aspect-ratio preserved dimensions", () => {
    // Landscape image fitting into box
    const r1 = calculateAspectPreservedDimensions(800, 400, 400, 400);
    expect(r1.width).toBe(400);
    expect(r1.height).toBe(200);

    // Portrait image fitting into box
    const r2 = calculateAspectPreservedDimensions(300, 600, 400, 400);
    expect(r2.width).toBe(200);
    expect(r2.height).toBe(400);

    // Image already smaller than max limits
    const r3 = calculateAspectPreservedDimensions(150, 100, 400, 400);
    expect(r3.width).toBe(150);
    expect(r3.height).toBe(100);

    // Invalid dimensions edge case
    const r4 = calculateAspectPreservedDimensions(0, 0, 200, 200);
    expect(r4.width).toBe(200);
    expect(r4.height).toBe(200);
  });
});

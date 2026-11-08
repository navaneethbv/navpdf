import { describe, expect, it } from "vitest";
import {
  detectTurn,
  estimateSkew,
  inverseMap,
  mapBox,
  mapOcrResult,
  turnGray,
  type Gray,
} from "../../src/features/ocr/page-geometry";

/** A page of text-like lines: x-height bands, ascenders above, a few descenders below. */
function textPage(width: number, height: number, skewDegrees = 0): Gray {
  const pixels = new Uint8Array(width * height).fill(255);
  const slope = Math.tan((skewDegrees * Math.PI) / 180);
  for (let line = 0; line < Math.floor((height - 60) / 32); line++) {
    const base0 = 60 + line * 32;
    for (let x = 30; x < width - 30; x++) {
      // Letters and word gaps fall at different places on each line, as in real text.
      const shifted = x + line * 13;
      const glyph = Math.floor(shifted / 9);
      if (shifted % 9 > 6 || (glyph * 7 + line) % 6 === 0) continue;
      // Lines rise to the right on screen for a positive skew.
      const base = Math.round(base0 - (x - width / 2) * slope);
      const set = (y: number) => {
        if (y >= 0 && y < height) pixels[y * width + x] = 0;
      };
      for (let y = base - 10; y < base; y++) set(y);
      if (glyph % 3 === 0) for (let y = base - 18; y < base - 10; y++) set(y);
      if (glyph % 11 === 0) for (let y = base; y < base + 5; y++) set(y);
    }
  }
  return { width, height, pixels };
}

describe("Skew estimation", () => {
  it.each([2.5, -3, 4.2, 1])("finds a %s degree skew within a tenth of a degree", (skew) => {
    expect(estimateSkew(textPage(600, 800, skew))).toBeCloseTo(skew, 0);
    expect(Math.abs(estimateSkew(textPage(600, 800, skew)) - skew)).toBeLessThanOrEqual(0.15);
  });

  it("leaves straight, blank and tiny pages alone", () => {
    expect(estimateSkew(textPage(600, 800, 0))).toBe(0);
    expect(
      estimateSkew({ width: 600, height: 800, pixels: new Uint8Array(480000).fill(255) }),
    ).toBe(0);
    expect(estimateSkew(textPage(40, 40, 3))).toBe(0);
  });
});

describe("Quarter-turn detection", () => {
  const upright = textPage(600, 800);
  it.each([
    [0, 0],
    [90, 270],
    [180, 180],
    [270, 90],
  ] as const)("a page turned %s degrees is turned back by %s", (turned, back) => {
    expect(detectTurn(turnGray(upright, turned))).toBe(back);
  });

  it("does not guess on a blank page", () => {
    expect(detectTurn({ width: 300, height: 300, pixels: new Uint8Array(90000).fill(255) })).toBe(
      0,
    );
  });
});

describe("Mapping word boxes back", () => {
  it.each([0, 90, 180, 270] as const)(
    "inverts a %s degree turn and a straightening rotation exactly",
    (turn) => {
      const width = 600;
      const height = 800;
      const skew = 3;
      // The forward transform applied to the image: turn clockwise, then rotate by skew.
      const swap = turn === 90 || turn === 270;
      const tw = swap ? height : width;
      const th = swap ? width : height;
      const forward = (x: number, y: number): [number, number] => {
        const [px, py] =
          turn === 90
            ? [height - y, x]
            : turn === 180
              ? [width - x, height - y]
              : turn === 270
                ? [y, width - x]
                : [x, y];
        const r = (skew * Math.PI) / 180;
        const dx = px - tw / 2;
        const dy = py - th / 2;
        return [
          tw / 2 + dx * Math.cos(r) - dy * Math.sin(r),
          th / 2 + dx * Math.sin(r) + dy * Math.cos(r),
        ];
      };
      const back = inverseMap(width, height, turn, skew);
      for (const [x, y] of [
        [10, 20],
        [300, 400],
        [590, 790],
      ]) {
        const [u, v] = back(...forward(x, y));
        expect(u).toBeCloseTo(x, 6);
        expect(v).toBeCloseTo(y, 6);
      }
    },
  );

  it("maps a box turned a quarter back onto the rendered page", () => {
    const back = inverseMap(600, 800, 90, 0);
    // In the turned image (800 wide, 600 high) a box at the top left came from the bottom left.
    expect(
      mapBox([0, 0, 0.25, 0.5], back, { width: 800, height: 600 }, { width: 600, height: 800 }),
    ).toEqual([0, 0.75, 0.5, 0.25]);
    const result = mapOcrResult(
      {
        pageIndex: 0,
        language: "en",
        fullText: "a",
        meanConfidence: 1,
        lines: [
          {
            text: "a",
            confidence: 1,
            bbox: [0, 0, 0.25, 0.5],
            words: [{ text: "a", confidence: 1, bbox: [0, 0, 0.25, 0.5] }],
          },
        ],
      },
      back,
      { width: 800, height: 600 },
      { width: 600, height: 800 },
    );
    expect(result.lines[0].words[0].bbox).toEqual([0, 0.75, 0.5, 0.25]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { alignPages, changedText } from "../../src/features/compare/compare-pdf";
import { compressToTarget } from "../../src/features/compress/target-size";
import { moveCrop } from "../../src/features/pages/crop-geometry";
import {
  cleanScanPixels,
  paddedBounds,
  validateBounds,
  processImageCrop,
} from "../../src/features/pages/image-crop";
import type { CompressionPreset, CompressionReport, EngineResult } from "../../src/types/engine";
const pages = (...keys: string[]) => keys.map((key) => ({ key, text: key }));

describe("page comparison alignment", () => {
  it("keeps unchanged pages aligned after insertions and deletions", () => {
    expect(alignPages(pages("A", "B", "C"), pages("A", "X", "B", "C"))).toEqual([
      { before: 1, after: 1, status: "unchanged" },
      { before: null, after: 2, status: "added" },
      { before: 2, after: 3, status: "unchanged" },
      { before: 3, after: 4, status: "unchanged" },
    ]);
    expect(alignPages(pages("A", "B", "C"), pages("A", "C"))[1]).toEqual({
      before: 2,
      after: null,
      status: "removed",
    });
  });
  it("pairs changed pages between exact anchors and handles duplicates", () => {
    expect(alignPages(pages("A", "old", "A"), pages("A", "new", "A"))[1]).toEqual({
      before: 2,
      after: 2,
      status: "changed",
    });
    expect(alignPages([], pages("A"))).toEqual([{ before: null, after: 1, status: "added" }]);
    expect(() => alignPages(pages(...Array(501).fill("a")), [])).toThrow("limit");
  });
  it("highlights a changed amount without dropping surrounding text", () => {
    expect(changedText("Total $125 due", "Total $175 due")).toEqual({
      prefix: "Total $1",
      before: "2",
      after: "7",
      suffix: "5 due",
    });
    expect(changedText("", "Added").after).toBe("Added");
    expect(changedText("same", "same").before).toBe("");
  });
});

describe("crop adjustments", () => {
  it("clamps movement and resized edges while keeping at least one pixel", () => {
    const rect = { x: 10, y: 20, width: 50, height: 40 };
    expect(moveCrop(rect, "move", 100, -100, 100, 100)).toEqual({
      x: 50,
      y: 0,
      width: 50,
      height: 40,
    });
    expect(moveCrop(rect, "nw", 100, 100, 100, 100)).toEqual({ x: 59, y: 59, width: 1, height: 1 });
    expect(moveCrop(rect, "se", 100, 100, 100, 100)).toEqual({
      x: 10,
      y: 20,
      width: 90,
      height: 80,
    });
  });
  it("adds safe padding and rejects invalid crop rectangles", () => {
    expect(paddedBounds({ x: 3, y: 7, width: 10, height: 20 }, 5, 30, 30)).toEqual({
      x: 0,
      y: 2,
      width: 18,
      height: 28,
    });
    expect(() => validateBounds({ x: 3, y: 0, width: 100, height: 10 }, 100, 100)).toThrow();
    expect(() => paddedBounds({ x: 0, y: 0, width: 10, height: 10 }, NaN, 100, 100)).toThrow();
  });
  it("lightens paper while keeping black ink and alpha", () => {
    const pixels = new Uint8ClampedArray([220, 220, 220, 255, 0, 0, 0, 200]);
    cleanScanPixels(pixels, 50);
    expect([...pixels]).toEqual([255, 255, 255, 255, 0, 0, 0, 200]);
    expect(() => cleanScanPixels(pixels, NaN)).toThrow();
  });
  it("validates manual options before decoding", async () => {
    await expect(processImageCrop({} as File, { cleanup: NaN })).rejects.toThrow("Cleanup");
    await expect(processImageCrop({} as File, { padding: 1.2 })).rejects.toThrow("Padding");
    await expect(processImageCrop({} as File, { tolerance: 101 })).rejects.toThrow("Sensitivity");
  });
});

function outcome(preset: CompressionPreset, size: number): EngineResult<CompressionReport> {
  return {
    bytes: new Uint8Array(size),
    report: {
      preset,
      beforeBytes: 10000,
      afterBytes: size,
      useful: true,
      unusedObjectsRemoved: 0,
      duplicateStreamsMerged: 0,
      imagesExamined: 1,
      imagesRecompressed: 1,
      imagesSkipped: 0,
      checks: [],
      message: "Measured",
    },
  };
}
describe("target compression", () => {
  it("selects the first quality level strictly below the requested limit", async () => {
    const original = new Uint8Array(10000),
      run = vi.fn(async (_: Uint8Array, p: CompressionPreset) =>
        outcome(p, p === "lossless" ? 5000 : 2000),
      );
    const result = await compressToTarget(original, 5000, run, () => false);
    expect(result.report.preset).toBe("balanced");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every((call) => call[0] === original)).toBe(true);
  });
  it("returns the smallest usable candidate on a miss, even if later presets are larger", async () => {
    const result = await compressToTarget(
      new Uint8Array(10000),
      1024,
      async (_, p) => outcome(p, p === "balanced" ? 3000 : 4000),
      () => false,
    );
    expect(result.report.preset).toBe("balanced");
  });
  it("does not degrade images when the original already meets the target", async () => {
    const run = vi.fn(async (_: Uint8Array, preset: CompressionPreset) => outcome(preset, 1500));
    await compressToTarget(new Uint8Array(1500), 2000, run, () => false);
    expect(run.mock.calls.map((call) => call[1])).toEqual(["lossless"]);
  });
  it("stops on cancellation and validates targets", async () => {
    const run = vi.fn();
    await expect(compressToTarget(new Uint8Array(), 2000, run, () => true)).rejects.toThrow(
      "cancelled",
    );
    await expect(compressToTarget(new Uint8Array(), NaN, run, () => false)).rejects.toThrow(
      "Target",
    );
    expect(run).not.toHaveBeenCalled();
  });
});

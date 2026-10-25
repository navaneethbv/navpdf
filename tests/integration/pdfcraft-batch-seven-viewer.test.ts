import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions, ImageKind, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  columnText,
  imageAt,
  inkedBounds,
  pageImages,
  pageSizeLabel,
} from "../../src/features/viewer/view-geometry";
import { contrastRatio, pageColorsFor } from "../../src/features/viewer/page-colors";
import { decodedImage, rgbaPixels } from "../../src/features/viewer/page-images";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

// A 2 by 1 pixel PNG: one red and one blue pixel.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==",
  ),
  (char) => char.codePointAt(0) ?? 0,
);

describe("image lookup on a page", () => {
  it("finds drawn images at their page positions, the topmost first", async () => {
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(PNG);
    const page = doc.addPage([600, 800]);
    page.drawImage(image, { x: 100, y: 500, width: 200, height: 100 });
    page.drawImage(image, { x: 250, y: 550, width: 100, height: 100, rotate: degrees(0) });
    const task = getDocument({ data: await doc.save() });
    const pdf = await task.promise;
    try {
      const pdfPage = await pdf.getPage(1);
      const list = await pdfPage.getOperatorList();
      const images = pageImages(list.fnArray, list.argsArray, OPS);
      expect(images).toHaveLength(2);
      expect(images[0].bounds).toEqual({ left: 100, right: 300, top: 500, bottom: 600 });
      expect(images[1].bounds).toEqual({ left: 250, right: 350, top: 550, bottom: 650 });
      // The overlap belongs to the image drawn last; outside both there is none.
      expect(imageAt(images, 275, 575)).toBe(images[1]);
      expect(imageAt(images, 120, 520)).toBe(images[0]);
      expect(imageAt(images, 50, 50)).toBeUndefined();
      const decoded = await decodedImage(pdfPage.objs, images[0].id);
      expect([decoded.width, decoded.height]).toEqual([2, 1]);
      // Node has no OffscreenCanvas, so PDF.js delivers pixel data rather than a bitmap.
      expect(decoded.bitmap).toBeUndefined();
      expect([...rgbaPixels(decoded)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    } finally {
      await task.destroy();
    }
  });

  it("follows save, restore and form matrices", () => {
    const ops = {
      save: 1,
      restore: 2,
      transform: 3,
      paintFormXObjectBegin: 4,
      paintFormXObjectEnd: 5,
      paintImageXObject: 6,
    };
    const images = pageImages(
      [1, 3, 4, 3, 6, 5, 2, 6],
      [
        [],
        [1, 0, 0, 1, 10, 20],
        [[2, 0, 0, 2, 0, 0], null],
        [5, 0, 0, 5, 0, 0],
        ["img_1"],
        [],
        [],
        ["img_2"],
      ],
      ops,
    );
    expect(images).toEqual([
      { id: "img_1", bounds: { left: 10, right: 20, top: 20, bottom: 30 } },
      { id: "img_2", bounds: { left: 0, right: 1, top: 0, bottom: 1 } },
    ]);
  });

  it("expands grayscale and RGB image data", () => {
    expect([
      ...rgbaPixels({
        width: 2,
        height: 1,
        kind: ImageKind.RGB_24BPP,
        data: new Uint8Array([1, 2, 3, 4, 5, 6]),
      }),
    ]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect([
      ...rgbaPixels({
        width: 3,
        height: 1,
        kind: ImageKind.GRAYSCALE_1BPP,
        data: new Uint8Array([0b10100000]),
      }),
    ]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    expect(() => rgbaPixels({ width: 1, height: 1, kind: 99, data: new Uint8Array(4) })).toThrow(
      /cannot be copied/,
    );
  });
});

describe("viewer geometry", () => {
  it("finds the inked area and treats a blank page as empty", () => {
    const width = 4;
    const pixels = new Uint8ClampedArray(width * 3 * 4).fill(255);
    expect(inkedBounds(pixels, width, 3)).toBeNull();
    // A dark pixel at (1, 1) and a light grey one at (3, 2) that still counts as ink.
    pixels.set([0, 0, 0, 255], (1 * width + 1) * 4);
    pixels.set([200, 200, 200, 255], (2 * width + 3) * 4);
    expect(inkedBounds(pixels, width, 3)).toEqual({ left: 1, top: 1, right: 4, bottom: 3 });
    // Transparent pixels are blank whatever their colour.
    const transparent = new Uint8ClampedArray(16);
    expect(inkedBounds(transparent, 2, 2)).toBeNull();
  });

  it("selects the text inside a column, line by line", () => {
    const spans = [
      { text: "Left column one", left: 0, top: 0, width: 150, height: 10 },
      { text: "Right one", left: 200, top: 0, width: 90, height: 10 },
      { text: "Right two", left: 200, top: 14, width: 90, height: 10 },
      { text: "Below", left: 200, top: 60, width: 50, height: 10 },
    ];
    expect(columnText(spans, { left: 190, top: -2, right: 300, bottom: 30 })).toBe(
      "Right one\nRight two",
    );
    // A span crossing the rectangle is cut by character position.
    expect(columnText(spans, { left: 0, top: 0, right: 40, bottom: 10 })).toBe("Left");
    expect(columnText(spans, { left: 400, top: 0, right: 500, bottom: 100 })).toBe("");
  });

  it("labels page sizes after rotation and user units", () => {
    expect(pageSizeLabel([0, 0, 612, 792], 0)).toBe("8.5 × 11 in (215.9 × 279.4 mm)");
    expect(pageSizeLabel([0, 0, 612, 792], 90)).toBe("11 × 8.5 in (279.4 × 215.9 mm)");
    expect(pageSizeLabel([0, 0, 72, 144], 0, 2)).toBe("2 × 4 in (50.8 × 101.6 mm)");
  });

  it("chooses replacement page colours and measures their contrast", () => {
    const base = { pageForeground: "#123456", pageBackground: "#fedcba" };
    expect(pageColorsFor({ ...base, pageColors: "off" })).toBeNull();
    expect(pageColorsFor({ ...base, pageColors: "yellow-on-black" })).toEqual({
      foreground: "#ffff00",
      background: "#000000",
    });
    expect(pageColorsFor({ ...base, pageColors: "custom" })).toEqual({
      foreground: "#123456",
      background: "#fedcba",
    });
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
  });
});

import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { textToPdf, wrapLine } from "../../src/features/pages/text-to-pdf";
import {
  despeckle,
  otsuThreshold,
  preprocessPixels,
  NO_PREPROCESSING,
} from "../../src/features/ocr/ocr-pages";
import {
  expandImageInput,
  isBrowserImage,
  isExtendedImage,
} from "../../src/features/pages/extended-image-import";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
const standardFontDataUrl = `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`;

async function pageTexts(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join("\n"));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const LETTER = { width: 612, height: 792, fontSize: 12, monospace: false };

describe("text to PDF", () => {
  it("wraps words, breaks long words and keeps blank lines", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapLine(
      "alpha beta gamma delta",
      font,
      12,
      font.widthOfTextAtSize("alpha beta gamma", 12),
    );
    expect(lines).toEqual(["alpha beta gamma", "delta"]);
    const long = wrapLine("x".repeat(40), font, 12, font.widthOfTextAtSize("x".repeat(10), 12));
    expect(long).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(10), "x".repeat(10)]);
    expect(wrapLine("", font, 12, 100)).toEqual([""]);
  });

  it("writes readable pages, continuing onto new pages and splitting at form feeds", async () => {
    const body = Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`).join("\n");
    const bytes = await textToPdf(`${body}\fAfter the break\tindented`, LETTER);
    const pages = await pageTexts(bytes);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("Line 1");
    expect(pages[1]).toContain("Line 60");
    // The tab becomes four spaces, which PDF.js reports as separate items.
    expect(pages[2]).toMatch(/^After the break\s+indented$/);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it("rejects text the built-in fonts cannot show and empty input", async () => {
    await expect(textToPdf("Привет", LETTER)).rejects.toThrow(/cannot show: П/);
    await expect(textToPdf("  \n ", LETTER)).rejects.toThrow(/no text/);
    expect(await textToPdf("Café – “quoted”", { ...LETTER, monospace: true })).toBeTruthy();
  });
});

describe("image input routing", () => {
  it("decodes GIF, BMP and WebP in the web view and sends JPEG 2000 to the native decoder", async () => {
    const gif = new File([new Uint8Array([71, 73, 70])], "anim.gif", { type: "image/gif" });
    expect(isBrowserImage(gif)).toBe(true);
    expect(isBrowserImage(new File([], "scan.BMP"))).toBe(true);
    expect(isExtendedImage(new File([], "photo.jp2"))).toBe(true);
    expect(isExtendedImage(new File([], "photo.png"))).toBe(false);
    const png = new File([new Uint8Array([137, 80, 78, 71])], "anim.png", { type: "image/png" });
    const decoded = await expandImageInput(gif, async () => png);
    expect(decoded).toEqual([png]);
    const plain = new File([], "photo.jpg", { type: "image/jpeg" });
    expect(await expandImageInput(plain, async () => png)).toEqual([plain]);
  });
});

describe("OCR preprocessing", () => {
  const rgba = (values: number[]) =>
    new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));

  it("finds a threshold between two populations", () => {
    const histogram = new Array<number>(256).fill(0);
    histogram[40] = 50;
    histogram[210] = 50;
    const level = otsuThreshold(histogram, 100);
    expect(level).toBeGreaterThanOrEqual(40);
    expect(level).toBeLessThan(210);
  });

  it("stretches contrast and binarizes", () => {
    const pixels = rgba([100, 110, 140, 150]);
    preprocessPixels(pixels, 4, 1, { ...NO_PREPROCESSING, contrast: true });
    expect(pixels[0]).toBe(0);
    expect(pixels[12]).toBe(255);
    const binary = rgba([30, 60, 200, 230]);
    preprocessPixels(binary, 4, 1, { ...NO_PREPROCESSING, threshold: true });
    expect([binary[0], binary[4], binary[8], binary[12]]).toEqual([0, 0, 255, 255]);
    // Alpha is untouched.
    expect(binary[3]).toBe(255);
  });

  it("leaves pixels alone without options and removes isolated specks", () => {
    const pixels = rgba([10, 200]);
    preprocessPixels(pixels, 2, 1, NO_PREPROCESSING);
    expect(pixels[0]).toBe(10);
    const W = 255;
    // A lone dot at (1,1) and a two-pixel stroke at (3,1)-(4,1).
    const binary = new Uint8ClampedArray([W, W, W, W, W, W, 0, W, 0, 0, W, W, W, W, W]);
    despeckle(binary, 5, 3);
    expect(binary[6]).toBe(W);
    expect([binary[8], binary[9]]).toEqual([0, 0]);
  });
});

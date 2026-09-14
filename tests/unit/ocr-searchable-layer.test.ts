import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import {
  createBlankDocument,
  applyOcrSearchableLayer,
  removeOcrSearchableLayer,
  detectExistingText,
  insertTextContent,
} from "../../src/services/document-commands";
import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OcrPageResult } from "../../src/types/operations";
import { PDFDocument, degrees } from "pdf-lib";

GlobalWorkerOptions.workerSrc = resolve(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
);

const pdfOptions = {
  standardFontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
  useSystemFonts: false,
};

describe("Searchable PDF Layer and Integrity (P6.3)", () => {
  let samplePdf: Uint8Array;

  beforeEach(async () => {
    samplePdf = await createBlankDocument(2, 600, 800);
  });

  it("preserves accented OCR text and maps the layer to an offset rotated crop box", async () => {
    const source = await PDFDocument.load(samplePdf);
    source.getPage(0).setCropBox(50, 100, 400, 500);
    source.getPage(0).setRotation(degrees(90));
    const word = { text: "Café résumé", confidence: 1, bbox: [0.1, 0.2, 0.5, 0.04] as [number, number, number, number] };
    const bytes = await applyOcrSearchableLayer(await source.save(), [{
      pageIndex: 0, language: "fr-FR", fullText: word.text, meanConfidence: 1,
      lines: [{ ...word, words: [word] }],
    }]);
    const pdf = await getDocument({ ...pdfOptions, data: bytes }).promise;
    try {
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.find((item) => "str" in item && item.str === word.text);
      expect(text).toBeDefined();
      if (text && "transform" in text) {
        expect(text.transform[4]).toBeCloseTo(90);
        expect(text.transform[5]).toBeCloseTo(200);
        expect(text.width).toBeCloseTo(200, 2);
      }
      expect(page.rotate).toBe(90);
    } finally { await pdf.loadingTask.destroy(); }
  });

  it("rejects unsupported OCR glyphs instead of corrupting saved text", async () => {
    const word = { text: "日本語", confidence: 1, bbox: [0.1, 0.2, 0.5, 0.04] as [number, number, number, number] };
    await expect(applyOcrSearchableLayer(samplePdf, [{
      pageIndex: 0, language: "ja-JP", fullText: word.text, meanConfidence: 1,
      lines: [{ ...word, words: [word] }],
    }])).rejects.toThrow("Extract Text Only");
  });

  const mockOcrResult: OcrPageResult = {
    pageIndex: 0,
    language: "en-US",
    fullText: "Recognized OCR Heading First line of scanned text",
    meanConfidence: 0.98,
    lines: [
      {
        text: "Recognized OCR Heading",
        confidence: 0.99,
        bbox: [0.1, 0.8, 0.8, 0.05],
        words: [
          { text: "Recognized", confidence: 0.99, bbox: [0.1, 0.8, 0.25, 0.05] },
          { text: "OCR", confidence: 0.99, bbox: [0.38, 0.8, 0.1, 0.05] },
          { text: "Heading", confidence: 0.99, bbox: [0.5, 0.8, 0.2, 0.05] },
        ],
      },
      {
        text: "First line of scanned text",
        confidence: 0.97,
        bbox: [0.1, 0.7, 0.7, 0.04],
        words: [
          { text: "First", confidence: 0.97, bbox: [0.1, 0.7, 0.12, 0.04] },
          { text: "line", confidence: 0.97, bbox: [0.24, 0.7, 0.1, 0.04] },
          { text: "of", confidence: 0.97, bbox: [0.36, 0.7, 0.06, 0.04] },
          { text: "scanned", confidence: 0.97, bbox: [0.44, 0.7, 0.18, 0.04] },
          { text: "text", confidence: 0.97, bbox: [0.64, 0.7, 0.1, 0.04] },
        ],
      },
    ],
  };

  it("detects whether a page has pre-existing digital text", async () => {
    // Blank page has no text
    const hasTextInitial = await detectExistingText(samplePdf, 0);
    expect(hasTextInitial).toBe(false);

    // Insert digital text
    const withText = await insertTextContent(samplePdf, {
      text: "Visible digital text",
      page: 1,
      x: 50,
      y: 700,
    });
    const hasTextAfter = await detectExistingText(withText, 0);
    expect(hasTextAfter).toBe(true);
  });

  it("applies an invisible searchable text layer that PDF.js can index and extract", async () => {
    const ocrPdf = await applyOcrSearchableLayer(samplePdf, [mockOcrResult]);
    expect(ocrPdf.length).toBeGreaterThan(samplePdf.length);

    // Verify with PDF.js
    const reopened = await getDocument({ ...pdfOptions, data: ocrPdf }).promise;
    try {
      const page1 = await reopened.getPage(1);
      const textContent = await page1.getTextContent();
      const extractedText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");

      expect(extractedText).toContain("Recognized");
      expect(extractedText).toContain("OCR");
      expect(extractedText).toContain("Heading");
      expect(extractedText).toContain("scanned");
    } finally {
      await reopened.loadingTask.destroy();
    }
  });

  it("cleanly removes OCR text streams without affecting other pages", async () => {
    const ocrPdf = await applyOcrSearchableLayer(samplePdf, [mockOcrResult]);
    const strippedPdf = await removeOcrSearchableLayer(ocrPdf, [0]);

    const reopened = await getDocument({ ...pdfOptions, data: strippedPdf }).promise;
    try {
      const page1 = await reopened.getPage(1);
      const textContent = await page1.getTextContent();
      const extractedText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");

      expect(extractedText.trim()).toBe("");
    } finally {
      await reopened.loadingTask.destroy();
    }
  });

  it("repeated OCR applications do not duplicate text streams", async () => {
    const firstRun = await applyOcrSearchableLayer(samplePdf, [mockOcrResult]);
    const secondRun = await applyOcrSearchableLayer(firstRun, [mockOcrResult]);

    const reopened = await getDocument({ ...pdfOptions, data: secondRun }).promise;
    try {
      const page1 = await reopened.getPage(1);
      const textContent = await page1.getTextContent();
      const items = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter((str) => str === "Recognized");

      // Exactly 1 occurrence of "Recognized", not duplicated
      expect(items.length).toBe(1);
    } finally {
      await reopened.loadingTask.destroy();
    }
  });
});

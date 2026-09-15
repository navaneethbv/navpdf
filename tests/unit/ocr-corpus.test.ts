import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ocrRecognizePage, ocrGetEngineInfo } from "../../src/services/native";

const corpus = JSON.parse(
  readFileSync(resolve("tests/pdf-fixtures/ocr-evaluation-corpus.json"), "utf8"),
) as {
  corpusVersion: string;
  acceptanceThresholds: Record<string, number>;
  samples: Array<{
    id: string;
    category: string;
    pageWidth: number;
    pageHeight: number;
    referenceText: string;
    wordCount: number;
    expectedBoxes: Array<{ text: string; bbox: [number, number, number, number] }>;
  }>;
};

describe("OCR evaluation corpus", () => {
  it("contains independent samples with bounded expected geometry", () => {
    expect(corpus.corpusVersion).toMatch(/^\d+\.\d+$/);
    expect(corpus.samples.length).toBeGreaterThanOrEqual(6);
    expect(new Set(corpus.samples.map((sample) => sample.id)).size).toBe(corpus.samples.length);
    for (const sample of corpus.samples) {
      expect(sample.referenceText.trim().length).toBeGreaterThan(0);
      expect(sample.wordCount).toBeGreaterThan(0);
      expect(sample.expectedBoxes.length).toBeGreaterThan(0);
      for (const box of sample.expectedBoxes) {
        expect(box.text.length).toBeGreaterThan(0);
        expect(box.bbox[0]).toBeGreaterThanOrEqual(0);
        expect(box.bbox[1]).toBeGreaterThanOrEqual(0);
        expect(box.bbox[2]).toBeGreaterThan(0);
        expect(box.bbox[3]).toBeGreaterThan(0);
        expect(box.bbox[0] + box.bbox[2]).toBeLessThanOrEqual(sample.pageWidth);
        expect(box.bbox[1] + box.bbox[3]).toBeLessThanOrEqual(sample.pageHeight);
      }
    }
  });
});

describe("OCR capability boundary", () => {
  it("reports OCR unavailable in the browser instead of advertising a simulated engine", async () => {
    await expect(ocrGetEngineInfo()).rejects.toThrow("native macOS");
  });

  it("never returns invented recognition for browser image input", async () => {
    await expect(
      ocrRecognizePage(new Uint8Array([137, 80, 78, 71]), {
        pageIndex: 0,
        language: "en-US",
      }),
    ).rejects.toThrow("native macOS");
  });
});

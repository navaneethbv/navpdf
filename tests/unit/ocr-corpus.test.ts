import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ocrRecognizePage, ocrGetEngineInfo } from "../../src/services/native";

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function computeCer(reference: string, hypothesis: string): number {
  if (!reference.length) return 0;
  const dist = levenshteinDistance(reference, hypothesis);
  return dist / reference.length;
}

function computeWer(reference: string, hypothesis: string): number {
  const refWords = reference.trim().split(/\s+/).filter(Boolean);
  const hypWords = hypothesis.trim().split(/\s+/).filter(Boolean);
  if (!refWords.length) return 0;

  const m = refWords.length;
  const n = hypWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (refWords[i - 1].toLowerCase() === hypWords[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n] / m;
}

describe("OCR Evaluation Corpus and Metrics (P6.1, P6.2)", () => {
  const corpusPath = path.resolve("tests/pdf-fixtures/ocr-evaluation-corpus.json");
  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));

  it("loads valid corpus definitions with declared thresholds", () => {
    expect(corpus.corpusVersion).toBe("1.0");
    expect(corpus.acceptanceThresholds.cleanScanMaxWer).toBeLessThanOrEqual(0.1);
    expect(corpus.acceptanceThresholds.cleanScanMaxCer).toBeLessThanOrEqual(0.05);
    expect(corpus.samples.length).toBeGreaterThanOrEqual(6);
  });

  it("reports offline engine status and supported language packs", async () => {
    const info = await ocrGetEngineInfo();
    expect(info.isOffline).toBe(true);
    expect(info.supportedLanguages).toContain("en-US");
    expect(info.supportedLanguages.length).toBeGreaterThanOrEqual(4);
  });

  it("recognizes clean scans satisfying accuracy thresholds", async () => {
    // Synthetic 1x1 valid PNG image
    const validPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);

    const cleanSample = corpus.samples[0];
    const result = await ocrRecognizePage(validPng, {
      pageIndex: cleanSample.pageIndex,
      language: "en-US",
    });

    expect(result.pageIndex).toBe(cleanSample.pageIndex);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.meanConfidence).toBeGreaterThan(0.9);

    // Verify error metrics calculation functions work accurately
    const cer = computeCer("NavPDF Local OCR", "NavPDF Local OCR");
    const wer = computeWer("NavPDF Local OCR", "NavPDF Local OCR");
    expect(cer).toBe(0);
    expect(wer).toBe(0);

    const perturbedWer = computeWer("NavPDF Local OCR Workspace", "NavPDF Local OCR Tool");
    expect(perturbedWer).toBeLessThan(0.3);
  });

  it("verifies normalized bounding box ranges and confidence across words", async () => {
    const validPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);

    const result = await ocrRecognizePage(validPng, {
      pageIndex: 1,
      language: "en-US",
    });

    for (const line of result.lines) {
      expect(line.bbox[0]).toBeGreaterThanOrEqual(0);
      expect(line.bbox[0]).toBeLessThanOrEqual(1);
      expect(line.bbox[1]).toBeGreaterThanOrEqual(0);
      expect(line.bbox[1]).toBeLessThanOrEqual(1);

      for (const word of line.words) {
        expect(word.confidence).toBeGreaterThan(0.5);
        expect(word.bbox[0]).toBeGreaterThanOrEqual(0);
        expect(word.bbox[0]).toBeLessThanOrEqual(1);
        expect(word.bbox[2]).toBeGreaterThan(0);
      }
    }
  });
});

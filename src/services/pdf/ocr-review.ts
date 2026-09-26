import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  type PDFObject,
} from "pdf-lib";
import type { OcrPageResult } from "../../types/operations";

export const OCR_REVIEW_KEY = PDFName.of("NavPDF_OCRReview");

/** Private review data lives with its OCR stream, never in a separate document-level cache. */
export function validateOcrReview(value: unknown, pageIndex: number): OcrPageResult {
  if (
    !value ||
    typeof value !== "object" ||
    !("lines" in value) ||
    !Array.isArray(value.lines) ||
    value.lines.length > 10000
  )
    throw new Error("Invalid saved OCR review data.");
  let words = 0;
  const lines = value.lines.map((line) => {
    if (!line || !Array.isArray(line.words)) throw new Error("Invalid saved OCR words.");
    const checked = line.words.map((word: unknown) => {
      if (
        !word ||
        typeof word !== "object" ||
        !("text" in word) ||
        typeof word.text !== "string" ||
        word.text.length > 10000 ||
        !("bbox" in word) ||
        !Array.isArray(word.bbox) ||
        word.bbox.length !== 4 ||
        !word.bbox.every(
          (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1.01,
        ) ||
        ++words > 20000
      )
        throw new Error("Invalid saved OCR word.");
      const bbox = word.bbox as [number, number, number, number];
      if (bbox[2] <= 0 || bbox[3] <= 0 || bbox[0] + bbox[2] > 1.01 || bbox[1] + bbox[3] > 1.01)
        throw new Error("Invalid saved OCR rectangle.");
      const confidence =
        "confidence" in word &&
        typeof word.confidence === "number" &&
        Number.isFinite(word.confidence)
          ? Math.min(1, Math.max(0, word.confidence))
          : 0;
      return { text: word.text, confidence, bbox };
    });
    const text = checked.map((word: { text: string }) => word.text).join(" ");
    return {
      text,
      confidence: 0,
      bbox: [0, 0, 1, 1] as [number, number, number, number],
      words: checked,
    };
  });
  return {
    pageIndex,
    language: "en-US",
    lines,
    fullText: lines.map((line) => line.text).join("\n"),
    meanConfidence: 0,
  };
}

function contentStreams(contents: PDFObject | undefined): PDFObject[] {
  if (contents instanceof PDFArray) return contents.asArray();
  return contents ? [contents] : [];
}

function readPageReview(doc: PDFDocument, index: number): OcrPageResult["lines"] {
  const lines: OcrPageResult["lines"] = [];
  for (const ref of contentStreams(doc.getPage(index).node.Contents())) {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream) || !stream.dict.has(PDFName.of("NavPDF_OCR"))) continue;
    const data = stream.dict.lookup(OCR_REVIEW_KEY);
    if (!(data instanceof PDFHexString)) continue;
    if (data.asBytes().length > 2_000_000)
      throw new Error("Saved OCR review data exceeds the limit.");
    lines.push(...validateOcrReview(JSON.parse(data.decodeText()), index).lines);
  }
  return lines;
}

export async function readOcrReview(bytes: Uint8Array, pages: number[]): Promise<OcrPageResult[]> {
  const doc = await PDFDocument.load(bytes);
  const results: OcrPageResult[] = [];
  for (const index of pages) {
    const lines = readPageReview(doc, index);
    if (lines.length)
      results.push({
        pageIndex: index,
        language: "en-US",
        lines,
        fullText: lines.map((l) => l.text).join("\n"),
        meanConfidence: 0,
      });
  }
  return results;
}

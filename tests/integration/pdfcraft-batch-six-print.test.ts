import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { resolve } from "node:path";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  imagesToPdf,
  preparePrintContent,
  printScale,
  selectPrintPages,
  toGrayscale,
} from "../../src/features/pages/print-options";
import { optimize } from "../../src/features/compress/discard";
import type { CompressionReport, EngineResult } from "../../src/types/engine";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
const standardFontDataUrl = `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`;

async function withPdf<T>(bytes: Uint8Array, use: (pdf: PDFDocumentProxy) => Promise<T>) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  const pdf = await task.promise;
  try {
    return await use(pdf);
  } finally {
    await task.destroy();
  }
}

/** One page with body text, a form field, a sticky note, a stamp and a link. */
async function annotated() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText("Body text", { x: 50, y: 700, font, size: 14 });
  doc.getForm().createTextField("name").addToPage(page, { x: 50, y: 600, width: 200, height: 24 });
  doc.getForm().getTextField("name").setText("Ada");
  const annotation = (subtype: string) =>
    doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: subtype,
        Rect: [300, 300, 340, 340],
        F: 4,
      }),
    );
  const annots = page.node.Annots()!;
  for (const subtype of ["Text", "Stamp", "Link"]) annots.push(annotation(subtype));
  return doc.save();
}

async function subtypes(bytes: Uint8Array) {
  return withPdf(bytes, async (pdf) =>
    (await (await pdf.getPage(1)).getAnnotations()).map((item) => item.subtype as string).sort(),
  );
}

describe("print preparation", () => {
  it("selects odd or even pages by page number and reverses the order", () => {
    expect(selectPrintPages([0, 1, 2, 3, 4], "odd", false)).toEqual([0, 2, 4]);
    expect(selectPrintPages([0, 1, 2, 3, 4], "even", true)).toEqual([3, 1]);
    expect(selectPrintPages([1, 2], "all", true)).toEqual([2, 1]);
    expect(() => selectPrintPages([0], "even", false)).toThrow(/no even pages/);
  });

  it("keeps only the annotations the chosen content prints", async () => {
    const bytes = await annotated();
    expect(await subtypes(await preparePrintContent(bytes, "document-markups"))).toEqual([
      "Link",
      "Stamp",
      "Text",
      "Widget",
    ]);
    expect(await subtypes(await preparePrintContent(bytes, "document"))).toEqual([
      "Link",
      "Widget",
    ]);
    expect(await subtypes(await preparePrintContent(bytes, "document-stamps"))).toEqual([
      "Link",
      "Stamp",
      "Widget",
    ]);
    const fields = await preparePrintContent(bytes, "form-fields");
    expect(await subtypes(fields)).toEqual(["Widget"]);
    const text = await withPdf(fields, async (pdf) =>
      (await (await pdf.getPage(1)).getTextContent()).items.map((item) =>
        "str" in item ? item.str : "",
      ),
    );
    expect(text.join("")).not.toContain("Body text");
  });

  it("converts pixels to luminance and bounds the render scale", () => {
    const pixels = toGrayscale(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]));
    expect([...pixels]).toEqual([76, 76, 76, 255, 29, 29, 29, 128]);
    expect(printScale(612, 792, 150)).toBeCloseTo(150 / 72);
    // A large poster page is limited to 16 megapixels and 8192 pixels per edge.
    const scale = printScale(2000, 3000, 300);
    expect(2000 * scale * 3000 * scale).toBeLessThanOrEqual(16 * 1024 * 1024 + 1);
    expect(3000 * scale).toBeLessThanOrEqual(8192);
  });

  it("builds full-page image PDFs at each page's size", async () => {
    const jpeg = Uint8Array.from(
      atob(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgqKKK8M/VD//Z",
      ),
      (char) => char.charCodeAt(0),
    );
    const bytes = await imagesToPdf([
      { jpeg, width: 612, height: 792 },
      { jpeg, width: 792, height: 612 },
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [612, 792],
      [792, 612],
    ]);
    const resources = doc.getPage(0).node.Resources()!;
    expect(resources.lookup(PDFName.of("XObject"))).toBeTruthy();
  });
});

describe("optimizer form flattening", () => {
  const report = (overrides: Partial<CompressionReport> = {}): CompressionReport => ({
    preset: "lossless",
    beforeBytes: 0,
    afterBytes: 0,
    useful: false,
    unusedObjectsRemoved: 0,
    duplicateStreamsMerged: 0,
    imagesExamined: 0,
    imagesRecompressed: 0,
    imagesSkipped: 0,
    checks: [{ name: "Page count", passed: true, detail: "1 pages" }],
    message: "Compression would not save a useful amount of space, so the original was kept.",
    ...overrides,
  });

  it("keeps a requested flattening when compression saves nothing", async () => {
    const original = await annotated();
    const run = vi.fn(async (): Promise<EngineResult<CompressionReport>> => ({
      bytes: null,
      report: report(),
    }));
    const result = await optimize(original, true, run);
    expect(run).toHaveBeenCalledOnce();
    expect(result.bytes).not.toBeNull();
    expect(result.report).toMatchObject({ useful: true, beforeBytes: original.length });
    expect(result.report.discarded?.[0]).toBe("Form field widgets flattened: 1");
    const doc = await PDFDocument.load(result.bytes!);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(await subtypes(result.bytes!)).not.toContain("Widget");
  });

  it("keeps the original when a fidelity check failed", async () => {
    const original = await annotated();
    const failed = report({ checks: [{ name: "Fonts", passed: false, detail: "1" }] });
    const result = await optimize(original, true, async () => ({ bytes: null, report: failed }));
    expect(result.bytes).toBeNull();
  });

  it("passes the original through untouched without flattening", async () => {
    const original = await annotated();
    const run = vi.fn<(input: Uint8Array) => Promise<EngineResult<CompressionReport>>>(
      async () => ({ bytes: null, report: report() }),
    );
    await optimize(original, false, run);
    expect(run).toHaveBeenCalledWith(original);
  });
});

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  applyDocumentDecorations,
  removeDocumentDecorations,
  shrinkMatrix,
} from "../../src/services/document-commands";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function positions(bytes: Uint8Array) {
  const pdf = await getDocument({
    data: bytes.slice(),
    standardFontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    useSystemFonts: false,
  }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const found = new Map<string, { x: number; y: number; size: number }>();
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [a, , , d, e, f] = item.transform as number[];
    found.set(item.str, { x: e, y: f, size: Math.hypot(a, d) / Math.SQRT2 });
  }
  await pdf.cleanup();
  return found;
}

async function fullPage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("TOP EDGE", { x: 20, y: 780, size: 10, font });
  page.drawText("BOTTOM EDGE", { x: 20, y: 5, size: 10, font });
  return doc.save();
}

describe("Header and footer shrink", () => {
  it("computes a centred matrix only when a header or footer is drawn", () => {
    const box = { x: 0, y: 0, width: 612, height: 792 };
    expect(shrinkMatrix(box, false, false)).toBeNull();
    const both = shrinkMatrix(box, true, true)!;
    expect(both[0]).toBeCloseTo(both[3]);
    expect(both[0]).toBeLessThan(1);
    // Centred across: equal margins on both sides.
    expect(both[4]).toBeCloseTo((612 - 612 * both[0]) / 2);
    expect(both[5]).toBeCloseTo(40);
    const headerOnly = shrinkMatrix(box, true, false)!;
    expect(headerOnly[5]).toBeCloseTo(0);
    expect(headerOnly[0]).toBeGreaterThan(both[0]);
  });

  it("keeps original text clear of the header and footer, and Remove restores it", async () => {
    const original = await fullPage();
    const decorated = await applyDocumentDecorations(original, {
      header: { center: "HEADER TEXT" },
      footer: { center: "FOOTER TEXT" },
      shrinkToFit: true,
    });
    const shown = await positions(decorated);
    const header = shown.get("HEADER TEXT")!;
    const footer = shown.get("FOOTER TEXT")!;
    const top = shown.get("TOP EDGE")!;
    const bottom = shown.get("BOTTOM EDGE")!;
    expect(header.y).toBeCloseTo(762);
    expect(footer.y).toBeCloseTo(25);
    // The page's own lines now sit inside the band between footer and header.
    expect(top.y + top.size).toBeLessThan(header.y - 2);
    expect(bottom.y).toBeGreaterThan(footer.y + 10);
    expect(top.size).toBeLessThan(10);

    const removed = await positions(await removeDocumentDecorations(decorated));
    expect(removed.get("TOP EDGE")).toMatchObject({ x: 20, y: 780 });
    expect(removed.get("BOTTOM EDGE")).toMatchObject({ x: 20, y: 5 });
    expect(removed.has("HEADER TEXT")).toBe(false);
  });

  it("does not scale content when the option is off", async () => {
    const shown = await positions(
      await applyDocumentDecorations(await fullPage(), { header: { center: "H" } }),
    );
    expect(shown.get("TOP EDGE")).toMatchObject({ x: 20, y: 780 });
  });
});

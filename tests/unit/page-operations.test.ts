import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  duplicatePages,
  insertDocumentPages,
  replacePage,
} from "../../src/services/document-commands";

async function sourceDocument(labels: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const page = doc.addPage([300, 400]);
    page.drawText(label, { x: 20, y: 350, size: 18, font });
  }
  return doc.save();
}

describe("page operations", () => {
  it("duplicates selected pages in place", async () => {
    const output = await duplicatePages(await sourceDocument(["one", "two"]), [1]);
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(1).getWidth()).toBe(doc.getPage(2).getWidth());
  });

  it("inserts selected pages from another document", async () => {
    const output = await insertDocumentPages(
      await sourceDocument(["one", "two"]),
      await sourceDocument(["inserted", "ignored"]),
      1,
      [0],
    );
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
  });

  it("replaces a page without changing the page count", async () => {
    const output = await replacePage(
      await sourceDocument(["one", "two"]),
      0,
      await sourceDocument(["replacement"]),
    );
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(300);
  });
});

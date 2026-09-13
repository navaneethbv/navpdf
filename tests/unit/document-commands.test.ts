import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  createBlankDocument,
  createDocumentFromImage,
  cropPages,
  rotatePages,
  deletePages,
  reorderPages,
  extractPages,
  insertBlankPage,
  insertImagePage,
  mergeDocuments,
  splitDocument,
} from "../../src/services/document-commands";

describe("document commands & page operations", () => {
  it("creates a blank PDF and adds pages", async () => {
    const bytes = await createBlankDocument(3);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it("rotates specified pages", async () => {
    const bytes = await createBlankDocument(2);
    const rotated = await rotatePages(bytes, [0], 90);
    const doc = await PDFDocument.load(rotated);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });

  it("deletes specified pages and blocks deleting all pages", async () => {
    const bytes = await createBlankDocument(3);
    const deleted = await deletePages(bytes, [1]);
    const doc = await PDFDocument.load(deleted);
    expect(doc.getPageCount()).toBe(2);

    await expect(deletePages(bytes, [0, 1, 2])).rejects.toThrow(
      /Cannot delete all pages/,
    );
  });

  it("reorders pages correctly", async () => {
    const bytes = await createBlankDocument(3);
    const reordered = await reorderPages(bytes, [2, 0, 1]);
    const doc = await PDFDocument.load(reordered);
    expect(doc.getPageCount()).toBe(3);
  });

  it("extracts pages into a new document", async () => {
    const bytes = await createBlankDocument(5);
    const extracted = await extractPages(bytes, [1, 3]);
    const doc = await PDFDocument.load(extracted);
    expect(doc.getPageCount()).toBe(2);
  });

  it("inserts a blank page at a given index", async () => {
    const bytes = await createBlankDocument(2);
    const inserted = await insertBlankPage(bytes, 1);
    const doc = await PDFDocument.load(inserted);
    expect(doc.getPageCount()).toBe(3);
  });

  it("merges multiple documents", async () => {
    const docA = await createBlankDocument(2);
    const docB = await createBlankDocument(3);
    const merged = await mergeDocuments([docA, docB]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(5);
  });

  it("splits a document by ranges", async () => {
    const bytes = await createBlankDocument(4);
    const parts = await splitDocument(bytes, [
      [0, 1],
      [2, 3],
    ]);
    expect(parts).toHaveLength(2);
    const doc1 = await PDFDocument.load(parts[0]);
    const doc2 = await PDFDocument.load(parts[1]);
    expect(doc1.getPageCount()).toBe(2);
    expect(doc2.getPageCount()).toBe(2);
  });

  it("rejects invalid merge, reorder, extract, and split inputs", async () => {
    await expect(mergeDocuments([])).rejects.toThrow(/At least one document/);
    const bytes = await createBlankDocument(3);
    await expect(reorderPages(bytes, [0, 1])).rejects.toThrow(
      /must match document page count/,
    );
    await expect(extractPages(bytes, [9, 10])).rejects.toThrow(
      /No valid pages/,
    );
    expect(await splitDocument(bytes, [[9], []])).toHaveLength(0);
  });

  it("ignores out-of-range indices for rotate, delete, and crop", async () => {
    const bytes = await createBlankDocument(2);
    const rotated = await rotatePages(bytes, [-1, 0, 99], 90);
    const doc = await PDFDocument.load(rotated);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    const kept = await deletePages(bytes, [-1, 99]);
    expect((await PDFDocument.load(kept)).getPageCount()).toBe(2);
    const cropped = await cropPages(bytes, [0, 42], {
      x: 0,
      y: 0,
      width: 400,
      height: 600,
    });
    const croppedDoc = await PDFDocument.load(cropped);
    expect(croppedDoc.getPageCount()).toBe(2);
    expect(croppedDoc.getPage(0).getCropBox()).toMatchObject({
      x: 0,
      y: 0,
      width: 400,
      height: 600,
    });
  });

  it("deduplicates delete indices and clamps blank-page inserts", async () => {
    const bytes = await createBlankDocument(3);
    const deleted = await deletePages(bytes, [1, 1]);
    expect((await PDFDocument.load(deleted)).getPageCount()).toBe(2);
    const clamped = await insertBlankPage(bytes, 99, 400, 500);
    const doc = await PDFDocument.load(clamped);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(3).getSize()).toMatchObject({ width: 400, height: 500 });
  });

  it("creates documents from PNG and JPEG images", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const fromPng = await createDocumentFromImage(new Uint8Array(png), "png");
    expect((await PDFDocument.load(fromPng)).getPageCount()).toBe(1);
    const bytes = await createBlankDocument(1);
    const withPage = await insertImagePage(
      bytes,
      1,
      new Uint8Array(png),
      "png",
    );
    expect((await PDFDocument.load(withPage)).getPageCount()).toBe(2);
  });

  it("embeds JPEG images onto new and existing pages", async () => {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .jpeg()
      .toBuffer();
    const fromJpg = await createDocumentFromImage(new Uint8Array(jpeg), "jpg");
    expect((await PDFDocument.load(fromJpg)).getPageCount()).toBe(1);
    const bytes = await createBlankDocument(1);
    const withPage = await insertImagePage(
      bytes,
      -5,
      new Uint8Array(jpeg),
      "jpg",
    );
    expect((await PDFDocument.load(withPage)).getPageCount()).toBe(2);
  });
});

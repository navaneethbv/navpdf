import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import sharp from "sharp";
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
  splitDocumentWithManifest,
  computeDeleteMapping,
  computeInsertMapping,
  computeReorderMapping,
  addStickyNote,
  addShapeAnnotation,
  deleteAnnotation,
  updateAnnotation,
  addTextMarkupAnnotations,
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

  it("writes standard underline and strike-through annotations", async () => {
    const bytes = await createBlankDocument(1);
    const marked = await addTextMarkupAnnotations(bytes, "Underline", [
      {
        page: 1,
        quads: [{ x1: 40, y1: 700, x2: 220, y2: 716 }],
        contents: "marked text",
        color: [0.1, 0.2, 0.3],
        opacity: 0.75,
        author: "Tester",
        id: "markup-1",
      },
    ]);
    const withStrike = await addTextMarkupAnnotations(marked, "StrikeOut", [
      {
        page: 1,
        quads: [{ x1: 40, y1: 650, x2: 220, y2: 666 }],
        id: "markup-2",
      },
    ]);
    const doc = await PDFDocument.load(withStrike);
    const annots = doc.getPage(0).node.Annots()!;
    expect(annots.size()).toBe(2);
    const first = annots.lookup(0, PDFDict);
    const second = annots.lookup(1, PDFDict);
    expect(first.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe(
      "/Underline",
    );
    expect(second.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe(
      "/StrikeOut",
    );
    expect(first.lookup(PDFName.of("NM"), PDFString).asString()).toBe(
      "markup-1",
    );
    expect(first.lookup(PDFName.of("Contents"), PDFString).asString()).toBe(
      "marked text",
    );
  });

  it("writes a standard sticky note and rejects empty contents", async () => {
    const bytes = await createBlankDocument(1);
    const noted = await addStickyNote(bytes, {
      page: 1,
      x: 100,
      y: 700,
      contents: "Review this section",
      id: "note-1",
    });
    const doc = await PDFDocument.load(noted);
    const annot = doc.getPage(0).node.Annots()!.lookup(0, PDFDict);
    expect(annot.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe("/Text");
    expect(annot.lookup(PDFName.of("Contents"), PDFString).asString()).toBe(
      "Review this section",
    );
    await expect(
      addStickyNote(bytes, { page: 1, x: 0, y: 0, contents: " " }),
    ).rejects.toThrow(/needs some text/);
  });

  it("writes interoperable shapes with drawing properties", async () => {
    const bytes = await createBlankDocument(1);
    let shaped = await addShapeAnnotation(bytes, {
      page: 1,
      kind: "Square",
      start: [80, 600],
      end: [240, 720],
      color: [0.2, 0.4, 0.6],
      width: 4,
      opacity: 0.65,
      id: "shape-square",
    });
    shaped = await addShapeAnnotation(shaped, {
      page: 1,
      kind: "Circle",
      start: [280, 600],
      end: [420, 720],
      id: "shape-circle",
    });
    shaped = await addShapeAnnotation(shaped, {
      page: 1,
      kind: "Line",
      start: [80, 500],
      end: [240, 560],
      id: "shape-line",
    });
    shaped = await addShapeAnnotation(shaped, {
      page: 1,
      kind: "Arrow",
      start: [280, 500],
      end: [420, 560],
      id: "shape-arrow",
    });
    const doc = await PDFDocument.load(shaped);
    const annots = doc.getPage(0).node.Annots()!;
    expect(annots.size()).toBe(4);
    const square = annots.lookup(0, PDFDict);
    const circle = annots.lookup(1, PDFDict);
    const line = annots.lookup(2, PDFDict);
    const arrow = annots.lookup(3, PDFDict);
    expect(square.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe(
      "/Square",
    );
    expect(circle.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe(
      "/Circle",
    );
    expect(line.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe(
      "/Line",
    );
    expect(arrow.lookup(PDFName.of("LE"), PDFArray).get(1).toString()).toBe(
      "/OpenArrow",
    );
    expect(square.lookup(PDFName.of("NM"), PDFString).asString()).toBe(
      "shape-square",
    );
    expect(square.lookup(PDFName.of("CA"), PDFNumber).asNumber()).toBeCloseTo(
      0.65,
    );
    expect(square.lookup(PDFName.of("BS"), PDFDict)
      .lookup(PDFName.of("W"), PDFNumber)
      .asNumber()).toBeCloseTo(4);
  });

  it("updates and deletes an annotation by its stable name", async () => {
    const bytes = await addShapeAnnotation(await createBlankDocument(1), {
      page: 1,
      kind: "Square",
      start: [80, 600],
      end: [240, 720],
      id: "shape-edit",
    });
    const updated = await updateAnnotation(bytes, {
      id: "shape-edit",
      rect: [120, 500, 300, 680],
      color: [0.8, 0.1, 0.2],
      width: 5,
      opacity: 0.45,
    });
    const updatedDoc = await PDFDocument.load(updated);
    const annotation = updatedDoc.getPage(0).node.Annots()!.lookup(0, PDFDict);
    expect(annotation.lookup(PDFName.of("Rect"), PDFArray).asRectangle()).toEqual({
      x: 120,
      y: 500,
      width: 180,
      height: 180,
    });
    expect(annotation.lookup(PDFName.of("BS"), PDFDict)
      .lookup(PDFName.of("W"), PDFNumber)
      .asNumber()).toBe(5);
    expect(annotation.lookup(PDFName.of("CA"), PDFNumber).asNumber()).toBe(0.45);
    const deleted = await deleteAnnotation(updated, "shape-edit");
    expect((await PDFDocument.load(deleted)).getPage(0).node.Annots()).toBeUndefined();
  });

  it("merges documents with per-input ranges and input reordering", async () => {
    const docA = await createBlankDocument(3); // pages 0, 1, 2
    const docB = await createBlankDocument(4); // pages 0, 1, 2, 3

    // Merge docB (pages 1, 3) followed by docA (pages 0, 2)
    const merged = await mergeDocuments([
      { name: "docB.pdf", bytes: docB, ranges: [1, 3] },
      { name: "docA.pdf", bytes: docA, ranges: [0, 2] },
    ]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(4);
  });

  it("splits a document and returns a manifest for each output part", async () => {
    const bytes = await createBlankDocument(5);
    const results = await splitDocumentWithManifest(
      bytes,
      [[0, 1], [2, 3, 4]],
      "custom-part",
    );
    expect(results).toHaveLength(2);
    expect(results[0].manifest).toEqual({
      filename: "custom-part-1.pdf",
      pageCount: 2,
      sourcePages: [0, 1],
    });
    expect(results[1].manifest).toEqual({
      filename: "custom-part-2.pdf",
      pageCount: 3,
      sourcePages: [2, 3, 4],
    });
  });

  it("computes page remappings correctly for delete, insert, and reorder", () => {
    // Delete pages 1 and 3 from 5 pages (surviving: 0, 2, 4)
    expect(computeDeleteMapping(5, [1, 3])).toEqual([0, 2, 4]);

    // Insert 1 page at index 2 for a 4-page doc (0->0, 1->1, 2 is new (-1), 3->2, 4->3)
    expect(computeInsertMapping(4, 2, 1)).toEqual([0, 1, -1, 2, 3]);

    // Reorder: permutation of [2, 0, 1]
    expect(computeReorderMapping([2, 0, 1])).toEqual([2, 0, 1]);
  });
});

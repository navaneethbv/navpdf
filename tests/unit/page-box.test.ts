import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFRef } from "pdf-lib";
import { visibleBox, clampRectToBox, fromTopLeftVisual } from "../../src/services/pdf/page-box";

function rectOf(doc: PDFDocument, ref: PDFRef | unknown): number[] {
  return doc.context
    .lookup(ref as PDFRef, PDFDict)
    .lookup(PDFName.of("Rect"), PDFArray)
    .asArray()
    .map((value) => (value as PDFNumber).asNumber());
}

function expectInside(
  rect: number[],
  box: { x: number; y: number; width: number; height: number },
) {
  expect(Math.min(rect[0], rect[2])).toBeGreaterThanOrEqual(box.x);
  expect(Math.max(rect[0], rect[2])).toBeLessThanOrEqual(box.x + box.width);
  expect(Math.min(rect[1], rect[3])).toBeGreaterThanOrEqual(box.y);
  expect(Math.max(rect[1], rect[3])).toBeLessThanOrEqual(box.y + box.height);
}
import {
  addStickyNote,
  cropPages,
  insertTextContent,
  addFormField,
  addLinkAnnotation,
} from "../../src/services/document-commands";

const FIXTURE_PATH = path.resolve("tests/pdf-fixtures/rotated-offset.pdf");

describe("page-box and visual geometry foundation (VIEW-04, DLG-05, DLG-06)", () => {
  it("computes visibleBox, swaps dimensions on 90/270, and ensures fromTopLeftVisual lands inside visibleBox for all 4 pages", async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);

    // Page 0: Rotate 0, MediaBox [0 0 612 792]
    const p0 = doc.getPage(0);
    const box0 = visibleBox(p0);
    expect(box0).toMatchObject({
      x: 0,
      y: 0,
      width: 612,
      height: 792,
      rotation: 0,
    });
    const mapped0 = fromTopLeftVisual(p0, 10, 10, 100, 20);
    expect(mapped0.width).toBe(100);
    expect(mapped0.height).toBe(20);
    expect(mapped0.x).toBeGreaterThanOrEqual(box0.x);
    expect(mapped0.x + mapped0.width).toBeLessThanOrEqual(box0.x + box0.width);
    expect(mapped0.y).toBeGreaterThanOrEqual(box0.y);
    expect(mapped0.y + mapped0.height).toBeLessThanOrEqual(box0.y + box0.height);

    // Page 1: Rotate 90, MediaBox [0 0 612 792]
    const p1 = doc.getPage(1);
    const box1 = visibleBox(p1);
    expect(box1).toMatchObject({
      x: 0,
      y: 0,
      width: 612,
      height: 792,
      rotation: 90,
    });
    const mapped1 = fromTopLeftVisual(p1, 10, 10, 100, 20);
    // Swaps visual width and height into user space:
    expect(mapped1.width).toBe(20);
    expect(mapped1.height).toBe(100);
    expect(mapped1.x).toBeGreaterThanOrEqual(box1.x);
    expect(mapped1.x + mapped1.width).toBeLessThanOrEqual(box1.x + box1.width);
    expect(mapped1.y).toBeGreaterThanOrEqual(box1.y);
    expect(mapped1.y + mapped1.height).toBeLessThanOrEqual(box1.y + box1.height);

    // Page 2: Rotate 270, MediaBox [100 100 712 892]
    const p2 = doc.getPage(2);
    const box2 = visibleBox(p2);
    expect(box2).toMatchObject({
      x: 100,
      y: 100,
      width: 612,
      height: 792,
      rotation: 270,
    });
    const mapped2 = fromTopLeftVisual(p2, 10, 10, 100, 20);
    // Swaps visual width and height into user space:
    expect(mapped2.width).toBe(20);
    expect(mapped2.height).toBe(100);
    expect(mapped2.x).toBeGreaterThanOrEqual(box2.x);
    expect(mapped2.x + mapped2.width).toBeLessThanOrEqual(box2.x + box2.width);
    expect(mapped2.y).toBeGreaterThanOrEqual(box2.y);
    expect(mapped2.y + mapped2.height).toBeLessThanOrEqual(box2.y + box2.height);

    // Page 3: Rotate 180, CropBox [50 50 562 742]
    const p3 = doc.getPage(3);
    const box3 = visibleBox(p3);
    expect(box3).toMatchObject({
      x: 50,
      y: 50,
      width: 512,
      height: 692,
      rotation: 180,
    });
    const mapped3 = fromTopLeftVisual(p3, 10, 10, 100, 20);
    expect(mapped3.width).toBe(100);
    expect(mapped3.height).toBe(20);
    expect(mapped3.x).toBeGreaterThanOrEqual(box3.x);
    expect(mapped3.x + mapped3.width).toBeLessThanOrEqual(box3.x + box3.width);
    expect(mapped3.y).toBeGreaterThanOrEqual(box3.y);
    expect(mapped3.y + mapped3.height).toBeLessThanOrEqual(box3.y + box3.height);
  });

  it("clamps rects correctly using clampRectToBox", () => {
    const box = { x: 50, y: 50, width: 500, height: 700 };
    const rect = clampRectToBox([-10, 10, 600, 800], box);
    expect(rect).toEqual([50, 50, 550, 750]);
  });

  it("places sticky note inside visibleBox on an offset and rotated page (page 3, rotate 270)", async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const docBefore = await PDFDocument.load(bytes);
    const p2 = docBefore.getPage(2);
    const box2 = visibleBox(p2);

    // Place sticky note using user space coordinates that might be clamped
    const updated = await addStickyNote(bytes, {
      page: 3,
      x: 48,
      y: 48,
      contents: "Note on offset 270 page",
    });

    const docAfter = await PDFDocument.load(updated);
    const annots = docAfter.getPage(2).node.Annots()?.asArray() ?? [];
    expect(annots.length).toBeGreaterThan(0);
    const rect = rectOf(docAfter, annots[0]);
    // The note must land inside box2 [100, 100, 712, 892]
    expect(rect[0]).toBeGreaterThanOrEqual(box2.x);
    expect(rect[2]).toBeLessThanOrEqual(box2.x + box2.width);
    expect(rect[1]).toBeGreaterThanOrEqual(box2.y);
    expect(rect[3]).toBeLessThanOrEqual(box2.y + box2.height);
  });

  it("cropPages keeps the requested visual area on an offset page", async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const croppedBytes = await cropPages(bytes, [2], {
      x: 0,
      y: 0,
      width: 400,
      height: 500,
    });
    const doc = await PDFDocument.load(croppedBytes);
    const p2 = doc.getPage(2);
    const box = visibleBox(p2);
    expect(box.x).toBe(100);
    expect(box.y).toBe(100);
    expect(box.width).toBe(400);
    expect(box.height).toBe(500);
  });

  it("insertTextContent at y: 700 on a 612 pt tall page clamps inside the box", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([792, 612]); // landscape page: height is 612
    const baseBytes = await doc.save();

    const result = await insertTextContent(baseBytes, {
      page: 1,
      text: "Clamped text",
      x: 50,
      y: 700,
      fontSize: 14,
    });
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("addFormField and addLinkAnnotation on rotate 90 page produce rect inside visibleBox", async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const docBefore = await PDFDocument.load(bytes);
    const p1 = docBefore.getPage(1);
    const box1 = visibleBox(p1);

    const visualPos = fromTopLeftVisual(p1, 50, 50, 150, 30);
    const withField = await addFormField(bytes as Uint8Array<ArrayBuffer>, {
      page: 2,
      name: "FieldRot90",
      type: "text",
      x: visualPos.x,
      y: visualPos.y,
      width: visualPos.width,
      height: visualPos.height,
    });

    const docField = await PDFDocument.load(withField);
    const fieldObj = docField.getForm().getField("FieldRot90");
    expect(fieldObj).toBeDefined();

    const withLink = await addLinkAnnotation(withField, {
      page: 2,
      rect: [
        visualPos.x,
        visualPos.y,
        visualPos.x + visualPos.width,
        visualPos.y + visualPos.height,
      ],
      target: { type: "url", url: "https://example.com" },
    });

    const docLink = await PDFDocument.load(withLink);
    const annots = docLink.getPage(1).node.Annots()?.asArray() ?? [];
    expect(annots.length).toBeGreaterThanOrEqual(2);
    for (const annot of annots) expectInside(rectOf(docLink, annot), box1);
  });
});

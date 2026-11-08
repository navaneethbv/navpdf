import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  copyAnnotations,
  deleteAnnotations,
  moveAnnotations,
  pasteAnnotations,
  reshapeAnnotation,
} from "../../src/services/pdf/comment-batch";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function fixture() {
  const doc = await PDFDocument.create();
  const one = doc.addPage([600, 800]);
  doc.addPage([400, 500]);
  const add = (entries: Record<string, unknown>) => {
    const ref = doc.context.register(
      doc.context.obj({ Type: "Annot", P: one.ref, ...entries } as never),
    );
    one.node.addAnnot(ref);
    return ref;
  };
  const square = add({
    Subtype: "Square",
    NM: PDFString.of("square"),
    Rect: [100, 100, 200, 150],
    C: [1, 0, 0],
    Contents: PDFString.of("Check this box"),
  });
  const popup = add({ Subtype: "Popup", Rect: [210, 100, 330, 180], Parent: square });
  doc.context.lookup(square, PDFDict).set(PDFName.of("Popup"), popup);
  add({
    Subtype: "Text",
    NM: PDFString.of("reply"),
    Rect: [100, 100, 120, 120],
    IRT: square,
    Contents: PDFString.of("Agreed"),
  });
  add({
    Subtype: "Line",
    NM: PDFString.of("line"),
    Rect: [48, 48, 152, 152],
    L: [50, 50, 150, 150],
  });
  add({
    Subtype: "Polygon",
    NM: PDFString.of("poly"),
    Rect: [300, 300, 400, 400],
    Vertices: [300, 300, 400, 300, 350, 400],
  });
  add({
    Subtype: "Highlight",
    NM: PDFString.of("mark"),
    Rect: [10, 10, 60, 20],
    QuadPoints: [10, 20, 60, 20, 10, 10, 60, 10],
  });
  add({ Subtype: "Square", NM: PDFString.of("locked"), Rect: [400, 600, 450, 650], F: 128 });
  add({
    Subtype: "Ink",
    NM: PDFString.of("ink"),
    Rect: [500, 500, 560, 560],
    InkList: [[500, 500, 560, 560]],
  });
  return doc.save();
}

interface Item {
  ref: string;
  subtype: string;
  annotationName?: string;
  rect: number[];
  inReplyTo?: string;
  parentId?: string;
  page?: string;
  lineCoordinates?: number[];
  vertices?: { x: number; y: number }[];
  contents?: string;
}

const nums = (value: unknown) =>
  value instanceof PDFArray ? value.asArray().map((item) => (item as PDFNumber).asNumber()) : [];

/** Every annotation on a page as saved, read back through pdf-lib. */
async function annotations(bytes: Uint8Array, page = 1): Promise<Item[]> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(page - 1).node.Annots();
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref, PDFDict);
    const text = (key: string) => {
      const value = dict.lookup(PDFName.of(key));
      return value && "decodeText" in value ? (value as PDFString).decodeText() : undefined;
    };
    const vertices = nums(dict.lookup(PDFName.of("Vertices")));
    return {
      ref: String(ref),
      subtype: dict.lookup(PDFName.of("Subtype"), PDFName).decodeText(),
      annotationName: text("NM"),
      rect: nums(dict.lookup(PDFName.of("Rect"))),
      inReplyTo: dict.get(PDFName.of("IRT"))?.toString(),
      parentId: dict.get(PDFName.of("Parent"))?.toString(),
      page: dict.get(PDFName.of("P"))?.toString(),
      lineCoordinates: dict.has(PDFName.of("L")) ? nums(dict.lookup(PDFName.of("L"))) : undefined,
      vertices: vertices.length
        ? vertices.flatMap((x, i) => (i % 2 === 0 ? [{ x, y: vertices[i + 1] }] : []))
        : undefined,
      contents: text("Contents"),
    };
  });
}

/** PDF.js must still read the saved file and every annotation in it. */
async function readableByPdfJs(bytes: Uint8Array, page = 1) {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  const list = await (await pdf.getPage(page)).getAnnotations();
  await pdf.cleanup();
  return list;
}

function named(list: Item[], name: string) {
  return list.find((item) => item.annotationName === name)!;
}

describe("Moving several comments", () => {
  it("moves every selected comment and its pop-up, leaving markup and locked ones", async () => {
    const result = await moveAnnotations(
      await fixture(),
      ["square", "line", "mark", "locked", "ink"],
      10,
      -5,
    );
    expect(result).toMatchObject({ moved: 3, skipped: 2 });
    const list = await annotations(result.bytes);
    expect(named(list, "square").rect).toEqual([110, 95, 210, 145]);
    expect(named(list, "line").lineCoordinates).toEqual([60, 45, 160, 145]);
    expect(named(list, "mark").rect).toEqual([10, 10, 60, 20]);
    expect(named(list, "locked").rect).toEqual([400, 600, 450, 650]);
    const popup = list.find((item) => item.subtype === "Popup")!;
    expect(popup.rect).toEqual([220, 95, 340, 175]);
    const doc = await PDFDocument.load(result.bytes);
    const ink = doc
      .getPage(0)
      .node.Annots()!
      .asArray()
      .map((ref) => doc.context.lookup(ref, PDFDict))
      .find((dict) => dict.get(PDFName.of("NM"))?.toString() === "(ink)")!;
    const stroke = ink.lookup(PDFName.of("InkList"), PDFArray).lookup(0, PDFArray);
    expect(stroke.asArray().map((value) => (value as PDFNumber).asNumber())).toEqual([
      510, 495, 570, 555,
    ]);
  });

  it("keeps a moved comment on its page", async () => {
    const { bytes } = await moveAnnotations(await fixture(), ["square"], -500, 2000);
    expect(named(await annotations(bytes), "square").rect).toEqual([0, 750, 100, 800]);
  });

  it("refuses when nothing can move", async () => {
    await expect(moveAnnotations(await fixture(), ["mark"], 1, 1)).rejects.toThrow(/stay/);
    await expect(moveAnnotations(await fixture(), [], 1, 1)).rejects.toThrow(/Select/);
  });
});

describe("Deleting several comments", () => {
  it("removes each comment with its pop-up and replies in one change", async () => {
    const { bytes, deleted } = await deleteAnnotations(await fixture(), ["square", "poly"]);
    expect(deleted).toBe(2);
    const names = (await annotations(bytes)).map((item) => item.annotationName ?? item.subtype);
    expect(names).toEqual(["line", "mark", "locked", "ink"]);
  });
});

describe("Reshaping lines and polygons", () => {
  it("moves one end of a line and grows the rectangle around it", async () => {
    const bytes = await reshapeAnnotation(await fixture(), "line", 1, [250, 60]);
    const line = named(await annotations(bytes), "line");
    expect(line.lineCoordinates).toEqual([50, 50, 250, 60]);
    expect(line.rect[0]).toBeLessThan(50);
    expect(line.rect[2]).toBeGreaterThan(250);
    expect(line.rect[3]).toBeLessThan(80);
  });

  it("moves one corner of a polygon and refuses other comments", async () => {
    const bytes = await reshapeAnnotation(await fixture(), "poly", 2, [350, 500]);
    expect(named(await annotations(bytes), "poly").vertices).toEqual([
      { x: 300, y: 300 },
      { x: 400, y: 300 },
      { x: 350, y: 500 },
    ]);
    await expect(reshapeAnnotation(await fixture(), "poly", 3, [0, 0])).rejects.toThrow(/corner/);
    await expect(reshapeAnnotation(await fixture(), "square", 0, [0, 0])).rejects.toThrow(
      /Only lines/,
    );
    await expect(reshapeAnnotation(await fixture(), "locked", 0, [0, 0])).rejects.toThrow();
  });
});

describe("Copying and pasting comments", () => {
  it("copies comments with replies and pop-ups and pastes them with new names", async () => {
    const source = await fixture();
    const clip = await copyAnnotations(source, ["square", "line"]);
    expect(clip).toMatchObject({ count: 2, page: 1, text: "Check this box" });
    const target = await PDFDocument.create();
    target.addPage([600, 800]);
    const pasted = await pasteAnnotations(await target.save(), clip, 1, 18);
    expect(pasted.ids).toHaveLength(2);
    const list = await annotations(pasted.bytes);
    expect(list.map((item) => item.subtype).sort()).toEqual(["Line", "Popup", "Square", "Text"]);
    const square = list.find((item) => item.subtype === "Square")!;
    expect(square.rect).toEqual([118, 82, 218, 132]);
    expect(square.contents).toBe("Check this box");
    const reply = list.find((item) => item.subtype === "Text")!;
    expect(reply.inReplyTo).toBe(square.ref);
    expect(list.find((item) => item.subtype === "Popup")!.parentId).toBe(square.ref);
    const shown = await readableByPdfJs(pasted.bytes);
    expect(shown.map((item) => item.subtype).sort()).toEqual(["Line", "Popup", "Square", "Text"]);
    expect(pasted.ids).toContain(square.annotationName);
    // Names are fresh, so pasting twice gives distinct comments.
    const again = await pasteAnnotations(pasted.bytes, clip, 1, 36);
    const names = (await annotations(again.bytes)).map((item) => item.annotationName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not copy the source page tree and keeps pasted comments on a smaller page", async () => {
    const clip = await copyAnnotations(await fixture(), ["poly"]);
    const copy = await PDFDocument.load(clip.bytes);
    expect(copy.getPageCount()).toBe(1);
    const pasted = await pasteAnnotations(await fixture(), clip, 2, 0);
    const poly = (await annotations(pasted.bytes, 2)).find((item) => item.subtype === "Polygon")!;
    expect(poly.rect[2]).toBeLessThanOrEqual(400);
    expect(poly.rect[3]).toBeLessThanOrEqual(500);
    const doc = await PDFDocument.load(pasted.bytes);
    const pageRef = doc.getPage(1).ref;
    const pastedDict = doc.context.lookup(doc.getPage(1).node.Annots()!.get(0) as PDFRef, PDFDict);
    expect(pastedDict.get(PDFName.of("P"))).toEqual(pageRef);
  });

  it("refuses comments from different pages and form fields", async () => {
    const doc = await PDFDocument.load(await fixture());
    const second = doc.getPage(1);
    second.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Square",
          NM: PDFString.of("far"),
          Rect: [1, 1, 9, 9],
        }),
      ),
    );
    await expect(copyAnnotations(await doc.save(), ["square", "far"])).rejects.toThrow(/one page/);
  });
});

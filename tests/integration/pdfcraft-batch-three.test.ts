import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import { resolve } from "node:path";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  readPageBoxes,
  readPageTransitions,
  setPageTransition,
  setPrintBox,
  userSpaceInsets,
} from "../../src/services/pdf/page-properties";
import { listFonts, readMetadata, writeMetadata } from "../../src/services/pdf/metadata";
import {
  addCallout,
  addCloud,
  addFileAttachmentComment,
  addPolyShape,
  addTextEditProposal,
} from "../../src/services/pdf/comment-types";
import { extractPages, insertDocumentPages } from "../../src/services/document-commands";
import {
  clearPageClipboard,
  getPageClipboard,
  setPageClipboard,
} from "../../src/features/pages/page-clipboard";

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

async function blank(pages = 1, size: [number, number] = [400, 300]) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) doc.addPage(size);
  return doc.save();
}

describe("page clipboard", () => {
  it("pastes copied pages into another document in order", async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    for (const label of ["ONE", "TWO", "THREE"])
      source.addPage([300, 300]).drawText(label, { x: 20, y: 150, font, size: 20 });
    const copied = await extractPages(await source.save(), [0, 2]);
    setPageClipboard(copied, 2);
    expect(getPageClipboard()?.pages).toBe(2);
    const pasted = await insertDocumentPages(await blank(2), getPageClipboard()!.bytes, 1);
    const text = await withPdf(pasted, async (pdf) => {
      const numbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
      const pages = await Promise.all(numbers.map((n) => pdf.getPage(n)));
      const contents = await Promise.all(pages.map((page) => page.getTextContent()));
      return contents.map((content) =>
        content.items.map((item) => ("str" in item ? item.str : "")).join(""),
      );
    });
    expect(text).toEqual(["", "ONE", "THREE", ""]);
    clearPageClipboard();
    expect(getPageClipboard()).toBeNull();
    expect(() => setPageClipboard(copied, 0)).toThrow("Choose pages");
  });
});

describe("page boxes and transitions", () => {
  it("maps displayed margins through every rotation", () => {
    const margins = { top: 1, right: 2, bottom: 3, left: 4 };
    expect(userSpaceInsets(margins, 0)).toEqual({ left: 4, bottom: 3, right: 2, top: 1 });
    expect(userSpaceInsets(margins, 90)).toEqual({ left: 1, bottom: 4, right: 3, top: 2 });
    expect(userSpaceInsets(margins, 180)).toEqual({ left: 2, bottom: 1, right: 4, top: 3 });
    expect(userSpaceInsets(margins, 270)).toEqual({ left: 3, bottom: 2, right: 1, top: 4 });
  });

  it("sets and removes trim boxes on rotated pages and keeps other boxes", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    doc.addPage([400, 300]).setRotation(degrees(90));
    doc.getPage(0).setBleedBox(0, 0, 400, 300);
    const bytes = await doc.save();
    const margins = { top: 10, right: 0, bottom: 0, left: 0 };
    const trimmed = await setPrintBox(bytes, [0, 1], "TrimBox", margins);
    const boxes = await readPageBoxes(trimmed);
    expect(boxes[0].trim).toEqual([0, 0, 400, 290]);
    // On a page rotated 90 degrees the displayed top is the unrotated left edge.
    expect(boxes[1].trim).toEqual([10, 0, 400, 300]);
    expect(boxes[0].bleed).toEqual([0, 0, 400, 300]);
    const removed = await readPageBoxes(await setPrintBox(trimmed, [0], "TrimBox", null));
    expect(removed[0].trim).toBeNull();
    expect(removed[1].trim).not.toBeNull();
    await expect(
      setPrintBox(bytes, [0], "TrimBox", { top: 200, right: 0, bottom: 200, left: 0 }),
    ).rejects.toThrow("no area");
    await expect(setPrintBox(bytes, [], "ArtBox", margins)).rejects.toThrow("at least one page");
  });

  it("writes standard transition dictionaries and removes them", async () => {
    const bytes = await blank(2);
    const transition = {
      style: "Wipe" as const,
      duration: 1.5,
      direction: 270 as const,
      dimension: "H" as const,
      motion: "I" as const,
      advanceAfter: 5,
    };
    const set = await setPageTransition(bytes, [1], transition);
    expect(await readPageTransitions(set)).toEqual([null, transition]);
    const trans = (await PDFDocument.load(set)).getPage(1).node.lookup(PDFName.of("Trans"));
    expect(trans).toBeInstanceOf(PDFDict);
    expect((trans as PDFDict).has(PDFName.of("Dm"))).toBe(false);
    expect(await readPageTransitions(await setPageTransition(set, [1], null))).toEqual([
      null,
      null,
    ]);
    await expect(setPageTransition(bytes, [0], { ...transition, duration: 0 })).rejects.toThrow(
      "Transition length",
    );
  });
});

describe("document properties", () => {
  it("round-trips custom properties and rejects invalid names", async () => {
    const bytes = await blank();
    const base = await readMetadata(bytes);
    const written = await writeMetadata(bytes, {
      ...base,
      custom: [
        { name: "Client", value: "Ünïcode Co" },
        { name: "Case_No.1", value: "42" },
      ],
    });
    expect((await readMetadata(written)).custom).toEqual([
      { name: "Client", value: "Ünïcode Co" },
      { name: "Case_No.1", value: "42" },
    ]);
    const replaced = await writeMetadata(written, {
      ...(await readMetadata(written)),
      custom: [{ name: "Client", value: "New" }],
    });
    expect((await readMetadata(replaced)).custom).toEqual([{ name: "Client", value: "New" }]);
    await Promise.all(
      ["Title", "bad name", "a/b", ""].map((name) =>
        expect(writeMetadata(bytes, { ...base, custom: [{ name, value: "x" }] })).rejects.toThrow(),
      ),
    );
    await expect(
      writeMetadata(bytes, {
        ...base,
        custom: [
          { name: "Same", value: "1" },
          { name: "Same", value: "2" },
        ],
      }),
    ).rejects.toThrow("twice");
  });

  it("lists fonts with embedding status and pages", async () => {
    const doc = await PDFDocument.create();
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const courier = await doc.embedFont(StandardFonts.Courier);
    doc.addPage().drawText("a", { font: helvetica });
    const second = doc.addPage();
    second.drawText("b", { font: helvetica });
    second.drawText("c", { font: courier });
    const fonts = await listFonts(await doc.save());
    expect(fonts.map(({ name, embedded, pages }) => [name, embedded, pages])).toEqual([
      ["Courier", false, [2]],
      ["Helvetica", false, [1, 2]],
    ]);
  });
});

describe("comment types", () => {
  it("saves polygons, connected lines, clouds and callouts with appearances", async () => {
    let bytes = await blank();
    bytes = await addPolyShape(bytes, {
      page: 1,
      kind: "Polygon",
      vertices: [
        [50, 50],
        [150, 50],
        [100, 120],
      ],
    });
    bytes = await addPolyShape(bytes, {
      page: 1,
      kind: "PolyLine",
      vertices: [
        [200, 50],
        [250, 100],
        [300, 60],
      ],
    });
    bytes = await addCloud(bytes, { page: 1, start: [60, 160], end: [180, 240] });
    bytes = await addCallout(bytes, {
      page: 1,
      tip: [300, 200],
      box: [200, 230],
      text: "Check this total",
      boxWidth: 120,
    });
    const annotations = await withPdf(bytes, async (pdf) =>
      (await pdf.getPage(1)).getAnnotations(),
    );
    expect(annotations.map((item) => item.subtype)).toEqual([
      "Polygon",
      "PolyLine",
      "Polygon",
      "FreeText",
    ]);
    expect(annotations[3].contentsObj.str).toBe("Check this total");
    const doc = await PDFDocument.load(bytes);
    const dicts = doc
      .getPage(0)
      .node.Annots()!
      .asArray()
      .map((ref) => doc.context.lookup(ref) as PDFDict);
    expect(dicts.every((dict) => dict.has(PDFName.of("AP")))).toBe(true);
    expect(dicts[2].lookup(PDFName.of("BE"))).toBeInstanceOf(PDFDict);
    expect(dicts[3].lookup(PDFName.of("IT"))).toBe(PDFName.of("FreeTextCallout"));
    await expect(
      addPolyShape(bytes, {
        page: 1,
        kind: "Polygon",
        vertices: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).rejects.toThrow("at least 3");
    await expect(
      addCallout(bytes, { page: 1, tip: [0, 0], box: [9, 9], text: " " }),
    ).rejects.toThrow("callout text");
    await expect(addCloud(bytes, { page: 2, start: [0, 0], end: [50, 50] })).rejects.toThrow(
      "outside",
    );
  });

  it("groups a replacement strikeout with its caret and saves insertions", async () => {
    const quads = [{ x1: 40, y1: 100, x2: 120, y2: 112 }];
    const replaced = await addTextEditProposal(await blank(), {
      page: 1,
      kind: "replace",
      quads,
      text: "new wording",
      selected: "old wording",
    });
    const annotations = await withPdf(replaced, async (pdf) =>
      (await pdf.getPage(1)).getAnnotations(),
    );
    expect(annotations.map((item) => item.subtype)).toEqual(["Caret", "StrikeOut"]);
    expect(annotations[0].contentsObj.str).toBe("new wording");
    const doc = await PDFDocument.load(replaced);
    const [caretRef, strikeRef] = doc.getPage(0).node.Annots()!.asArray();
    const strike = doc.context.lookup(strikeRef) as PDFDict;
    expect(strike.get(PDFName.of("IRT"))).toBe(caretRef);
    expect(strike.get(PDFName.of("RT"))).toBe(PDFName.of("Group"));
    const inserted = await addTextEditProposal(await blank(), {
      page: 1,
      kind: "insert",
      quads,
      text: "added",
    });
    expect(
      (await withPdf(inserted, async (pdf) => (await pdf.getPage(1)).getAnnotations())).map(
        (item) => item.subtype,
      ),
    ).toEqual(["Caret"]);
    await expect(
      addTextEditProposal(await blank(), { page: 1, kind: "insert", quads, text: "" }),
    ).rejects.toThrow("Type the text");
  });

  it("embeds a file attachment comment that PDF.js can read back", async () => {
    const data = new TextEncoder().encode("attached content");
    const bytes = await addFileAttachmentComment(await blank(), {
      page: 1,
      at: [380, 280],
      fileName: "../notes.txt",
      mimeType: "text/plain",
      data,
      description: "Supporting notes",
    });
    const [annotation, content] = await withPdf(bytes, async (pdf) => {
      const [found] = await (await pdf.getPage(1)).getAnnotations();
      return [found, await pdf.getAttachmentContent(found.fileId)] as const;
    });
    expect(annotation.subtype).toBe("FileAttachment");
    expect(annotation.file.filename).toBe("notes.txt");
    expect(new TextDecoder().decode(content)).toBe("attached content");
    // The icon stays on the page.
    expect(annotation.rect[2]).toBeLessThanOrEqual(400);
    expect(annotation.rect[3]).toBeLessThanOrEqual(300);
  });
});

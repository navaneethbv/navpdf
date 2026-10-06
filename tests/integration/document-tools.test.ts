import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { addStamp } from "../../src/services/pdf/stamps";
import { flattenDocument, placementMatrix } from "../../src/services/pdf/flatten";
import {
  addFormField,
  addLinkAnnotation,
  addShapeAnnotation,
  addStickyNote,
  addTextMarkupAnnotations,
  updateFormField,
} from "../../src/services/document-commands";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function reopen(bytes: Uint8Array) {
  return getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
    useSystemFonts: false,
  }).promise;
}

async function pages(...sizes: { size?: [number, number]; rotation?: number }[]) {
  const doc = await PDFDocument.create();
  for (const { size = [612, 792], rotation = 0 } of sizes)
    doc.addPage(size).setRotation(degrees(rotation));
  return doc.save();
}

function annotationDicts(doc: PDFDocument, pageIndex: number) {
  const annots = doc.getPage(pageIndex).node.Annots();
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref, PDFDict));
}

function numbers(dict: PDFDict, key: string) {
  return dict
    .lookup(PDFName.of(key), PDFArray)
    .asArray()
    .map((value) => (value as PDFNumber).asNumber());
}

describe("stamps", () => {
  it("adds standard and custom stamps with appearances that PDF.js reads", async () => {
    let bytes = await pages({});
    bytes = await addStamp(bytes, {
      page: 1,
      stamp: "Approved",
      detail: "A. Reviewer, 2026-10-06",
      position: "top-right",
      author: "A. Reviewer",
    });
    bytes = await addStamp(bytes, {
      page: 1,
      stamp: "Custom",
      label: "paid in full",
      tone: "green",
      position: "bottom-left",
    });

    const saved = await PDFDocument.load(bytes);
    const [approved, custom] = annotationDicts(saved, 0);
    expect(approved.get(PDFName.of("Name"))).toEqual(PDFName.of("Approved"));
    expect(custom.get(PDFName.of("Name"))).toEqual(PDFName.of("NavPDFCustom"));
    const rect = numbers(approved, "Rect");
    // Top-right placement keeps a 24 point margin from the page edges.
    expect(rect[2]).toBeCloseTo(612 - 24, 3);
    expect(rect[3]).toBeCloseTo(792 - 24, 3);
    const appearance = approved.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N"));
    expect(appearance).toBeDefined();

    const pdf = await reopen(bytes);
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    expect(annotations.map((item) => item.subtype)).toEqual(["Stamp", "Stamp"]);
    expect(annotations.every((item) => item.hasAppearance)).toBe(true);
    expect(annotations[0].contentsObj.str).toBe("APPROVED\nA. Reviewer, 2026-10-06");
    expect(annotations[1].contentsObj.str).toBe("PAID IN FULL");
    expect(annotations[0].titleObj.str).toBe("A. Reviewer");
  });

  it("counter-rotates the appearance so stamps read upright on rotated pages", async () => {
    const bytes = await addStamp(await pages({ rotation: 90 }), {
      page: 1,
      stamp: "Draft",
      position: "top-left",
      width: 200,
    });
    const saved = await PDFDocument.load(bytes);
    const [stamp] = annotationDicts(saved, 0);
    const appearance = saved.context.lookup(
      stamp.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N")),
    ) as unknown as { dict: PDFDict };
    expect(numbers(appearance.dict, "Matrix")).toEqual([0, 1, -1, 0, 0, 0]);
    const [x1, y1, x2, y2] = numbers(stamp, "Rect");
    // The displayed top-left corner of a page rotated 90 degrees is the user-space origin.
    expect([x1, y1]).toEqual([24, 24]);
    // A 200 point wide stamp spans user-space height on a quarter-turned page.
    expect(y2 - y1).toBeCloseTo(200, 3);
    expect(x2 - x1).toBeLessThan(80);
  });

  it("rejects pages outside the document, empty custom text and unsupported characters", async () => {
    const bytes = await pages({});
    await expect(addStamp(bytes, { page: 2, stamp: "Final", position: "center" })).rejects.toThrow(
      /outside the document/,
    );
    await expect(
      addStamp(bytes, { page: 1, stamp: "Custom", label: "  ", position: "center" }),
    ).rejects.toThrow(/Enter the text/);
    await expect(
      addStamp(bytes, { page: 1, stamp: "Custom", label: "承認", position: "center" }),
    ).rejects.toThrow(/built-in fonts/);
    await expect(
      addStamp(bytes, { page: 1, stamp: "Final", detail: "x".repeat(81), position: "center" }),
    ).rejects.toThrow(/80 characters/);
  });
});

describe("flattening", () => {
  async function markedUpForm() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([612, 792]).drawText("Body text", { x: 72, y: 700, size: 12, font });
    doc.addPage([612, 792]);
    let bytes = await doc.save();
    bytes = await addTextMarkupAnnotations(bytes, "Highlight", [
      { page: 1, quads: [{ x1: 70, y1: 696, x2: 140, y2: 712 }], opacity: 0.5 },
    ]);
    bytes = await addShapeAnnotation(bytes, {
      page: 1,
      kind: "Square",
      start: [100, 300],
      end: [200, 360],
    });
    bytes = await addStickyNote(bytes, { page: 1, x: 500, y: 700, contents: "Review" });
    bytes = await addLinkAnnotation(bytes, {
      page: 1,
      rect: [72, 100, 200, 120],
      target: { type: "page", page: 2 },
    });
    bytes = await addStamp(bytes, { page: 2, stamp: "Final", position: "center" });
    bytes = await addFormField(bytes, {
      type: "text",
      name: "Reviewer",
      page: 1,
      x: 72,
      y: 600,
      width: 200,
      height: 24,
    });
    return updateFormField(bytes, { name: "Reviewer", value: "Flattened Value" });
  }

  async function pageText(pdf: Awaited<ReturnType<typeof reopen>>, number: number) {
    const content = await (await pdf.getPage(number)).getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  }

  it("draws comments, stamps and field values into the page and keeps links", async () => {
    const { bytes, report } = await flattenDocument(await markedUpForm(), {
      annotations: true,
      forms: true,
    });
    expect(report).toEqual({ annotations: 4, widgets: 1, skipped: 0 });

    const pdf = await reopen(bytes);
    const first = await (await pdf.getPage(1)).getAnnotations();
    expect(first.map((item) => item.subtype)).toEqual(["Link"]);
    expect(await (await pdf.getPage(2)).getAnnotations()).toEqual([]);
    expect(await pdf.getFieldObjects()).toBeNull();
    expect(await pageText(pdf, 1)).toContain("Flattened Value");
    expect(await pageText(pdf, 2)).toContain("FINAL");
    expect((await PDFDocument.load(bytes)).catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("flattens only the chosen kind of object", async () => {
    const source = await markedUpForm();
    const formsOnly = await flattenDocument(source, { annotations: false, forms: true });
    expect(formsOnly.report.widgets).toBe(1);
    const pdf = await reopen(formsOnly.bytes);
    const kept = (await (await pdf.getPage(1)).getAnnotations()).map((item) => item.subtype);
    expect(new Set(kept)).toEqual(new Set(["Highlight", "Square", "Text", "Popup", "Link"]));

    const commentsOnly = await flattenDocument(source, { annotations: true, forms: false });
    expect(commentsOnly.report).toMatchObject({ annotations: 4, widgets: 0 });
    expect(await (await reopen(commentsOnly.bytes)).getFieldObjects()).not.toBeNull();
  });

  it("places transformed appearances inside the annotation rectangle", () => {
    expect(placementMatrix([0, 0, 100, 50], [1, 0, 0, 1, 0, 0], [10, 20, 110, 70])).toEqual([
      1, 0, 0, 1, 10, 20,
    ]);
    // A quarter-turned appearance's transformed box is 50 wide and 100 high.
    expect(placementMatrix([0, 0, 100, 50], [0, 1, -1, 0, 0, 0], [0, 0, 50, 100])).toEqual([
      1, 0, 0, 1, 50, 0,
    ]);
    expect(placementMatrix([0, 0, 0, 10], [1, 0, 0, 1, 0, 0], [0, 0, 10, 10])).toBeNull();
  });

  it("refuses signed documents and requests with nothing to flatten", async () => {
    await expect(
      flattenDocument(await pages({}), { annotations: true, forms: true }),
    ).rejects.toThrow(/nothing to flatten/);
    await expect(
      flattenDocument(await pages({}), { annotations: false, forms: false }),
    ).rejects.toThrow(/Choose what/);

    const doc = await PDFDocument.create();
    doc.addPage();
    const form = doc.getForm();
    form.createTextField("placeholder").addToPage(doc.getPage(0), { x: 10, y: 10 });
    const signature = doc.context.obj({ FT: "Sig", T: "Signature1", V: doc.context.obj({}) });
    form.acroForm.addField(doc.context.register(signature));
    await expect(
      flattenDocument(await doc.save(), { annotations: false, forms: true }),
    ).rejects.toThrow(/digitally signed/);
  });
});

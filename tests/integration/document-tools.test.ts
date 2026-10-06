import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, degrees } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { addStamp } from "../../src/services/pdf/stamps";

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

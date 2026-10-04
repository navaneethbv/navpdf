import { describe, expect, it } from "vitest";
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFString } from "pdf-lib";
import {
  describeStructureLoss,
  extractPages,
  inspectStructure,
  mergeDocuments,
  reorderPages,
  splitDocument,
} from "../../src/services/document-commands";

/** Build a document carrying an outline, an AcroForm field, and a title. */
async function richDocument(pages = 4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  doc.getForm().createTextField("probe.field").addToPage(doc.getPage(0), {
    x: 10,
    y: 10,
    width: 80,
    height: 20,
  });
  doc.setTitle("Structure Probe");

  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const item = PDFDict.withContext(ctx);
  item.set(PDFName.of("Title"), PDFString.of("Chapter One"));
  item.set(PDFName.of("Parent"), outlinesRef);
  const dest = PDFArray.withContext(ctx);
  dest.push(doc.getPage(1).ref);
  dest.push(PDFName.of("Fit"));
  item.set(PDFName.of("Dest"), dest);
  const itemRef = ctx.register(item);
  const outlines = PDFDict.withContext(ctx);
  outlines.set(PDFName.of("Type"), PDFName.of("Outlines"));
  outlines.set(PDFName.of("First"), itemRef);
  outlines.set(PDFName.of("Last"), itemRef);
  outlines.set(PDFName.of("Count"), PDFNumber.of(1));
  ctx.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  return doc.save();
}

describe("page-operation structure preservation", () => {
  it("reports the outline, form fields, and title a document carries", async () => {
    const summary = await inspectStructure(await richDocument());
    expect(summary.hasOutline).toBe(true);
    expect(summary.formFields).toBe(1);
    expect(summary.title).toBe("Structure Probe");
  });

  it("preserves outline, form fields, and metadata when reordering", async () => {
    const source = await richDocument();
    const reordered = await reorderPages(source, [3, 2, 1, 0]);

    const summary = await inspectStructure(reordered);
    expect(summary.hasOutline).toBe(true);
    expect(summary.formFields).toBe(1);
    expect(summary.title).toBe("Structure Probe");
  });

  it("actually changes page order while preserving structure", async () => {
    const source = await richDocument(3);
    const before = await PDFDocument.load(source);
    const firstRef = before.getPage(0).ref.toString();

    const reordered = await reorderPages(source, [2, 1, 0]);
    const after = await PDFDocument.load(reordered);

    expect(after.getPageCount()).toBe(3);
    expect(after.getPage(2).ref.toString()).toBe(firstRef);
    expect(after.getPage(0).ref.toString()).not.toBe(firstRef);
  });

  it("warns that extraction drops the outline and form fields", async () => {
    const source = await richDocument();
    const warning = await describeStructureLoss([source]);
    expect(warning).toMatch(/bookmark/i);
    expect(warning).toMatch(/form field/i);

    // The warning must describe the real outcome of the operation.
    const extracted = await extractPages(source, [0, 1]);
    const summary = await inspectStructure(extracted);
    expect(summary.hasOutline).toBe(false);
    expect(summary.formFields).toBe(0);
  });

  it("preserves merge structures while warning for destructive split composition", async () => {
    const source = await richDocument();
    expect(await describeStructureLoss([source, source])).toMatch(/bookmark/i);

    const merged = await mergeDocuments([source, source]);
    expect((await inspectStructure(merged)).formFields).toBe(2);
    expect((await inspectStructure(merged)).hasOutline).toBe(true);

    const parts = await splitDocument(source, [[0, 1]]);
    expect((await inspectStructure(parts[0])).hasOutline).toBe(false);
  });

  it("returns no warning for documents with nothing to lose", async () => {
    const plain = await PDFDocument.create();
    plain.addPage([100, 100]);
    const bytes = await plain.save();
    expect(await describeStructureLoss([bytes])).toBe("");
  });
});

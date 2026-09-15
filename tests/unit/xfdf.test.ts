import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import {
  addFormField,
  addReply,
  addStampAnnotation,
  addStickyNote,
  addTextMarkupAnnotations,
  setReviewState,
} from "../../src/services/document-commands";
import { exportXfdf, importXfdf } from "../../src/services/xfdf";

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  return doc.save();
}

describe("XFDF exchange", () => {
  it.each(["Highlight", "Underline", "StrikeOut"] as const)(
    "preserves %s quadrilaterals after reload",
    async (kind) => {
      const source = await addTextMarkupAnnotations(await blank(), kind, [
        {
          page: 1,
          quads: [
            { x1: 10, y1: 20, x2: 80, y2: 40 },
            { x1: 10, y1: 50, x2: 70, y2: 65 },
          ],
        },
      ]);
      const xml = await exportXfdf(source);
      const doc = await PDFDocument.load(await importXfdf(await blank(), xml));
      const annotation = doc.getPage(0).node.Annots()!.lookup(0, PDFDict);
      const quads = annotation.lookup(PDFName.of("QuadPoints"), PDFArray);
      expect(quads.asArray().map((v) => (v as PDFNumber).asNumber())).toEqual([
        10, 40, 80, 40, 10, 20, 80, 20, 10, 65, 70, 65, 10, 50, 70, 50,
      ]);
    },
  );

  it("accepts coords and refuses malformed markup geometry", async () => {
    const bytes = await blank();
    const xml = (coords: string) =>
      `<xfdf><annots><highlight page="0" rect="0,0,10,10" coords="${coords}"></highlight></annots></xfdf>`;
    await expect(importXfdf(bytes, xml("0,10,10,10,0,0,10,0"))).resolves.toBeInstanceOf(Uint8Array);
    for (const coords of ["", "0,1", "0,10,10,10,0,0,10,NaN", "0,10,10,10,0,0,10,0,bad"]) {
      await expect(importXfdf(bytes, xml(coords))).rejects.toThrow(/geometry/);
    }
  });
  it("exports markup and imports it into a new PDF", async () => {
    const source = await addStickyNote(await blank(), {
      page: 1,
      x: 40,
      y: 300,
      contents: "Review this",
      id: "note-1",
    });
    const xml = await exportXfdf(source);
    expect(xml).toContain("<text");
    const imported = await importXfdf(await blank(), xml);
    expect((await exportXfdf(imported)).match(/<text\b/g)?.length).toBe(1);
  });

  it("rejects declarations and ignores invalid page records", async () => {
    await expect(importXfdf(await blank(), "<!DOCTYPE xfdf><xfdf />")).rejects.toThrow(
      /forbidden declaration/,
    );
    const imported = await importXfdf(
      await blank(),
      '<xfdf><annots><text page="99" rect="0,0,10,10"></text><text page="0" rect="bad"></text></annots></xfdf>',
    );
    expect((await exportXfdf(imported)).match(/<text\b/g) ?? []).toHaveLength(0);
  });

  it("round-trips markups, replies, stamps, and form values", async () => {
    let source = await addStickyNote(await blank(), {
      page: 1,
      x: 40,
      y: 300,
      contents: "Needs & review",
      id: "parent",
    });
    source = await addReply(source, { parentId: "parent", contents: "Reply" });
    source = await setReviewState(source, "parent", "Accepted");
    for (const kind of ["Highlight", "Underline", "StrikeOut"] as const) {
      source = await addTextMarkupAnnotations(source, kind, [
        { page: 1, quads: [{ x1: 50, y1: 100, x2: 150, y2: 120 }], contents: kind },
      ]);
    }
    source = await addStampAnnotation(source, {
      page: 1,
      rect: [80, 80, 140, 110],
      name: "For Review",
      contents: "Stamp",
      id: "stamp-1",
    });
    source = await addFormField(source, {
      type: "text",
      name: "Reviewer",
      page: 1,
      x: 30,
      y: 30,
      width: 100,
      height: 20,
      defaultValue: "Ada",
    });
    source = await addFormField(source, {
      type: "checkbox",
      name: "Approved",
      page: 1,
      x: 150,
      y: 30,
      width: 20,
      height: 20,
      defaultValue: "yes",
    });
    const xml = await exportXfdf(source);
    expect(xml).toContain('stamp="For Review"');
    expect(xml).toContain("Needs &amp; review");
    expect(xml).toContain('name="Reviewer"');
    expect(xml).toContain(">Ada</value>");
    expect(xml).toContain('name="Approved"');
    expect(xml).toContain(">Yes</value>");

    let target = await addFormField(source.slice(0), {
      type: "text",
      name: "TargetText",
      page: 1,
      x: 30,
      y: 200,
      width: 100,
      height: 20,
    });
    target = await addFormField(target, {
      type: "checkbox",
      name: "TargetCheck",
      page: 1,
      x: 150,
      y: 200,
      width: 20,
      height: 20,
    });
    const imported = await importXfdf(
      target,
      xml.replace(/Reviewer/g, "TargetText").replace(/Approved/g, "TargetCheck"),
    );
    const form = (await PDFDocument.load(imported)).getForm();
    expect(form.getTextField("TargetText").getText()).toBe("Ada");
    expect(form.getCheckBox("TargetCheck").isChecked()).toBe(true);
    const importedXml = await exportXfdf(imported);
    expect(importedXml).toContain("TargetText");
    expect(importedXml).toContain("TargetCheck");
  });
});

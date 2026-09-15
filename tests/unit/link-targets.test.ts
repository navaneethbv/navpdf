import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFArray, PDFNumber, PDFDict } from "pdf-lib";
import { stripExternalPageLinks } from "../../src/services/pdf/link-targets";

describe("stripExternalPageLinks (DS-03)", () => {
  it("removes links pointing to pages outside the kept set while preserving internal links", async () => {
    const doc = await PDFDocument.create();
    const page1 = doc.addPage([300, 400]);
    const page2 = doc.addPage([300, 400]);

    // Link 1 on page 1 -> page 2 via /Dest
    const dest1 = doc.context.obj([
      page2.ref,
      PDFName.of("XYZ"),
      PDFNumber.of(0),
      PDFNumber.of(0),
      PDFNumber.of(0),
    ]);
    const link1 = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 50, 20],
      Dest: dest1,
    });
    const link1Ref = doc.context.register(link1);

    // Link 2 on page 1 -> page 2 via /A << /S /GoTo /D [page2Ref /Fit] >>
    const action2 = doc.context.obj({
      Type: "Action",
      S: "GoTo",
      D: [page2.ref, PDFName.of("Fit")],
    });
    const link2 = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 30, 50, 40],
      A: action2,
    });
    const link2Ref = doc.context.register(link2);

    // Link 3 on page 1 -> page 1 itself via /Dest
    const dest3 = doc.context.obj([
      page1.ref,
      PDFName.of("XYZ"),
      PDFNumber.of(0),
      PDFNumber.of(0),
      PDFNumber.of(0),
    ]);
    const link3 = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 50, 50, 60],
      Dest: dest3,
    });
    const link3Ref = doc.context.register(link3);

    // Attach annotations to page 1
    const annots = doc.context.obj([link1Ref, link2Ref, link3Ref]);
    page1.node.set(PDFName.of("Annots"), annots);

    // Call stripExternalPageLinks keeping only page 0 (page 1)
    const removed = stripExternalPageLinks(doc, new Set([0]));
    expect(removed).toBe(2);

    // Check surviving annotations on page 1
    const survivingAnnots = page1.node.Annots();
    expect(survivingAnnots).toBeInstanceOf(PDFArray);
    expect(survivingAnnots?.size()).toBe(1);

    const survivingRef = survivingAnnots?.get(0);
    expect(survivingRef).toEqual(link3Ref);

    const survivingDict = doc.context.lookup(survivingRef, PDFDict);
    const survivingDest = survivingDict.lookup(PDFName.of("Dest")) as PDFArray;
    expect(survivingDest.get(0)).toEqual(page1.ref);
  });
});

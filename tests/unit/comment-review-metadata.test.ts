import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { readComment } from "../../src/services/pdf/read-comment";
import { parsePdfDate } from "../../src/features/annotations/comment-summary";

describe("comment review metadata", () => {
  it("reads author and timezone-normalized dates from PDF.js annotations", () => {
    expect(
      readComment(
        {
          id: "note",
          subtype: "Text",
          titleObj: { str: "Ada" },
          modificationDate: "D:20261013093000+02'00'",
        },
        1,
      ),
    ).toMatchObject({ author: "Ada", modified: "2026-10-13T07:30:00.000Z" });
  });
  it("uses a creation date only when the modification date is missing or invalid", () => {
    expect(
      readComment(
        {
          id: "note",
          subtype: "Text",
          title: "Zoe",
          modificationDate: "invalid",
          creationDate: "D:20261013093000-03'30'",
        },
        1,
      ),
    ).toMatchObject({ author: "Zoe", modified: "2026-10-13T13:00:00.000Z" });
    expect(
      readComment({ id: "note", subtype: "Text", modificationDate: "yesterday" }, 1)?.modified,
    ).toBeUndefined();
  });
  it("uses saved metadata and stable reply identifiers when PDF.js omits them", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const parent = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Text",
        NM: PDFString.of("parent"),
        T: PDFString.of("Ada"),
      }),
    );
    const reply = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Text",
        NM: PDFString.of("reply"),
        IRT: parent,
        T: PDFString.of("Zoe"),
        M: PDFString.of("D:20261013093000Z"),
      }),
    );
    page.node.set(PDFName.of("Annots"), doc.context.obj([parent, reply]));
    const reopened = await PDFDocument.load(await doc.save());
    expect(reopened.getPage(0).node.Annots()!.lookup(1, PDFDict)).toBeTruthy();
    expect(
      readComment(
        { id: "6R", annotationName: "reply", subtype: "Text", inReplyTo: "5R" },
        1,
        reopened.getPage(0).node.Annots(),
      ),
    ).toMatchObject({ author: "Zoe", modified: "2026-10-13T09:30:00.000Z", replyTo: "parent" });
  });
  it("does not turn impossible calendar dates or invalid timezones into recorded dates", () => {
    for (const value of [
      "D:20260230090000Z",
      "D:20261301",
      "D:20260101240000Z",
      "D:20260101000000+24'00'",
      "D:20260101000000Zjunk",
    ])
      expect(parsePdfDate(value)).toBe("");
    expect(parsePdfDate("D:20240229093000Z")).toBe("2024-02-29T09:30:00.000Z");
  });

  it("ignores malformed optional metadata without losing a readable annotation", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const annotation = doc.context.register(
      doc.context.obj({
        Subtype: "Text",
        NM: PDFString.of("note"),
        T: 123,
        M: false,
        CreationDate: [],
        IRT: PDFString.of("broken"),
      }),
    );
    page.node.set(PDFName.of("Annots"), doc.context.obj([annotation]));
    expect(
      readComment(
        { id: "note", subtype: "Text", contentsObj: { str: "Readable note" } },
        1,
        page.node.Annots(),
      ),
    ).toMatchObject({ text: "Readable note" });
  });

  it("reads saved review states when PDF.js returns a PDF name object", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const annotation = doc.context.register(
      doc.context.obj({
        Subtype: "Text",
        NM: PDFString.of("state"),
        State: "Accepted",
        StateModel: "Review",
      }),
    );
    page.node.set(PDFName.of("Annots"), doc.context.obj([annotation]));
    expect(
      readComment(
        { id: "state", subtype: "Text", state: { name: "Accepted" } },
        1,
        page.node.Annots(),
      ),
    ).toMatchObject({ reviewState: "Accepted" });
  });
});

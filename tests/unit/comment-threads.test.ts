import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import {
  addReply,
  addStampAnnotation,
  addStickyNote,
  setReviewState,
} from "../../src/services/document-commands";

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  return doc.save();
}

describe("comment threads and stamps", () => {
  it("writes a reply linked to its parent and a review state", async () => {
    const parent = await addStickyNote(await blank(), {
      page: 1,
      x: 40,
      y: 300,
      contents: "Parent",
      id: "parent-note",
    });
    const withReply = await addReply(parent, {
      parentId: "parent-note",
      contents: "Reply",
      id: "reply-note",
    });
    const withState = await setReviewState(withReply, "parent-note", "Accepted");
    const doc = await PDFDocument.load(withState);
    const annots = doc.getPage(0).node.Annots()!;
    const entries = Array.from({ length: annots.size() }, (_, index) =>
      annots.lookup(index, PDFDict),
    );
    expect(
      entries.some(
        (entry) => entry.lookupMaybe(PDFName.of("NM"), PDFString)?.asString() === "reply-note",
      ),
    ).toBe(true);
  });

  it("writes a named stamp subtype", async () => {
    const output = await addStampAnnotation(await blank(), {
      page: 1,
      rect: [40, 40, 160, 80],
      name: "Approved",
    });
    const doc = await PDFDocument.load(output);
    const annotations = doc.getPage(0).node.Annots()!;
    expect(annotations.size()).toBe(1);
    expect(annotations.lookup(0, PDFDict).lookup(PDFName.of("Subtype"), PDFName).decodeText()).toBe(
      "Stamp",
    );
  });
});

import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import {
  addStickyNote,
  addReply,
  deleteAnnotation,
  updateAnnotation,
} from "../../src/services/document-commands";
import { exportXfdf, importXfdf } from "../../src/services/xfdf";

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc.save();
}

describe("untrusted PDF text serialization", () => {
  it.each(["note) /Unexpected (injected", "path\\name (nested)", "日本語 • café\nsecond line"])(
    "preserves comment text and identifiers after saving: %s",
    async (text) => {
      let bytes = await addStickyNote(await blank(), {
        page: 1,
        x: 30,
        y: 100,
        id: text,
        author: text,
        contents: text,
      });
      const doc = await PDFDocument.load(bytes);
      const annotation = doc.getPage(0).node.Annots()!.lookup(0, PDFDict);
      for (const key of ["NM", "T", "Contents"]) {
        expect(annotation.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText()).toBe(
          text,
        );
      }
      expect(annotation.has(PDFName.of("Unexpected"))).toBe(false);
      bytes = await addReply(bytes, { parentId: text, id: `${text} reply`, contents: text });
      bytes = await updateAnnotation(bytes, { id: text, contents: `${text} updated` });
      const xml = await exportXfdf(bytes);
      const imported = await PDFDocument.load(await importXfdf(await blank(), xml));
      expect(
        imported
          .getPage(0)
          .node.Annots()!
          .lookup(0, PDFDict)
          .lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)
          ?.decodeText(),
      ).toBe(`${text} updated`);
      const deleted = await PDFDocument.load(await deleteAnnotation(bytes, text));
      expect(deleted.getPage(0).node.Annots()).toBeUndefined();
    },
  );
});

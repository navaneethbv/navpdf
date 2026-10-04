import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { resolve } from "node:path";
import { mergeDocuments } from "../../src/services/document-commands";
import { readBookmarkTree, writeBookmarkTree } from "../../src/services/pdf/bookmarks";
GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function fixture(value: string) {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([200, 300]), doc.addPage([300, 200])];
  const form = doc.getForm();
  const field = form.createTextField("person.name");
  field.setText(value);
  field.addToPage(pages[0], { x: 10, y: 20, width: 160, height: 30 });
  field.addToPage(pages[1], { x: 10, y: 20, width: 160, height: 30 });
  const check = form.createCheckBox("approved");
  check.addToPage(pages[1]);
  check.check();
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  writeBookmarkTree(doc, [
    {
      id: "first",
      title: "Résumé",
      page: 0,
      children: [{ id: "second", title: "Details", page: 1, children: [] }],
    },
  ]);
  const link = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [0, 0, 10, 10],
    Dest: [pages[1].ref, "Fit"],
  });
  pages[0].node.addAnnot(doc.context.register(link));
  return doc.save();
}

describe("structure-preserving merge", () => {
  it("retains independently editable colliding fields, values, widgets, links and nested Unicode bookmarks", async () => {
    const bytes = await mergeDocuments([await fixture("Alice"), await fixture("Bob")]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    const fields = doc.getForm().getFields();
    expect(fields).toHaveLength(4);
    expect(new Set(fields.map((field) => field.getName())).size).toBe(4);
    expect(doc.getForm().getTextField("person.name").getText()).toBe("Alice");
    const second = fields.find(
      (field) => field.getName().endsWith(".name") && field.getName() !== "person.name",
    )!;
    expect(doc.getForm().getTextField(second.getName()).getText()).toBe("Bob");
    const tree = readBookmarkTree(doc);
    expect(tree.map((node) => node.page)).toEqual([0, 2]);
    expect(tree.map((node) => node.children[0].page)).toEqual([1, 3]);
    const task = getDocument({ data: bytes.slice() });
    try {
      const pdf = await task.promise;
      expect((await pdf.getOutline())!.map((item) => item.title)).toEqual(["Résumé", "Résumé"]);
      for (let page = 1; page <= 4; page++) {
        const annotations = await (await pdf.getPage(page)).getAnnotations();
        expect(annotations.find((annotation) => annotation.fieldType === "Tx")?.fieldValue).toBe(
          page <= 2 ? "Alice" : "Bob",
        );
      }
      for (const page of [2, 4]) {
        const checkbox = (await (await pdf.getPage(page)).getAnnotations()).find(
          (annotation) => annotation.fieldType === "Btn",
        );
        expect(checkbox?.fieldValue).toBe("Yes");
      }
      const link = (await (await pdf.getPage(3)).getAnnotations()).find(
        (annotation) => annotation.dest,
      );
      expect(await pdf.getPageIndex(link!.dest[0])).toBe(3);
    } finally {
      await task.destroy();
    }
  });
  it("prunes excluded widgets and remaps bookmarks when merging selected pages", async () => {
    const bytes = await mergeDocuments([{ bytes: await fixture("Selected"), ranges: [1] }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getForm().getTextField("person.name").acroField.getWidgets()).toHaveLength(1);
    expect(readBookmarkTree(doc)[0]).toMatchObject({ page: null, children: [{ page: 0 }] });
  });
  it("rejects XFA and calculated forms rather than losing their behavior", async () => {
    const doc = await PDFDocument.load(await fixture("Keep"));
    doc.catalog.getOrCreateAcroForm().dict.set(PDFName.of("XFA"), PDFString.of("unsupported"));
    await expect(
      mergeDocuments([await doc.save({ updateFieldAppearances: false })]),
    ).rejects.toThrow("XFA");
  });
  it("rejects signed forms and cyclic outlines", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const sig = doc.context.obj({
      FT: "Sig",
      T: PDFString.of("signature"),
      V: doc.context.obj({ Type: "Sig" }),
    });
    doc.catalog
      .getOrCreateAcroForm()
      .dict.set(PDFName.of("Fields"), doc.context.obj([doc.context.register(sig)]));
    await expect(
      mergeDocuments([await doc.save({ updateFieldAppearances: false })]),
    ).rejects.toThrow("signed PDFs");
    const another = await PDFDocument.load(await fixture("Keep"));
    const root = another.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    const first = root.lookup(PDFName.of("First"), PDFDict);
    first.set(PDFName.of("Next"), root.get(PDFName.of("First"))!);
    await expect(mergeDocuments([await another.save()])).rejects.toThrow("bookmark tree");
  });
});

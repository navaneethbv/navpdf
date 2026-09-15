import { describe, it, expect } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFString,
} from "pdf-lib";
import { walkEmbeddedFiles } from "../../src/services/pdf/name-tree";
import {
  listEmbeddedAttachments,
  extractEmbeddedAttachment,
  deleteEmbeddedAttachment,
} from "../../src/services/document-commands";

describe("Embedded files name tree traversal", () => {
  async function createMultiLevelNameTreePdf() {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);

    const contents = [
      "File 1 content",
      "File 2 content",
      "File 3 content",
      "File 4 content",
    ];
    const fileSpecs = [];
    for (let i = 0; i < 4; i++) {
      const data = new TextEncoder().encode(contents[i]);
      const stream = doc.context.flateStream(data);
      stream.dict.set(
        PDFName.of("Params"),
        doc.context.obj({
          Size: contents[i].length,
        }),
      );
      const streamRef = doc.context.register(stream);

      const efDict = doc.context.obj({
        F: streamRef,
      });

      const fileSpec = doc.context.obj({
        Type: "Filespec",
        F: `doc${i + 1}.txt`,
        EF: efDict,
      });
      const fileSpecRef = doc.context.register(fileSpec);
      fileSpecs.push({ name: `doc${i + 1}.txt`, ref: fileSpecRef });
    }

    // Leaf 1: doc1, doc2
    const leaf1 = doc.context.obj({
      Limits: [PDFString.of(fileSpecs[0].name), PDFString.of(fileSpecs[1].name)],
      Names: [
        PDFString.of(fileSpecs[0].name),
        fileSpecs[0].ref,
        PDFString.of(fileSpecs[1].name),
        fileSpecs[1].ref,
      ],
    });
    const leaf1Ref = doc.context.register(leaf1);

    // Leaf 2: doc3, doc4
    const leaf2 = doc.context.obj({
      Limits: [PDFString.of(fileSpecs[2].name), PDFString.of(fileSpecs[3].name)],
      Names: [
        PDFString.of(fileSpecs[2].name),
        fileSpecs[2].ref,
        PDFString.of(fileSpecs[3].name),
        fileSpecs[3].ref,
      ],
    });
    const leaf2Ref = doc.context.register(leaf2);

    // Root node with Kids
    const rootEf = doc.context.obj({
      Kids: [leaf1Ref, leaf2Ref],
    });
    const rootEfRef = doc.context.register(rootEf);

    // Catalog Names dict as indirect reference
    const namesDict = doc.context.obj({
      EmbeddedFiles: rootEfRef,
    });
    const namesDictRef = doc.context.register(namesDict);

    doc.catalog.set(PDFName.of("Names"), namesDictRef);

    const pdfBytes = await doc.save();
    return { pdfBytes, contents };
  }

  it("walkEmbeddedFiles traverses balanced 2-level name trees with Kids and indirect references", async () => {
    const { pdfBytes } = await createMultiLevelNameTreePdf();
    const doc = await PDFDocument.load(pdfBytes);
    const entries = walkEmbeddedFiles(doc);

    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.name)).toEqual([
      "doc1.txt",
      "doc2.txt",
      "doc3.txt",
      "doc4.txt",
    ]);
  });

  it("listEmbeddedAttachments discovers all items in balanced tree", async () => {
    const { pdfBytes, contents } = await createMultiLevelNameTreePdf();
    const list = await listEmbeddedAttachments(pdfBytes);

    expect(list).toHaveLength(4);
    expect(list[0].name).toBe("doc1.txt");
    expect(list[0].size).toBe(contents[0].length);
    expect(list[3].name).toBe("doc4.txt");
    expect(list[3].size).toBe(contents[3].length);
  });

  it("extractEmbeddedAttachment extracts files across tree partitions", async () => {
    const { pdfBytes, contents } = await createMultiLevelNameTreePdf();

    const data1 = await extractEmbeddedAttachment(pdfBytes, "doc1.txt");
    expect(data1).not.toBeNull();
    expect(new TextDecoder().decode(data1!)).toBe(contents[0]);

    const data3 = await extractEmbeddedAttachment(pdfBytes, "doc3.txt");
    expect(data3).not.toBeNull();
    expect(new TextDecoder().decode(data3!)).toBe(contents[2]);
  });

  it("deleteEmbeddedAttachment removes target file from partition without dropping neighbors", async () => {
    const { pdfBytes, contents } = await createMultiLevelNameTreePdf();

    const updated = await deleteEmbeddedAttachment(pdfBytes, "doc3.txt");
    const list = await listEmbeddedAttachments(updated);

    expect(list).toHaveLength(3);
    expect(list.map((i) => i.name)).toEqual(["doc1.txt", "doc2.txt", "doc4.txt"]);

    const data4 = await extractEmbeddedAttachment(updated, "doc4.txt");
    expect(data4).not.toBeNull();
    expect(new TextDecoder().decode(data4!)).toBe(contents[3]);
  });

  it("deleteEmbeddedAttachment rejects an unknown name instead of reporting success", async () => {
    const { pdfBytes } = await createMultiLevelNameTreePdf();
    await expect(deleteEmbeddedAttachment(pdfBytes, "missing.txt")).rejects.toThrow(
      "Attachment not found",
    );
  });
});

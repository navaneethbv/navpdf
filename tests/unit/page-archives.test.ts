import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, PDFName } from "pdf-lib";
import { createPageArchive } from "../../src/features/pages/page-archives";
import { fixedPageGroups, individualPageGroups } from "../../src/features/pages/page-selection";
import { addStickyNote } from "../../src/services/document-commands";

function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: { name: string; data: Uint8Array }[] = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)),
      data: bytes.slice(start, start + size),
    });
    offset = start + size;
  }
  return entries;
}

async function source() {
  const document = await PDFDocument.create();
  for (let index = 0; index < 5; index++) {
    const page = document.addPage([300 + index, 400]);
    page.setRotation(degrees(index % 2 ? 90 : 0));
    page.drawText(`Page ${index + 1}`);
  }
  return addStickyNote(await document.save(), { page: 2, x: 20, y: 100, contents: "Keep me" });
}

describe("PDF page archives", () => {
  it("round-trips every group in order with rotations and supported annotations", async () => {
    const result = await createPageArchive(await source(), fixedPageGroups(5, 2));
    const entries = readZip(result);
    expect(entries.map((entry) => entry.name)).toEqual([
      "pages-1-2.pdf",
      "pages-3-4.pdf",
      "page-5.pdf",
    ]);
    const documents = await Promise.all(entries.map((entry) => PDFDocument.load(entry.data)));
    expect(documents.map((document) => document.getPageCount())).toEqual([2, 2, 1]);
    expect(
      documents.flatMap((document) => document.getPages().map((page) => page.getWidth())),
    ).toEqual([300, 301, 302, 303, 304]);
    expect(documents[0].getPage(1).getRotation().angle).toBe(90);
    expect(documents[0].getPage(1).node.has(PDFName.of("Annots"))).toBe(true);
  });

  it("exports exactly the chosen individual pages in source order", async () => {
    const entries = readZip(
      await createPageArchive(await source(), individualPageGroups(5, [4, 1])),
    );
    expect(entries.map((entry) => entry.name)).toEqual(["page-2.pdf", "page-5.pdf"]);
    expect((await PDFDocument.load(entries[0].data)).getPage(0).getWidth()).toBe(301);
    expect((await PDFDocument.load(entries[1].data)).getPageCount()).toBe(1);
  });

  it("validates all groups against the actual PDF before exporting", async () => {
    await expect(createPageArchive(await source(), [[0], [5]])).rejects.toThrow(/outside/);
    await expect(createPageArchive(await source(), [])).rejects.toThrow(/Select/);
    await expect(createPageArchive(await source(), [[1, 0]])).rejects.toThrow(/order/);
  });

  it("stops between files when cancelled", async () => {
    const completed: number[] = [];
    await expect(
      createPageArchive(await source(), fixedPageGroups(5, 2), {
        isCancelled: () => completed.length > 0,
        onProgress: (count) => completed.push(count),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(completed).toEqual([1]);
  });
});

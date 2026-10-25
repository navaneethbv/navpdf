import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { tagText, visibleTags } from "../../src/features/document/tag-tree";
import type { TagNode } from "../../src/types/engine";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

function node(id: string, parent: string | null, extra: Partial<TagNode> = {}): TagNode {
  return {
    id,
    parent,
    depth: parent ? 1 : 0,
    role: "P",
    standardRole: null,
    title: "",
    alt: "",
    actualText: "",
    lang: "",
    page: 1,
    mcids: [],
    objects: 0,
    children: 0,
    ...extra,
  };
}

/** A page whose text is marked with MCIDs 1, 11 and 2 the way tagging writers write it. */
async function markedPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const name = page.node.newFontDictionary("F1", font.ref);
  const stream = doc.context.flateStream(
    [1, 11, 2]
      .map(
        (mcid, index) =>
          `/P <</MCID ${mcid}>> BDC BT /${name.asString().slice(1)} 12 Tf 20 ${300 - index * 20} Td (Item ${mcid}) Tj ET EMC`,
      )
      .join("\n"),
  );
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save();
}

describe("tag text and tag filtering", () => {
  it("reads only the text inside a tag's own marked content", async () => {
    const task = getDocument({ data: await markedPdf() });
    const pdf = await task.promise;
    try {
      expect(await tagText(pdf as never, node("5 0", null, { mcids: [1] }))).toBe("Item 1");
      expect(await tagText(pdf as never, node("5 0", null, { mcids: [11, 2] }))).toBe(
        "Item 11 Item 2",
      );
      expect(await tagText(pdf as never, node("5 0", null, { mcids: [] }))).toBe("");
      expect(await tagText(pdf as never, node("5 0", null, { mcids: [1], page: null }))).toBe("");
    } finally {
      await task.destroy();
    }
  });

  it("keeps ancestors of matches and hides children of collapsed tags", () => {
    const nodes = [
      node("1 0", null, { role: "Document" }),
      node("2 0", "1 0", { role: "Sect", title: "Results" }),
      node("3 0", "2 0", { role: "Figure", depth: 2 }),
      node("4 0", "1 0", { role: "P" }),
    ];
    expect(visibleTags(nodes, "figure", new Set()).map((tag) => tag.id)).toEqual([
      "1 0",
      "2 0",
      "3 0",
    ]);
    expect(visibleTags(nodes, "results", new Set()).map((tag) => tag.id)).toEqual(["1 0", "2 0"]);
    expect(visibleTags(nodes, "", new Set(["2 0"])).map((tag) => tag.id)).toEqual([
      "1 0",
      "2 0",
      "4 0",
    ]);
    expect(visibleTags(nodes, "", new Set(["1 0"])).map((tag) => tag.id)).toEqual(["1 0"]);
  });
});

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  loadBookmarks,
  saveBookmarks,
  type EditableBookmark,
} from "../../src/services/pdf/bookmarks";

describe("saved bookmark editing", () => {
  it("creates, renames, nests, reorders and removes bookmarks with independent destinations", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    doc.addPage();
    const original = await doc.save();
    const tree: EditableBookmark[] = [
      {
        id: "a",
        title: "Résumé",
        page: 2,
        children: [{ id: "b", title: "Details", page: 1, children: [] }],
      },
      { id: "c", title: "Start", page: 0, children: [] },
    ];
    const first = await saveBookmarks(original, tree);
    const loaded = await loadBookmarks(first);
    expect(loaded.map((n) => [n.title, n.page])).toEqual([
      ["Résumé", 2],
      ["Start", 0],
    ]);
    loaded[0].title = "Updated résumé";
    loaded[0].children = [];
    loaded.reverse();
    const final = await saveBookmarks(first, loaded);
    const reader = await getDocument({ data: new Uint8Array(final), isEvalSupported: false })
      .promise;
    try {
      const outline = await reader.getOutline();
      expect(outline!.map((n) => n.title)).toEqual(["Start", "Updated résumé"]);
      expect(outline![1].items).toHaveLength(0);
      expect(
        await reader.getPageIndex(
          (outline![1].dest as unknown[])[0] as { num: number; gen: number },
        ),
      ).toBe(2);
    } finally {
      await reader.loadingTask.destroy();
    }
    expect(await loadBookmarks(await saveBookmarks(final, []))).toEqual([]);
  });
  it("rejects invalid page targets and cycles without modifying the source", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    const node: EditableBookmark = { id: "a", title: "A", page: 4, children: [] };
    await expect(saveBookmarks(bytes, [node])).rejects.toThrow("outside");
    node.page = 0;
    node.children = [node];
    await expect(saveBookmarks(bytes, [node])).rejects.toThrow("tree");
    expect(await loadBookmarks(bytes)).toEqual([]);
  });
});

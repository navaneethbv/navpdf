// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { EventBus, PDFLinkService, PDFFindController } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import { positionSearchCursor } from "../../src/features/search/select-result";
GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
it("searches case/whole words and moves to an exact occurrence without breaking Next", async () => {
  const task = getDocument({
    data: new Uint8Array(await readFile("tests/pdf-fixtures/reader-5.pdf")),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const bus = new EventBus(),
    links = new PDFLinkService({ eventBus: bus });
  const viewer = { currentPageNumber: 1, isPageVisible: () => true };
  links.setViewer(viewer);
  links.setDocument(pdf);
  const find = new PDFFindController({ eventBus: bus, linkService: links });
  find.setDocument(pdf);
  const search = (type = "", caseSensitive = false, entireWord = false) =>
    bus.dispatch("find", {
      source: bus,
      type,
      query: "river",
      caseSensitive,
      entireWord,
      highlightAll: true,
      findPrevious: false,
    });
  try {
    search();
    await vi.waitFor(() => expect(find.pageMatches?.[4]).toHaveLength(3));
    expect(find.selected).toEqual({ pageIdx: 0, matchIdx: 0 });
    expect(positionSearchCursor(find, 1, 1)).toBe(true);
    search("again");
    await vi.waitFor(() => expect(find.selected).toEqual({ pageIdx: 0, matchIdx: 1 }));
    search("again");
    await vi.waitFor(() => expect(find.selected).toEqual({ pageIdx: 0, matchIdx: 2 }));
    expect(positionSearchCursor(find, 5, 1)).toBe(true);
    search("again");
    await vi.waitFor(() => expect(find.selected).toEqual({ pageIdx: 4, matchIdx: 1 }));
    search("", true, true);
    await vi.waitFor(() => expect(find.pageMatches?.[4]).toHaveLength(1));
    expect(positionSearchCursor(find, 99, 0)).toBe(false);
  } finally {
    find.setDocument(null);
    await task.destroy();
  }
});

import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { EditableBookmark } from "../../src/services/pdf/bookmarks";
import { loadBookmarks, saveBookmarks } from "../../src/services/pdf/bookmarks";
import {
  bookmarksForDocument,
  clearBookmarkClipboard,
  exportBookmarksJson,
  getBookmarkClipboard,
  parseBookmarksJson,
  setBookmarkClipboard,
} from "../../src/features/bookmarks/bookmark-transfer";
import { scanTextStyles, styleBookmarks } from "../../src/features/bookmarks/style-bookmarks";
import { importCommentsFromPdf } from "../../src/services/pdf/comment-batch";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

const tree: EditableBookmark[] = [
  {
    id: "a",
    title: "Chapter 1",
    page: 0,
    view: ["XYZ", null, 700, null],
    color: [1, 0, 0],
    flags: 3,
    children: [{ id: "a1", title: "Section 1.1", page: 4, children: [] }],
  },
  { id: "b", title: "Appendix", page: null, collapsed: true, children: [] },
];

describe("Bookmark clipboard", () => {
  it("copies a subtree with new identifiers and drops pages the target lacks", () => {
    clearBookmarkClipboard();
    setBookmarkClipboard([tree[0]]);
    const clip = getBookmarkClipboard()!;
    expect(clip[0].id).not.toBe("a");
    expect(clip[0].children[0].title).toBe("Section 1.1");
    const { nodes, unplaced } = bookmarksForDocument(clip, 3);
    expect(unplaced).toBe(1);
    expect(nodes[0].page).toBe(0);
    expect(nodes[0].children[0]).toMatchObject({ page: null, view: undefined });
    // Each paste gets identifiers of its own.
    expect(bookmarksForDocument(clip, 3).nodes[0].id).not.toBe(nodes[0].id);
    expect(() => setBookmarkClipboard([])).toThrow();
  });
});

describe("Bookmark JSON", () => {
  it("round-trips titles, nesting, open state, colour, style and views", async () => {
    const json = exportBookmarksJson(tree);
    const parsed = JSON.parse(json);
    expect(parsed.bookmarks[0]).toMatchObject({
      title: "Chapter 1",
      page: 1,
      bold: true,
      italic: true,
      open: true,
      color: [1, 0, 0],
    });
    const back = parseBookmarksJson(json);
    expect(back[0]).toMatchObject({
      title: "Chapter 1",
      page: 0,
      view: ["XYZ", null, 700, null],
      flags: 3,
      color: [1, 0, 0],
    });
    expect(back[0].children[0]).toMatchObject({ title: "Section 1.1", page: 4 });
    expect(back[1]).toMatchObject({ title: "Appendix", page: null });
    // The imported tree saves into a PDF and reads back the same.
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) doc.addPage();
    const saved = await loadBookmarks(await saveBookmarks(await doc.save(), back));
    expect(saved.map((node) => node.title)).toEqual(["Chapter 1", "Appendix"]);
    expect(saved[0]).toMatchObject({ page: 0, flags: 3 });
  });

  it("rejects files that are not NavPDF bookmark exports or are malformed", () => {
    expect(() => parseBookmarksJson("{")).toThrow(/not JSON/);
    expect(() => parseBookmarksJson('{"bookmarks":[]}')).toThrow(/exported/);
    const file = (bookmarks: unknown) =>
      JSON.stringify({ format: "navpdf-bookmarks", version: 1, bookmarks });
    expect(() => parseBookmarksJson(file([{ title: "", page: 1 }]))).toThrow(/title/);
    expect(() => parseBookmarksJson(file([{ title: "x", page: 0 }]))).toThrow(/pages/);
    expect(() => parseBookmarksJson(file([{ title: "x", page: 1, view: ["Run"] }]))).toThrow(
      /view/,
    );
    expect(() => parseBookmarksJson(file([{ title: "x", page: 1, color: [2, 0, 0] }]))).toThrow(
      /colour/,
    );
    let deep: unknown = { title: "x", page: 1 };
    for (let i = 0; i < 40; i++) deep = { title: "x", page: 1, children: [deep] };
    expect(() => parseBookmarksJson(file([deep]))).toThrow(/nest/);
  });
});

async function styledDocument() {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lines: [string, number, typeof bold][] = [
    ["Introduction", 20, bold],
    ["Body text one", 10, helvetica],
    ["Background", 14, bold],
    ["Body text two", 10, helvetica],
  ];
  for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
    const page = doc.addPage([600, 800]);
    lines.forEach(([text, size, font], index) =>
      page.drawText(`${text}${pageIndex ? " again" : ""}`, {
        x: 50,
        y: 700 - index * 40,
        size,
        font,
      }),
    );
  }
  return doc.save();
}

describe("Bookmarks from text styles", () => {
  it("lists the document's styles largest first and nests chosen styles by level", async () => {
    const pdf = await getDocument({
      data: await styledDocument(),
      standardFontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
      useSystemFonts: false,
      fontExtraProperties: true,
    }).promise;
    const { styles, lines } = await scanTextStyles(pdf as never);
    expect(styles.map((style) => [style.size, style.bold, style.lines])).toEqual([
      [20, true, 2],
      [14, true, 2],
      [10, false, 4],
    ]);
    expect(styles[0].fontName).toMatch(/Helvetica/);
    const bookmarks = styleBookmarks(lines, [styles[0].key, styles[1].key]);
    expect(bookmarks.map((node) => node.title)).toEqual(["Introduction", "Introduction again"]);
    expect(bookmarks[0].children.map((node) => node.title)).toEqual(["Background"]);
    expect(bookmarks[1]).toMatchObject({ page: 1 });
    expect(bookmarks[0].view?.[0]).toBe("XYZ");
    expect(() => styleBookmarks(lines, [styles[0].key, styles[0].key])).toThrow(/different/);
    await pdf.cleanup();
  });
});

describe("Importing comments from another PDF", () => {
  async function withComments(pages: number, comments: [number, Record<string, unknown>][]) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([600, 800]);
    for (const [index, entries] of comments) {
      const page = doc.getPage(index);
      const ref = doc.context.register(
        doc.context.obj({ Type: "Annot", P: page.ref, ...entries } as never),
      );
      page.node.addAnnot(ref);
    }
    return doc;
  }

  it("copies comments with replies to the same pages and replaces same-named ones", async () => {
    const source = await withComments(3, [
      [
        0,
        {
          Subtype: "Square",
          NM: PDFString.of("shared"),
          Rect: [10, 10, 50, 50],
          Contents: PDFString.of("new"),
        },
      ],
      [1, { Subtype: "Redact", NM: PDFString.of("r"), Rect: [0, 0, 5, 5] }],
      [1, { Subtype: "Link", Rect: [0, 0, 5, 5] }],
      [2, { Subtype: "Text", NM: PDFString.of("late"), Rect: [0, 0, 5, 5] }],
    ]);
    const square = source.getPage(0).node.Annots()!.get(0);
    const reply = source.context.register(
      source.context.obj({
        Type: "Annot",
        Subtype: "Text",
        IRT: square,
        NM: PDFString.of("reply"),
        Rect: [10, 10, 20, 20],
      } as never),
    );
    source.getPage(0).node.addAnnot(reply);
    const target = await withComments(2, [
      [
        0,
        {
          Subtype: "Square",
          NM: PDFString.of("shared"),
          Rect: [0, 0, 9, 9],
          Contents: PDFString.of("old"),
        },
      ],
      [0, { Subtype: "Circle", NM: PDFString.of("mine"), Rect: [0, 0, 9, 9] }],
    ]);
    const result = await importCommentsFromPdf(await target.save(), await source.save());
    expect(result).toMatchObject({ imported: 1, outside: 1, redactions: 1 });
    const doc = await PDFDocument.load(result.bytes);
    const annots = doc
      .getPage(0)
      .node.Annots()!
      .asArray()
      .map((ref) => doc.context.lookup(ref, PDFDict));
    const names = annots.map((dict) => dict.lookup(PDFName.of("NM"), PDFString).decodeText());
    expect(names.sort()).toEqual(["mine", "reply", "shared"]);
    const shared = annots.find(
      (dict) => dict.lookup(PDFName.of("NM"), PDFString).decodeText() === "shared",
    )!;
    expect(shared.lookup(PDFName.of("Contents"), PDFString).decodeText()).toBe("new");
    expect(shared.get(PDFName.of("P"))).toEqual(doc.getPage(0).ref);
    const copiedReply = annots.find((dict) => dict.has(PDFName.of("IRT")))!;
    expect(copiedReply.get(PDFName.of("IRT"))).toEqual(
      doc
        .getPage(0)
        .node.Annots()!
        .asArray()
        .find((ref) => doc.context.lookup(ref) === shared),
    );
    expect(doc.getPage(1).node.Annots()).toBeUndefined();
    expect(doc.getPageCount()).toBe(2);
  });

  it("refuses PDFs without comments and files that are not PDFs", async () => {
    const empty = await withComments(1, []);
    const target = await withComments(1, []);
    await expect(importCommentsFromPdf(await target.save(), await empty.save())).rejects.toThrow(
      /no comments/,
    );
    await expect(
      importCommentsFromPdf(await target.save(), new TextEncoder().encode("not a pdf")),
    ).rejects.toThrow(/valid PDF/);
  });
});

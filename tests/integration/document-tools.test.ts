import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { addStamp } from "../../src/services/pdf/stamps";
import { flattenDocument, placementMatrix } from "../../src/services/pdf/flatten";
import { bookletOrder, imposePages } from "../../src/services/pdf/impose";
import {
  collectComments,
  commentSummaryCsv,
  commentSummaryHtml,
  parsePdfDate,
} from "../../src/features/annotations/comment-summary";
import {
  previewLabels,
  readPageLabelsFromBytes,
  setPageLabels,
  validateRanges,
  type PageLabelRange,
} from "../../src/services/pdf/page-labels";
import {
  addFormField,
  addLinkAnnotation,
  addReply,
  addShapeAnnotation,
  addStickyNote,
  addTextMarkupAnnotations,
  setReviewState,
  updateFormField,
} from "../../src/services/document-commands";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function reopen(bytes: Uint8Array) {
  return getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
    useSystemFonts: false,
  }).promise;
}

async function pages(...sizes: { size?: [number, number]; rotation?: number }[]) {
  const doc = await PDFDocument.create();
  for (const { size = [612, 792], rotation = 0 } of sizes)
    doc.addPage(size).setRotation(degrees(rotation));
  return doc.save();
}

function annotationDicts(doc: PDFDocument, pageIndex: number) {
  const annots = doc.getPage(pageIndex).node.Annots();
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref, PDFDict));
}

function numbers(dict: PDFDict, key: string) {
  return dict
    .lookup(PDFName.of(key), PDFArray)
    .asArray()
    .map((value) => (value as PDFNumber).asNumber());
}

describe("stamps", () => {
  it("adds standard and custom stamps with appearances that PDF.js reads", async () => {
    let bytes = await pages({});
    bytes = await addStamp(bytes, {
      page: 1,
      stamp: "Approved",
      detail: "A. Reviewer, 2026-10-06",
      position: "top-right",
      author: "A. Reviewer",
    });
    bytes = await addStamp(bytes, {
      page: 1,
      stamp: "Custom",
      label: "paid in full",
      tone: "green",
      position: "bottom-left",
    });

    const saved = await PDFDocument.load(bytes);
    const [approved, custom] = annotationDicts(saved, 0);
    expect(approved.get(PDFName.of("Name"))).toEqual(PDFName.of("Approved"));
    expect(custom.get(PDFName.of("Name"))).toEqual(PDFName.of("NavPDFCustom"));
    const rect = numbers(approved, "Rect");
    // Top-right placement keeps a 24 point margin from the page edges.
    expect(rect[2]).toBeCloseTo(612 - 24, 3);
    expect(rect[3]).toBeCloseTo(792 - 24, 3);
    const appearance = approved.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N"));
    expect(appearance).toBeDefined();

    const pdf = await reopen(bytes);
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    expect(annotations.map((item) => item.subtype)).toEqual(["Stamp", "Stamp"]);
    expect(annotations.every((item) => item.hasAppearance)).toBe(true);
    expect(annotations[0].contentsObj.str).toBe("APPROVED\nA. Reviewer, 2026-10-06");
    expect(annotations[1].contentsObj.str).toBe("PAID IN FULL");
    expect(annotations[0].titleObj.str).toBe("A. Reviewer");
  });

  it("counter-rotates the appearance so stamps read upright on rotated pages", async () => {
    const bytes = await addStamp(await pages({ rotation: 90 }), {
      page: 1,
      stamp: "Draft",
      position: "top-left",
      width: 200,
    });
    const saved = await PDFDocument.load(bytes);
    const [stamp] = annotationDicts(saved, 0);
    const appearance = saved.context.lookup(
      stamp.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N")),
    ) as unknown as { dict: PDFDict };
    expect(numbers(appearance.dict, "Matrix")).toEqual([0, 1, -1, 0, 0, 0]);
    const [x1, y1, x2, y2] = numbers(stamp, "Rect");
    // The displayed top-left corner of a page rotated 90 degrees is the user-space origin.
    expect([x1, y1]).toEqual([24, 24]);
    // A 200 point wide stamp spans user-space height on a quarter-turned page.
    expect(y2 - y1).toBeCloseTo(200, 3);
    expect(x2 - x1).toBeLessThan(80);
  });

  it("rejects pages outside the document, empty custom text and unsupported characters", async () => {
    const bytes = await pages({});
    await expect(addStamp(bytes, { page: 2, stamp: "Final", position: "center" })).rejects.toThrow(
      /outside the document/,
    );
    await expect(
      addStamp(bytes, { page: 1, stamp: "Custom", label: "  ", position: "center" }),
    ).rejects.toThrow(/Enter the text/);
    await expect(
      addStamp(bytes, { page: 1, stamp: "Custom", label: "承認", position: "center" }),
    ).rejects.toThrow(/built-in fonts/);
    await expect(
      addStamp(bytes, { page: 1, stamp: "Final", detail: "x".repeat(81), position: "center" }),
    ).rejects.toThrow(/80 characters/);
  });
});

describe("flattening", () => {
  async function markedUpForm() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([612, 792]).drawText("Body text", { x: 72, y: 700, size: 12, font });
    doc.addPage([612, 792]);
    let bytes = await doc.save();
    bytes = await addTextMarkupAnnotations(bytes, "Highlight", [
      { page: 1, quads: [{ x1: 70, y1: 696, x2: 140, y2: 712 }], opacity: 0.5 },
    ]);
    bytes = await addShapeAnnotation(bytes, {
      page: 1,
      kind: "Square",
      start: [100, 300],
      end: [200, 360],
    });
    bytes = await addStickyNote(bytes, { page: 1, x: 500, y: 700, contents: "Review" });
    bytes = await addLinkAnnotation(bytes, {
      page: 1,
      rect: [72, 100, 200, 120],
      target: { type: "page", page: 2 },
    });
    bytes = await addStamp(bytes, { page: 2, stamp: "Final", position: "center" });
    bytes = await addFormField(bytes, {
      type: "text",
      name: "Reviewer",
      page: 1,
      x: 72,
      y: 600,
      width: 200,
      height: 24,
    });
    return updateFormField(bytes, { name: "Reviewer", value: "Flattened Value" });
  }

  async function pageText(pdf: Awaited<ReturnType<typeof reopen>>, number: number) {
    const content = await (await pdf.getPage(number)).getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  }

  it("draws comments, stamps and field values into the page and keeps links", async () => {
    const { bytes, report } = await flattenDocument(await markedUpForm(), {
      annotations: true,
      forms: true,
    });
    expect(report).toEqual({ annotations: 4, widgets: 1, skipped: 0 });

    const pdf = await reopen(bytes);
    const first = await (await pdf.getPage(1)).getAnnotations();
    expect(first.map((item) => item.subtype)).toEqual(["Link"]);
    expect(await (await pdf.getPage(2)).getAnnotations()).toEqual([]);
    expect(await pdf.getFieldObjects()).toBeNull();
    expect(await pageText(pdf, 1)).toContain("Flattened Value");
    expect(await pageText(pdf, 2)).toContain("FINAL");
    expect((await PDFDocument.load(bytes)).catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("flattens only the chosen kind of object", async () => {
    const source = await markedUpForm();
    const formsOnly = await flattenDocument(source, { annotations: false, forms: true });
    expect(formsOnly.report.widgets).toBe(1);
    const pdf = await reopen(formsOnly.bytes);
    const kept = (await (await pdf.getPage(1)).getAnnotations()).map((item) => item.subtype);
    expect(new Set(kept)).toEqual(new Set(["Highlight", "Square", "Text", "Popup", "Link"]));

    const commentsOnly = await flattenDocument(source, { annotations: true, forms: false });
    expect(commentsOnly.report).toMatchObject({ annotations: 4, widgets: 0 });
    expect(await (await reopen(commentsOnly.bytes)).getFieldObjects()).not.toBeNull();
  });

  it("places transformed appearances inside the annotation rectangle", () => {
    expect(placementMatrix([0, 0, 100, 50], [1, 0, 0, 1, 0, 0], [10, 20, 110, 70])).toEqual([
      1, 0, 0, 1, 10, 20,
    ]);
    // A quarter-turned appearance's transformed box is 50 wide and 100 high.
    expect(placementMatrix([0, 0, 100, 50], [0, 1, -1, 0, 0, 0], [0, 0, 50, 100])).toEqual([
      1, 0, 0, 1, 50, 0,
    ]);
    expect(placementMatrix([0, 0, 0, 10], [1, 0, 0, 1, 0, 0], [0, 0, 10, 10])).toBeNull();
  });

  it("refuses signed documents and requests with nothing to flatten", async () => {
    await expect(
      flattenDocument(await pages({}), { annotations: true, forms: true }),
    ).rejects.toThrow(/nothing to flatten/);
    await expect(
      flattenDocument(await pages({}), { annotations: false, forms: false }),
    ).rejects.toThrow(/Choose what/);

    const doc = await PDFDocument.create();
    doc.addPage();
    const form = doc.getForm();
    form.createTextField("placeholder").addToPage(doc.getPage(0), { x: 10, y: 10 });
    const signature = doc.context.obj({ FT: "Sig", T: "Signature1", V: doc.context.obj({}) });
    form.acroForm.addField(doc.context.register(signature));
    await expect(
      flattenDocument(await doc.save(), { annotations: false, forms: true }),
    ).rejects.toThrow(/digitally signed/);
  });
});

describe("page labels", () => {
  const front: PageLabelRange[] = [
    { startPage: 1, style: "roman-lower", prefix: "", firstNumber: 1 },
    { startPage: 4, style: "decimal", prefix: "", firstNumber: 1 },
    { startPage: 7, style: "letters-upper", prefix: "App-", firstNumber: 1 },
    { startPage: 9, style: "none", prefix: "Back cover", firstNumber: 1 },
  ];

  it("writes labels that PDF.js reads back and round-trips the ranges", async () => {
    const source = await pages(...Array.from({ length: 9 }, () => ({})));
    const labeled = await setPageLabels(source, front);
    const pdf = await reopen(labeled);
    expect(await pdf.getPageLabels()).toEqual([
      "i",
      "ii",
      "iii",
      "1",
      "2",
      "3",
      "App-A",
      "App-B",
      "Back cover",
    ]);
    expect(previewLabels(front, 9)).toEqual(await pdf.getPageLabels());
    expect((await readPageLabelsFromBytes(labeled)).ranges).toEqual(front);

    const plain = await setPageLabels(labeled, []);
    expect(await (await reopen(plain)).getPageLabels()).toBeNull();
  });

  it("formats large roman numerals, repeated letters and starting offsets", () => {
    const ranges: PageLabelRange[] = [
      { startPage: 1, style: "roman-upper", prefix: "", firstNumber: 1994 },
      { startPage: 2, style: "letters-lower", prefix: "", firstNumber: 27 },
      { startPage: 3, style: "decimal", prefix: "S-", firstNumber: 99 },
    ];
    expect(previewLabels(ranges, 4)).toEqual(["MCMXCIV", "aa", "S-99", "S-100"]);
  });

  it("rejects ranges that do not describe the document", () => {
    const range = (startPage: number, extra: Partial<PageLabelRange> = {}): PageLabelRange => ({
      startPage,
      style: "decimal",
      prefix: "",
      firstNumber: 1,
      ...extra,
    });
    expect(() => validateRanges([range(2)], 5)).toThrow(/must start on page 1/);
    expect(() => validateRanges([range(1), range(1)], 5)).toThrow(/Two label ranges/);
    expect(() => validateRanges([range(1), range(6)], 5)).toThrow(/between page 1 and page 5/);
    expect(() => validateRanges([range(1, { firstNumber: 0 })], 5)).toThrow(/whole number/);
    expect(() => validateRanges([range(1, { style: "none" })], 5)).toThrow(/prefix or a style/);
    expect(validateRanges([range(3), range(1)], 5).map((item) => item.startPage)).toEqual([1, 3]);
  });
});

describe("imposition", () => {
  async function numbered(count: number, rotateSecond = false) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let index = 1; index <= count; index++) {
      const page = doc.addPage([612, 792]);
      page.drawText(`Page${index}`, { x: 250, y: 400, size: 40, font });
      if (rotateSecond && index === 2) page.setRotation(degrees(90));
    }
    return doc.save();
  }

  async function sheetText(bytes: Uint8Array) {
    const pdf = await reopen(bytes);
    const sheets: { size: number[]; words: { text: string; x: number; y: number }[] }[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      sheets.push({
        size: [Math.round(width), Math.round(height)],
        words: content.items.flatMap((item) =>
          "str" in item && item.str.trim()
            ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }]
            : [],
        ),
      });
    }
    return sheets;
  }

  const base = { sheet: "letter", orientation: "auto", margin: 18, gap: 9, border: false } as const;

  it("places four pages per portrait sheet in reading order", async () => {
    const { bytes, sheets } = await imposePages(await numbered(6), { ...base, layout: "4" });
    expect(sheets).toBe(2);
    const read = await sheetText(bytes);
    expect(read.map((sheet) => sheet.size)).toEqual([
      [612, 792],
      [612, 792],
    ]);
    const [first] = read;
    const at = (text: string) => first.words.find((word) => word.text === text)!;
    expect(at("Page1").x).toBeLessThan(at("Page2").x);
    expect(at("Page1").y).toBeGreaterThan(at("Page3").y);
    expect(read[1].words.map((word) => word.text)).toEqual(["Page5", "Page6"]);
  });

  it("uses landscape sheets for two-up and keeps rotated pages upright", async () => {
    const { bytes } = await imposePages(await numbered(2, true), { ...base, layout: "2" });
    const [sheet] = await sheetText(bytes);
    expect(sheet.size).toEqual([792, 612]);
    const rotated = (
      await (await reopen(bytes)).getPage(1).then((page) => page.getTextContent())
    ).items.find((item) => "str" in item && item.str === "Page2") as { transform: number[] };
    // The second page is displayed turned 90 degrees, so its text runs downward on the sheet.
    expect(rotated.transform[1]).toBeLessThan(0);
  });

  it("orders booklet sides for saddle stitching with blank padding", async () => {
    expect(bookletOrder(6)).toEqual([
      [null, 0],
      [1, null],
      [5, 2],
      [3, 4],
    ]);
    const { bytes, sheets } = await imposePages(await numbered(6), { ...base, layout: "booklet" });
    expect(sheets).toBe(4);
    const read = await sheetText(bytes);
    const order = read.map((sheet) =>
      [...sheet.words].sort((a, b) => a.x - b.x).map((word) => word.text),
    );
    expect(order).toEqual([["Page1"], ["Page2"], ["Page6", "Page3"], ["Page4", "Page5"]]);
  });

  it("imposes blank pages that have no content stream", async () => {
    const { sheets } = await imposePages(await pages({}, {}, {}), { ...base, layout: "2" });
    expect(sheets).toBe(2);
  });

  it("imposes only chosen pages and rejects impossible settings", async () => {
    const source = await numbered(5);
    const { bytes } = await imposePages(source, { ...base, layout: "9", pages: [5, 1] });
    expect((await sheetText(bytes))[0].words.map((word) => word.text)).toEqual(["Page5", "Page1"]);
    await expect(imposePages(source, { ...base, layout: "4", pages: [6] })).rejects.toThrow(
      /outside the document/,
    );
    await expect(imposePages(source, { ...base, layout: "16", margin: 300 })).rejects.toThrow(
      /no room/,
    );
  });
});

describe("comment summaries", () => {
  async function reviewed() {
    let bytes = await setPageLabels(await pages({}, {}), [
      { startPage: 1, style: "roman-lower", prefix: "", firstNumber: 1 },
    ]);
    bytes = await addStickyNote(bytes, {
      page: 2,
      x: 100,
      y: 700,
      contents: "Check the <total>, please",
      author: "Ana",
      id: "note-2",
    });
    bytes = await addStickyNote(bytes, {
      page: 1,
      x: 100,
      y: 700,
      contents: "Intro reads well",
      author: "Ben",
      id: "note-1",
    });
    bytes = await addReply(bytes, { parentId: "note-2", contents: "Fixed", author: "Ben" });
    bytes = await setReviewState(bytes, "note-2", "Accepted");
    return addStamp(bytes, { page: 1, stamp: "Approved", position: "center", author: "Ana" });
  }

  it("threads replies, applies review status and labels pages", async () => {
    const entries = collectComments(await PDFDocument.load(await reviewed()));
    expect(entries.map((entry) => [entry.pageLabel, entry.type, entry.author])).toEqual([
      ["i", "Note", "Ben"],
      ["i", "Stamp", "Ana"],
      ["ii", "Note", "Ana"],
    ]);
    const note = entries[2];
    expect(note.status).toBe("Accepted");
    expect(note.replies.map((reply) => [reply.author, reply.text])).toEqual([["Ben", "Fixed"]]);
    expect(note.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const byAuthor = collectComments(await PDFDocument.load(await reviewed()), "author");
    expect(byAuthor.map((entry) => entry.author)).toEqual(["Ana", "Ana", "Ben"]);
  });

  it("writes escaped HTML and CSV that keep threads and status", async () => {
    const entries = collectComments(await PDFDocument.load(await reviewed()));
    const html = commentSummaryHtml(entries, "report <draft>");
    expect(html).toContain("<title>Comments: report &lt;draft&gt;</title>");
    expect(html).toContain("<h2>Page ii</h2>");
    expect(html).toContain("Check the &lt;total&gt;, please");
    expect(html).toContain("Status: Accepted");
    expect(html).toContain('<div class="replies">');
    expect(html).not.toContain("<total>");

    const csv = commentSummaryCsv(entries).slice(1).split("\r\n");
    expect(csv[0]).toBe("Page,Type,Author,Modified,Status,In reply to,Text");
    expect(csv.at(-2)).toMatch(/^ii,Reply,Ben,.*,,note-2,Fixed$/);
    expect(csv.some((line) => line.includes('"Check the <total>, please"'))).toBe(true);
  });

  it("parses PDF dates with offsets and rejects malformed ones", () => {
    expect(parsePdfDate("D:20261006093000+02'00'")).toBe("2026-10-06T07:30:00.000Z");
    expect(parsePdfDate("D:2026")).toBe("2026-01-01T00:00:00.000Z");
    expect(parsePdfDate("D:20261306")).toBe("");
    expect(parsePdfDate("yesterday")).toBe("");
  });
});

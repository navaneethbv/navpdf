import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  addUrlLinks,
  findUrls,
  inspectLinks,
  removeLinks,
} from "../../src/services/pdf/link-tools";
import { findUrlLinks } from "../../src/features/editor/url-links";
import { detectHeadings, headingBookmarks } from "../../src/features/bookmarks/heading-bookmarks";
import { loadBookmarks, saveBookmarks } from "../../src/services/pdf/bookmarks";
import {
  arrangeWidgets,
  arrangedGeometry,
  readWidgets,
  type WidgetGeometry,
} from "../../src/services/pdf/field-geometry";
import { addMeasurement, ACTUAL_SIZE } from "../../src/services/pdf/measure";
import {
  measurementsCsv,
  readMeasurements,
} from "../../src/features/annotations/measurement-export";
import { auditSpace } from "../../src/services/pdf/space-audit";
import { mergeFormDataCsv, readFormData } from "../../src/services/pdf/form-data";
import { compareReportPdf } from "../../src/features/compare/compare-report";
import { parseWordList } from "../../src/features/redact/word-list";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
const standardFontDataUrl = `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`;

async function withPdf<T>(bytes: Uint8Array, use: (pdf: PDFDocumentProxy) => Promise<T>) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  const pdf = await task.promise;
  try {
    return await use(pdf);
  } finally {
    await task.destroy();
  }
}

async function pageText(bytes: Uint8Array) {
  return withPdf(bytes, async (pdf) => {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push(content.items.map((item: { str?: string }) => item.str ?? "").join(" "));
    }
    return pages;
  });
}

async function linkFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([400, 400]);
  const second = doc.addPage([400, 400]);
  first.drawText("Visit https://example.com/docs. today", { x: 40, y: 300, size: 12, font });
  first.drawText("or www.example.org and javascript:alert(1)", { x: 40, y: 260, size: 12, font });
  const internal = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [40, 40, 100, 60],
    Dest: [second.ref, "Fit"],
  });
  const broken = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [40, 80, 100, 100],
    Dest: PDFName.of("missing"),
  });
  first.node.addAnnot(doc.context.register(internal));
  first.node.addAnnot(doc.context.register(broken));
  const bytes = await saveBookmarks(await doc.save(), [
    { id: "a", title: "Second page", page: 1, children: [] },
  ]);
  // Point the bookmark at a page that no longer exists, as after careless page removal.
  const damaged = await PDFDocument.load(bytes);
  const outlines = damaged.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  const node = outlines.lookup(PDFName.of("First"), PDFDict);
  node.set(PDFName.of("Dest"), damaged.context.obj([PDFName.of("Gone"), "Fit"]));
  return damaged.save();
}

describe("link tools", () => {
  it("finds only safe web addresses and trims sentence punctuation", () => {
    expect(findUrls("See https://example.com/a_(b)). Or www.test.org, then http://x")).toEqual([
      { start: 4, end: 29, url: "https://example.com/a_(b)" },
      { start: 35, end: 47, url: "https://www.test.org/" },
    ]);
    expect(findUrls("javascript:alert(1) file:///etc/passwd")).toEqual([]);
  });

  it("inventories and removes broken links while keeping bookmark titles", async () => {
    const bytes = await linkFixture();
    expect(await inspectLinks(bytes)).toMatchObject({
      total: 2,
      internal: 1,
      broken: 1,
      brokenBookmarks: 1,
    });
    const result = await removeLinks(bytes, "broken");
    expect(result).toMatchObject({ removedLinks: 1, clearedBookmarks: 1 });
    expect(await inspectLinks(result.bytes)).toMatchObject({
      total: 1,
      broken: 0,
      brokenBookmarks: 0,
    });
    expect((await loadBookmarks(result.bytes)).map((entry) => entry.title)).toEqual([
      "Second page",
    ]);
    const none = await removeLinks(result.bytes, "all");
    expect(none.removedLinks).toBe(1);
    await expect(removeLinks(none.bytes, "all")).rejects.toThrow("no links");
  });

  it("links addresses found by PDF.js once and an independent reader sees URI links", async () => {
    const bytes = await linkFixture();
    const found = await withPdf(bytes, (pdf) => findUrlLinks(pdf));
    expect(found.map((entry) => entry.url)).toEqual([
      "https://example.com/docs",
      "https://www.example.org/",
    ]);
    const first = await addUrlLinks(bytes, found);
    expect(first.added).toBe(2);
    await expect(addUrlLinks(first.bytes, found)).rejects.toThrow("already has a link");
    const annotations = await withPdf(first.bytes, async (pdf) =>
      (await pdf.getPage(1)).getAnnotations(),
    );
    const urls = annotations.filter((item: { url?: string }) => item.url);
    expect(urls.map((item: { url: string }) => item.url).sort()).toEqual([
      "https://example.com/docs",
      "https://www.example.org/",
    ]);
    const [docsLink] = urls.filter((item: { url: string }) => item.url.includes("docs"));
    // The link covers the address, which starts after "Visit " on the 300 pt baseline.
    expect(docsLink.rect[0]).toBeGreaterThan(60);
    expect(docsLink.rect[1]).toBeLessThan(300);
    expect(docsLink.rect[3]).toBeGreaterThan(300);
  });
});

async function headingFixture(rotation = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const body = "Body text that is set at the regular size for reading.";
  const lines: [string, number][][] = [
    [
      ["Introduction", 24],
      [body, 11],
      ["Scope and Goals", 16],
      [body, 11],
    ],
    [
      ["Methods", 24],
      ["Data", 16],
      [body, 11],
      [body, 11],
    ],
  ];
  for (const content of lines) {
    const page = doc.addPage([500, 500]);
    page.setRotation(degrees(rotation));
    let y = 450;
    for (const [text, size] of content) {
      page.drawText(text, { x: 40, y, size, font });
      y -= size * 2;
    }
  }
  return doc.save();
}

describe("bookmarks from headings", () => {
  it("nests detected headings and saves bookmarks PDF.js reads", async () => {
    const bytes = await headingFixture();
    const headings = await withPdf(bytes, (pdf) => detectHeadings(pdf, 2));
    expect(headings.map(({ title, level, page }) => [title, level, page])).toEqual([
      ["Introduction", 1, 1],
      ["Scope and Goals", 2, 1],
      ["Methods", 1, 2],
      ["Data", 2, 2],
    ]);
    expect(headings[0].top).toBeGreaterThan(450);
    const saved = await saveBookmarks(bytes, headingBookmarks(headings));
    const outline = await withPdf(saved, (pdf) => pdf.getOutline());
    expect(outline.map((item: { title: string }) => item.title)).toEqual([
      "Introduction",
      "Methods",
    ]);
    expect(outline[1].items.map((item: { title: string }) => item.title)).toEqual(["Data"]);
    const reread = await loadBookmarks(saved);
    expect(reread[1]).toMatchObject({ page: 1, view: ["XYZ", null, expect.any(Number), null] });
  });

  it("limits levels, uses fit views on rotated pages and rejects bad input", async () => {
    const bytes = await headingFixture(90);
    const headings = await withPdf(bytes, (pdf) => detectHeadings(pdf, 1));
    expect(headings.map((heading) => heading.title)).toEqual(["Introduction", "Methods"]);
    expect(headingBookmarks(headings)[0].view).toEqual(["Fit"]);
    await expect(withPdf(bytes, (pdf) => detectHeadings(pdf, 0))).rejects.toThrow("heading levels");
    const abort = new AbortController();
    abort.abort();
    await expect(
      withPdf(bytes, (pdf) => detectHeadings(pdf, 2, { signal: abort.signal })),
    ).rejects.toThrow("cancelled");
  });
});

describe("arranging form fields", () => {
  const widget = (
    field: string,
    x: number,
    y: number,
    width = 50,
    height = 20,
  ): WidgetGeometry => ({
    field,
    widget: 0,
    page: 1,
    x,
    y,
    width,
    height,
  });

  it("computes alignment, distribution and matching from the anchor", () => {
    const items = [widget("a", 10, 10, 100, 30), widget("b", 60, 50), widget("c", 200, 120)];
    expect(arrangedGeometry(items, "left").map((item) => item.x)).toEqual([10, 10, 10]);
    expect(arrangedGeometry(items, "right").map((item) => item.x)).toEqual([10, 60, 60]);
    expect(arrangedGeometry(items, "center-vertical").map((item) => item.y)).toEqual([10, 15, 15]);
    expect(arrangedGeometry(items, "match-size").map((item) => item.width)).toEqual([
      100, 100, 100,
    ]);
    const spread = arrangedGeometry(items, "distribute-horizontal");
    // Span 10 to 250 holds 200 points of fields, leaving two 20-point gaps.
    expect(spread.map((item) => item.x)).toEqual([10, 130, 200]);
  });

  it("arranges real widgets in one edit and rejects mixed pages", async () => {
    const doc = await PDFDocument.create();
    const form = doc.getForm();
    const page = doc.addPage([400, 400]);
    const other = doc.addPage([400, 400]);
    form.createTextField("anchor").addToPage(page, { x: 50, y: 300, width: 120, height: 24 });
    form.createTextField("second").addToPage(page, { x: 90, y: 200, width: 60, height: 20 });
    form.createTextField("elsewhere").addToPage(other, { x: 90, y: 200, width: 60, height: 20 });
    const bytes = await doc.save();
    const before = await readWidgets(bytes);
    const result = await arrangeWidgets(
      bytes,
      [
        { field: "anchor", widget: 0 },
        { field: "second", widget: 0 },
      ],
      "match-width",
    );
    const after = await readWidgets(result.bytes);
    const anchor = before.find((item) => item.field === "anchor")!;
    const moved = before.find((item) => item.field === "second")!;
    expect(after.find((item) => item.field === "second")).toMatchObject({
      width: anchor.width,
      x: moved.x,
      height: moved.height,
    });
    await expect(
      arrangeWidgets(
        bytes,
        [
          { field: "anchor", widget: 0 },
          { field: "elsewhere", widget: 0 },
        ],
        "left",
      ),
    ).rejects.toThrow("same page");
    await expect(arrangeWidgets(bytes, [{ field: "anchor", widget: 0 }], "left")).rejects.toThrow(
      "at least 2",
    );
  });
});

describe("measurement export", () => {
  it("lists saved measurements with neutralised spreadsheet cells", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const first = await addMeasurement(await doc.save(), {
      page: 1,
      kind: "distance",
      points: [
        [0, 0],
        [72, 0],
      ],
      scale: ACTUAL_SIZE,
      author: "=HYPERLINK()",
    });
    const second = await addMeasurement(first.bytes, {
      page: 1,
      kind: "area",
      points: [
        [0, 0],
        [72, 0],
        [72, 72],
      ],
      scale: ACTUAL_SIZE,
    });
    const rows = await readMeasurements(second.bytes);
    expect(rows.map((row) => [row.kind, row.value])).toEqual([
      ["Distance", first.label],
      ["Area", second.label],
    ]);
    const csv = measurementsCsv(rows);
    expect(csv.startsWith("﻿Page,Type,Value,Scale,Author,Modified\r\n")).toBe(true);
    expect(csv).toContain("'=HYPERLINK()");
  });
});

describe("space usage", () => {
  it("attributes images, fonts and page content", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText("Space", { font: await doc.embedFont(StandardFonts.Helvetica) });
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    page.drawImage(await doc.embedPng(png), { x: 10, y: 10, width: 20, height: 20 });
    const bytes = await doc.save();
    const audit = await auditSpace(bytes);
    const names = audit.rows.map((row) => row.category);
    expect(names).toEqual(expect.arrayContaining(["Images", "Fonts", "Page content"]));
    expect(audit.fileBytes).toBe(bytes.length);
    expect(audit.rows.reduce((total, row) => total + row.bytes, 0)).toBe(audit.measuredBytes);
  });
});

describe("form merge", () => {
  it("creates one row per filled form with the union of editable fields", async () => {
    const make = async (values: Record<string, string>, checked?: boolean) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage();
      const form = doc.getForm();
      let y = 700;
      for (const [name, value] of Object.entries(values)) {
        const field = form.createTextField(name);
        field.addToPage(page, { x: 50, y: (y -= 40), width: 200, height: 20 });
        field.setText(value);
      }
      if (checked !== undefined) {
        const box = form.createCheckBox("agree");
        box.addToPage(page, { x: 50, y: 100 });
        if (checked) box.check();
      }
      return readFormData(await doc.save());
    };
    const csv = mergeFormDataCsv([
      { file: "one.pdf", report: await make({ name: "Ada", city: "=cmd" }, true) },
      { file: "two.pdf", report: await make({ name: "Lin", phone: "555" }) },
    ]);
    expect(csv.split("\r\n")).toEqual([
      '"File","name","city","agree","phone"',
      `"one.pdf","Ada","'=cmd","true",""`,
      '"two.pdf","Lin","","","555"',
      "",
    ]);
    expect(() => mergeFormDataCsv([])).toThrow("at least one");
  });
});

describe("comparison report", () => {
  it("summarises changes in a PDF an independent reader can extract", async () => {
    const bytes = await compareReportPdf({
      originalName: "contract.pdf",
      revisedName: "contract-v2.pdf",
      rows: [
        { before: 1, after: 1, status: "unchanged" },
        { before: 2, after: 2, status: "changed" },
        { before: null, after: 3, status: "added" },
      ],
      signatures: [
        [
          { text: "Same", key: "a" },
          { text: "Payment due in 30 days", key: "b" },
        ],
        [
          { text: "Same", key: "a" },
          { text: "Payment due in 45 days", key: "c" },
          { text: "Annex 𝔸 terms", key: "d" },
        ],
      ],
      created: new Date("2026-10-16T12:00:00Z"),
    });
    const text = (await pageText(bytes)).join(" ");
    expect(text).toContain("1 changed, 1 added, 0 removed and 1 unchanged pages.");
    expect(text).toContain("Original page 2 changed in revision page 2");
    expect(text).toContain("Removed: 30");
    expect(text).toContain("Added: 45");
    expect(text).toContain("Annex ? terms");
    expect(text).toContain('printed as "?"');
  });
});

describe("redaction word lists", () => {
  it("keeps unique trimmed entries and enforces limits", () => {
    expect(parseWordList("﻿Alice\r\n\n alice \nAcme Corp\n")).toEqual(["Alice", "Acme Corp"]);
    expect(() => parseWordList("\n \n")).toThrow("empty");
    expect(() => parseWordList(Array.from({ length: 501 }, (_, i) => `t${i}`).join("\n"))).toThrow(
      "at most 500",
    );
    expect(() => parseWordList("x", 300 * 1024)).toThrow("256 KB");
  });
});

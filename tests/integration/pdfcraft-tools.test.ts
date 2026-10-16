import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, degrees } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { posterGrid, posterPages, type PosterOptions } from "../../src/services/pdf/poster";
import { checkStructure, accessibilityReport } from "../../src/services/pdf/structure-checks";
GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
const options: PosterOptions = {
  sheet: "letter",
  landscape: false,
  scale: 1,
  margin: 18,
  overlap: 18,
};

describe("poster output", () => {
  it.each([0, 90, 180, 270])(
    "retains rotated content in a new printable PDF (%i degrees)",
    async (rotation) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([400, 300]);
      page.setCropBox(50, 30, 300, 200);
      page.setRotation(degrees(rotation));
      page.drawText("POSTER CANARY", { x: 80, y: 150, size: 12 });
      const source = await doc.save();
      const result = await posterPages(source, options);
      expect(result.sheets).toBe(1);
      const task = getDocument({
        data: new Uint8Array(result.bytes),
        standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
      });
      const pdf = await task.promise;
      try {
        const saved = await pdf.getPage(1);
        expect(saved.getViewport({ scale: 1 }).width).toBe(612);
        const text = await saved.getTextContent();
        expect(text.items.map((item) => ("str" in item ? item.str : "")).join("")).toContain(
          "POSTER CANARY",
        );
        const word = text.items.find((item) => "str" in item && item.str.includes("POSTER"));
        expect(word && "transform" in word && word.transform[4]).toBeGreaterThanOrEqual(18);
        expect(word && "transform" in word && word.transform[5]).toBeGreaterThan(0);
      } finally {
        await task.destroy();
      }
      expect((await PDFDocument.load(source)).getPageCount()).toBe(1);
    },
  );
  it("tiles at physical size, accounts for page units and handles blanks", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    page.node.set(PDFName.of("UserUnit"), doc.context.obj(4));
    const result = await posterPages(await doc.save(), options);
    expect(result.sheets).toBe(6);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(6);
    expect(posterGrid(576, 756, options)).toMatchObject({ columns: 1, rows: 1 });
    expect(posterGrid(577, 756, options)).toMatchObject({ columns: 2, rows: 1 });
  });
  it("rejects unbounded output, invalid pages and invalid geometry", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    for (const patch of [
      { scale: Infinity },
      { scale: 0 },
      { margin: 1000 },
      { overlap: 1000 },
      { pages: [0] },
      { pages: [] },
    ])
      await expect(posterPages(bytes, { ...options, ...patch })).rejects.toThrow();
    expect(() => posterGrid(100000, 100000, options)).toThrow(/500/);
  });
});

describe("structure accessibility", () => {
  it("checks role-mapped headings, lists and tables without changing the document", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const root = doc.context.obj({
      Type: "StructTreeRoot",
      RoleMap: { SectionTitle: "H3" },
      K: [
        { S: "H1" },
        { S: "SectionTitle" },
        { S: "L", K: [{ S: "LI" }] },
        { S: "Table", K: [{ S: "TR", K: [{ S: "TD" }] }] },
        { S: "Formula" },
      ],
    });
    doc.catalog.set(PDFName.of("StructTreeRoot"), root);
    const saved = await PDFDocument.load(await doc.save());
    const results = checkStructure(saved);
    for (const id of ["heading-nesting", "list-bodies", "table-headers", "other-alt"])
      expect(results.find((item) => item.id === id)?.status).toBe("failed");
    expect(results.find((item) => item.id === "table-cells")?.status).toBe("passed");
  });
  it("does not hang or claim a clean result on cyclic trees", () => {
    const doc = PDFDocument.create();
    return doc.then((pdf) => {
      pdf.addPage();
      const loop = pdf.context.obj({ S: "Sect" });
      loop.set(PDFName.of("K"), pdf.context.register(loop));
      pdf.catalog.set(PDFName.of("StructTreeRoot"), pdf.context.obj({ K: [loop] }));
      const checks = checkStructure(pdf);
      expect(checks.find((item) => item.id === "structure-integrity")?.status).toBe("failed");
      expect(checks.some((item) => item.status === "passed")).toBe(false);
    });
  });
  it("escapes document content in standalone reports", () => {
    const html = accessibilityReport(
      [{ id: "x", label: "<script>", detail: '"&', status: "manual" }],
      "<img src=x onerror=alert(1)>",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;&amp;");
  });
  it("does not report malformed structure children as successfully inspected", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(
      PDFName.of("StructTreeRoot"),
      doc.context.obj({ K: [{ Type: "StructElem", K: [{ S: "H3" }] }] }),
    );
    expect(checkStructure(doc).find((check) => check.id === "structure-integrity")?.status).toBe(
      "failed",
    );
    doc.catalog.set(
      PDFName.of("StructTreeRoot"),
      doc.context.obj({ K: [{ S: "P", K: [{ Type: "MCR", MCID: 0 }] }] }),
    );
    expect(checkStructure(doc).find((check) => check.id === "structure-integrity")?.status).toBe(
      "passed",
    );
  });
});

describe("saved initial view", () => {
  it("round trips startup preferences through PDF.js and preserves unrelated viewer options", async () => {
    const { readInitialView, writeInitialView } =
      await import("../../src/services/pdf/initial-view");
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    doc.catalog.set(PDFName.of("ViewerPreferences"), doc.context.obj({ HideToolbar: true }));
    doc.catalog.set(
      PDFName.of("OpenAction"),
      doc.context.obj({ S: "JavaScript", JS: "neverExecute()" }),
    );
    const view = {
      layout: "TwoPageRight",
      panel: "UseOutlines",
      page: 2,
      fit: "XYZ",
      zoom: 125,
      displayTitle: true,
      rightToLeft: true,
    } as const;
    const bytes = await writeInitialView(await doc.save(), view);
    expect(await readInitialView(bytes)).toEqual(view);
    const task = getDocument({ data: new Uint8Array(bytes) });
    const pdf = await task.promise;
    try {
      expect(await pdf.getPageLayout()).toBe("TwoPageRight");
      expect(await pdf.getPageMode()).toBe("UseOutlines");
      expect(Object.fromEntries((await pdf.getViewerPreferences()) ?? [])).toMatchObject({
        HideToolbar: true,
        DisplayDocTitle: true,
        Direction: "R2L",
      });
      expect((await pdf.getOpenAction())?.get("dest")?.slice(1)).toEqual([
        { name: "XYZ" },
        null,
        null,
        1.25,
      ]);
    } finally {
      await task.destroy();
    }
  });
  it("handles defaults and refuses out-of-range destinations", async () => {
    const { readInitialView, writeInitialView } =
      await import("../../src/services/pdf/initial-view");
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    const defaults = await readInitialView(bytes);
    expect(defaults.page).toBe(1);
    for (const patch of [{ page: 0 }, { page: 2 }, { zoom: NaN }, { layout: "Invalid" }])
      await expect(
        writeInitialView(bytes, { ...defaults, ...patch } as typeof defaults),
      ).rejects.toThrow();
    expect(
      (await readInitialView(await writeInitialView(bytes, { ...defaults, fit: "FitH" }))).fit,
    ).toBe("FitH");
  });
});

describe("additional ZIP split modes", () => {
  it("splits at sorted distinct top-level bookmarks and keeps leading pages", async () => {
    const { bookmarkPageGroups } = await import("../../src/features/pages/page-archives");
    const { writeBookmarkTree } = await import("../../src/services/pdf/bookmarks");
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) doc.addPage();
    writeBookmarkTree(doc, [
      { id: "a", title: "Last", page: 4, children: [] },
      { id: "b", title: "Middle", page: 2, children: [] },
      { id: "c", title: "Same", page: 2, children: [] },
    ]);
    expect(await bookmarkPageGroups(await doc.save())).toEqual([[0, 1], [2, 3], [4]]);
    const empty = await PDFDocument.create();
    empty.addPage();
    await expect(bookmarkPageGroups(await empty.save())).rejects.toThrow(/No top-level/);
  });
  it("measures serialized files and rejects limits smaller than an individual page", async () => {
    const { sizePageGroups } = await import("../../src/features/pages/page-archives");
    const { extractPages } = await import("../../src/services/document-commands");
    const doc = await PDFDocument.create();
    for (let i = 0; i < 8; i++) {
      const page = doc.addPage();
      page.drawText(`SPLIT PAGE ${i + 1}`);
    }
    const source = await doc.save();
    const one = await extractPages(source, [0]);
    const limit = Math.max(1024, one.length + 100);
    const groups = await sizePageGroups(source, limit);
    expect(groups.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups)
      expect((await extractPages(source, group)).length).toBeLessThanOrEqual(limit);
    await expect(sizePageGroups(source, 1023)).rejects.toThrow(/1 KB/);
    await expect(sizePageGroups(source, limit, { isCancelled: () => true })).rejects.toThrow(
      /cancelled/,
    );
  });
});

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  addFormFields,
  insertTextContent,
  parseScriptRuns,
} from "../../src/services/document-commands";
import { createFieldGrid, gridFieldName } from "../../src/services/pdf/form-authoring";
import { batesAcrossFiles, batesArchive } from "../../src/features/decorations/bates-files";
import {
  clearImageClipboard,
  nextImagePasteOffset,
  setImageClipboard,
} from "../../src/features/editor/image-clipboard";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function blank(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([600, 800]);
  return doc.save();
}

async function textItems(bytes: Uint8Array) {
  const pdf = await getDocument({
    data: bytes.slice(),
    standardFontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    useSystemFonts: false,
  }).promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  await pdf.cleanup();
  return content.items
    .filter((item) => "str" in item && item.str.trim())
    .map((item) => {
      const { str, transform } = item as { str: string; transform: number[] };
      return { str, y: transform[5], size: Math.abs(transform[3]) };
    });
}

describe("Superscript and subscript", () => {
  it("splits marked runs and keeps unclosed markers as typed", () => {
    expect(parseScriptRuns("E = mc^{2} and H_{2}O")).toEqual([
      { text: "E = mc", script: "normal" },
      { text: "2", script: "super" },
      { text: " and H", script: "normal" },
      { text: "2", script: "sub" },
      { text: "O", script: "normal" },
    ]);
    expect(parseScriptRuns("a^{b")).toEqual([{ text: "a^{b", script: "normal" }]);
    expect(parseScriptRuns("x^{}")).toEqual([{ text: "x^{}", script: "normal" }]);
  });

  it("draws raised and lowered runs smaller, keeping the characters", async () => {
    const bytes = await insertTextContent(await blank(), {
      page: 1,
      text: "x^{2} H_{2}O",
      x: 100,
      y: 500,
      fontSize: 20,
    });
    const items = await textItems(bytes);
    const base = items.find((item) => item.str.startsWith("x"))!;
    const raised = items.find((item) => item.str === "2" && item.y > base.y)!;
    const lowered = items.find((item) => item.str === "2" && item.y < base.y)!;
    expect(raised.size).toBeLessThan(base.size);
    expect(lowered.size).toBeLessThan(base.size);
    expect(items.map((item) => item.str).join("")).not.toContain("^{");
  });
});

describe("Grid of form fields", () => {
  it("names cells from the pattern and adds same-sized fields down and across", async () => {
    expect(gridFieldName("{name}_{row}_{column}", "qty", 2, 3)).toBe("qty_2_3");
    const bytes = await addFormFields(await blank(), [
      { type: "text", name: "qty", page: 1, x: 50, y: 700, width: 60, height: 20 },
    ]);
    const { bytes: grid, added } = await createFieldGrid(bytes, "qty", {
      rows: 2,
      columns: 3,
      gapX: 5,
      gapY: 10,
      pattern: "{name}_{row}_{column}",
    });
    expect(added).toBe(5);
    const form = (await PDFDocument.load(grid)).getForm();
    const rect = (name: string) => form.getTextField(name).acroField.getWidgets()[0].getRectangle();
    const source = rect("qty");
    expect(rect("qty_1_3")).toMatchObject({
      x: source.x + 2 * (source.width + 5),
      y: source.y,
      width: source.width,
      height: source.height,
    });
    expect(rect("qty_2_1")).toMatchObject({ x: source.x, y: source.y - (source.height + 10) });
    expect(form.getFields()).toHaveLength(6);
  });

  it("refuses whole grids with repeated, existing or nested names, or that leave the page", async () => {
    const bytes = await addFormFields(await blank(), [
      { type: "text", name: "a", page: 1, x: 300, y: 40, width: 60, height: 20 },
      { type: "text", name: "taken", page: 1, x: 0, y: 0, width: 60, height: 20 },
    ]);
    const grid = (pattern: string, rows = 1, columns = 2) =>
      createFieldGrid(bytes, "a", { rows, columns, gapX: 0, gapY: 0, pattern });
    await expect(grid("same", 1, 3)).rejects.toThrow(/repeats/);
    await expect(grid("taken")).rejects.toThrow(/already exists/);
    await expect(grid("a.{column}")).rejects.toThrow(/period/);
    await expect(grid("{name}{column}", 1, 6)).rejects.toThrow(/does not fit/);
    await expect(grid("{name}{row}", 3, 1)).rejects.toThrow(/does not fit/);
  });
});

describe("Bates numbering across files", () => {
  it("continues numbering from file to file and lists each range", async () => {
    const results = await batesAcrossFiles(
      [
        { name: "one.pdf", bytes: await blank(2) },
        { name: "bad.pdf", bytes: new TextEncoder().encode("not a pdf") },
        { name: "two.pdf", bytes: await blank(3) },
      ],
      { prefix: "ABC", startNumber: 7, padding: 4 },
    );
    expect(results.map((result) => [result.name, result.first, result.last])).toEqual([
      ["one.pdf", "ABC0007", "ABC0008"],
      ["bad.pdf", undefined, undefined],
      ["two.pdf", "ABC0009", "ABC0011"],
    ]);
    expect(results[1].error).toBeTruthy();
    const zip = new TextDecoder("latin1").decode(batesArchive(results));
    expect(zip).toContain("one (Bates).pdf");
    expect(zip).toContain("Bates numbers.csv");
    expect(zip).toContain("ABC0009,ABC0011");
  });

  it("refuses an empty selection", async () => {
    await expect(batesAcrossFiles([], {})).rejects.toThrow(/Choose/);
  });
});

describe("Image clipboard", () => {
  it("steps pastes on the source page and starts at the same place elsewhere", () => {
    setImageClipboard(new Uint8Array([1]), "doc", 2);
    expect(nextImagePasteOffset("doc", 2)).toBe(18);
    expect(nextImagePasteOffset("doc", 2)).toBe(36);
    expect(nextImagePasteOffset("doc", 3)).toBe(0);
    expect(nextImagePasteOffset("other", 2)).toBe(0);
    expect(nextImagePasteOffset("other", 2)).toBe(18);
    clearImageClipboard();
  });
});

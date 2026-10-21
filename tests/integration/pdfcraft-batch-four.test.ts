import { describe, expect, it } from "vitest";
import { AnnotationFlags, PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { resolve } from "node:path";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { addFormField, addFormFields } from "../../src/services/document-commands";
import {
  colorFromHex,
  duplicateFieldToPages,
  hexFromColor,
  readFieldProperties,
  readTabOrder,
  renameFields,
  setTabOrder,
  updateFieldProperties,
} from "../../src/services/pdf/form-authoring";
import {
  candidateDefinitions,
  detectFieldCandidates,
  nameFromLabel,
  suggestFieldNames,
} from "../../src/features/forms/field-detection";
import { formatDate, parseDate } from "../../src/features/viewer/date-fields";

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

async function blank(pages = 1) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) doc.addPage([600, 800]);
  return doc.save();
}

const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

const geometry = { page: 1, x: 50, y: 600, width: 150, height: 60 };

describe("new field types", () => {
  it("creates list boxes, date fields and image fields that PDF.js reads", async () => {
    let bytes = await blank();
    bytes = await addFormField(bytes as Uint8Array<ArrayBuffer>, {
      ...geometry,
      type: "listbox",
      name: "Colours",
      options: ["Red", "Green", "Blue"],
      multiSelect: true,
      defaultValue: "Green",
    });
    bytes = await addFormField(bytes as Uint8Array<ArrayBuffer>, {
      ...geometry,
      y: 500,
      type: "date",
      name: "Signed on",
      dateFormat: "dd/mm/yyyy",
    });
    bytes = await addFormField(bytes as Uint8Array<ArrayBuffer>, {
      ...geometry,
      y: 380,
      type: "image",
      name: "Photo",
      image: { bytes: TINY_PNG, type: "png" },
    });
    const annotations = await withPdf(bytes, async (pdf) =>
      (await pdf.getPage(1)).getAnnotations(),
    );
    const byName = new Map(annotations.map((item) => [item.fieldName, item]));
    expect(byName.get("Colours")).toMatchObject({
      fieldType: "Ch",
      combo: false,
      multiSelect: true,
    });
    expect(byName.get("Signed on")).toMatchObject({
      fieldType: "Tx",
      datetimeFormat: "dd/mm/yyyy",
    });
    expect(byName.get("Photo")).toMatchObject({ fieldType: "Btn", pushButton: true });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getForm().getOptionList("Colours").getSelected()).toEqual(["Green"]);
    await expect(
      addFormField(bytes as Uint8Array<ArrayBuffer>, {
        ...geometry,
        type: "date",
        name: "x",
        dateFormat: "yy.dd",
      }),
    ).rejects.toThrow("date format");
    await expect(
      addFormField(bytes as Uint8Array<ArrayBuffer>, { ...geometry, type: "image", name: "y" }),
    ).rejects.toThrow("PNG or JPEG");
  });
});

describe("field properties", () => {
  async function form() {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    doc.addPage([600, 800]);
    doc.addPage([600, 800]);
    const form = doc.getForm();
    form.createTextField("first").addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
    form.createTextField("second").addToPage(page, { x: 50, y: 650, width: 200, height: 24 });
    form
      .createRadioGroup("choice")
      .addOptionToPage("A", page, { x: 50, y: 600, width: 20, height: 20 });
    return doc.save();
  }

  it("renames, sets tooltips, colours, lengths, combing, locking and hiding", async () => {
    const result = await updateFieldProperties(await form(), "first", {
      newName: "Given name",
      tooltip: "Your given name",
      fontSize: 11,
      alignment: "center",
      maxLength: 8,
      comb: true,
      borderColor: [1, 0, 0],
      fillColor: [0.9, 0.9, 1],
      locked: true,
      hidden: false,
    });
    expect(result.appearanceRebuilt).toBe(true);
    const fields = await readFieldProperties(result.bytes);
    expect(fields.find((field) => field.name === "Given name")).toMatchObject({
      tooltip: "Your given name",
      fontSize: 11,
      alignment: "center",
      maxLength: 8,
      comb: true,
      borderColor: [1, 0, 0],
      locked: true,
      hidden: false,
    });
    const [annotation] = await withPdf(result.bytes, async (pdf) =>
      (await pdf.getPage(1)).getAnnotations(),
    );
    expect(annotation).toMatchObject({
      fieldName: "Given name",
      alternativeText: "Your given name",
      maxLen: 8,
      comb: true,
    });
    const hidden = await updateFieldProperties(result.bytes, "second", { hidden: true });
    const widget = (await PDFDocument.load(hidden.bytes))
      .getForm()
      .getTextField("second")
      .acroField.getWidgets()[0];
    expect(widget.hasFlag(AnnotationFlags.Hidden)).toBe(true);
    expect(widget.hasFlag(AnnotationFlags.Print)).toBe(false);
  });

  it("rejects duplicate names, impossible lengths and bad colours", async () => {
    const bytes = await form();
    await expect(updateFieldProperties(bytes, "first", { newName: "second" })).rejects.toThrow(
      "already exists",
    );
    await expect(updateFieldProperties(bytes, "first", { comb: true })).rejects.toThrow(
      "maximum length",
    );
    await expect(updateFieldProperties(bytes, "first", { maxLength: 0 })).rejects.toThrow(
      "whole number",
    );
    await expect(updateFieldProperties(bytes, "first", { borderColor: [2, 0, 0] })).rejects.toThrow(
      "Colors",
    );
    await expect(updateFieldProperties(bytes, "missing", {})).rejects.toThrow("not found");
    const filled = await PDFDocument.load(bytes);
    filled.getForm().getTextField("first").setText("abcdefghij");
    await expect(
      updateFieldProperties(await filled.save(), "first", { maxLength: 3 }),
    ).rejects.toThrow("longer");
  });

  it("duplicates a field across pages with one shared value", async () => {
    const bytes = await duplicateFieldToPages(await form(), "first", [0, 1, 2]);
    const doc = await PDFDocument.load(bytes);
    const field = doc.getForm().getTextField("first");
    expect(field.acroField.getWidgets()).toHaveLength(3);
    field.setText("shared");
    const values = await withPdf(await doc.save(), async (pdf) => {
      const found: string[] = [];
      for (let page = 1; page <= 3; page++)
        for (const item of await (await pdf.getPage(page)).getAnnotations())
          if (item.fieldName === "first") found.push(`${page}:${item.fieldValue}`);
      return found;
    });
    expect(values).toEqual(["1:shared", "2:shared", "3:shared"]);
    await expect(duplicateFieldToPages(bytes, "choice", [1])).rejects.toThrow("Radio groups");
    await expect(duplicateFieldToPages(bytes, "first", [0])).rejects.toThrow("other page");
  });

  it("sets and clears the tab order on every page", async () => {
    const bytes = await form();
    expect(await readTabOrder(bytes)).toBeNull();
    const rows = await setTabOrder(bytes, "R");
    expect(await readTabOrder(rows)).toBe("R");
    const doc = await PDFDocument.load(rows);
    expect(
      doc.getPages().every((page) => page.node.get(PDFName.of("Tabs")) === PDFName.of("R")),
    ).toBe(true);
    expect(await readTabOrder(await setTabOrder(rows, null))).toBeNull();
  });

  it("renames several fields atomically", async () => {
    const bytes = await renameFields(await form(), [
      { from: "first", to: "Name" },
      { from: "second", to: "first" },
    ]);
    expect((await readFieldProperties(bytes)).map((field) => field.name).sort()).toEqual([
      "Name",
      "choice",
      "first",
    ]);
    await expect(renameFields(await form(), [{ from: "first", to: "second" }])).rejects.toThrow(
      "already exists",
    );
  });

  it("converts colours between hex and PDF channels", () => {
    expect(colorFromHex("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(colorFromHex("red")).toBeNull();
    expect(hexFromColor([1, 0.5, 0])).toBe("#ff8000");
    expect(hexFromColor(null)).toBe("");
  });
});

describe("field detection and naming", () => {
  async function paperForm() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText("Full name: ____________________", { x: 50, y: 700, size: 12, font });
    page.drawText("Email:", { x: 50, y: 650, size: 12, font });
    page.drawText("____________________", { x: 120, y: 650, size: 12, font });
    page.drawText("Phone", { x: 50, y: 560, size: 12, font });
    doc
      .getForm()
      .createTextField("Text1")
      .addToPage(page, { x: 100, y: 553, width: 150, height: 20 });
    return doc.save();
  }

  it("names fields from labels and keeps names unique", () => {
    expect(nameFromLabel("Full name: ")).toBe("Full name");
    expect(nameFromLabel("Date of birth (dd.mm.yyyy)*:")).toBe("Date of birth (dd mm yyyy)");
  });

  it("finds underscore lines with their labels and skips covered areas", async () => {
    const bytes = await paperForm();
    const found = await withPdf(bytes, (pdf) => detectFieldCandidates(pdf, bytes));
    expect(found.map(({ name, kind, page }) => [name, kind, page])).toEqual([
      ["Full name", "text", 1],
      ["Email", "text", 1],
    ]);
    expect(found[0].rect[0]).toBeGreaterThan(100);
    const created = await addFormFields(bytes, candidateDefinitions(found));
    const names = (await PDFDocument.load(created))
      .getForm()
      .getFields()
      .map((field) => field.getName());
    expect(names).toEqual(expect.arrayContaining(["Full name", "Email", "Text1"]));
    const again = await withPdf(created, (pdf) => detectFieldCandidates(pdf, created));
    expect(again).toEqual([]);
  });

  it("suggests names from the label beside a field", async () => {
    const bytes = await paperForm();
    const suggestions = await withPdf(bytes, (pdf) => suggestFieldNames(pdf, bytes));
    expect(suggestions).toEqual([{ field: "Text1", suggested: "Phone" }]);
  });
});

describe("date picker formatting", () => {
  it.each([
    ["yyyy-mm-dd", "2026-03-04"],
    ["mm/dd/yyyy", "03/04/2026"],
    ["dd/mm/yyyy", "04/03/2026"],
    ["d mmm yyyy", "4 Mar 2026"],
    ["mmm d, yyyy", "Mar 4, 2026"],
  ])("round-trips %s", (format, text) => {
    expect(formatDate("2026-03-04", format)).toBe(text);
    expect(parseDate(text, format)).toBe("2026-03-04");
  });

  it("rejects impossible or mismatched dates", () => {
    expect(parseDate("31/02/2026", "dd/mm/yyyy")).toBeNull();
    expect(parseDate("tomorrow", "yyyy-mm-dd")).toBeNull();
    // Formats come from the document, so regular-expression syntax in them is literal text.
    expect(parseDate("(04).*03+2026", "(dd).*mm+yyyy")).toBe("2026-03-04");
    expect(parseDate("04x03x2026", "dd.mm.yyyy")).toBeNull();
    expect(formatDate("not a date", "yyyy")).toBe("");
  });
});

it("keeps PDF dictionaries valid for detected checkboxes", async () => {
  const bytes = await addFormFields(await blank(), [
    { type: "checkbox", name: "Agree", page: 1, x: 40, y: 40, width: 12, height: 12 },
  ]);
  const field = (await PDFDocument.load(bytes)).getForm().getCheckBox("Agree");
  expect(field.acroField.dict).toBeInstanceOf(PDFDict);
  await expect(addFormFields(await blank(), [])).rejects.toThrow("at least one");
});

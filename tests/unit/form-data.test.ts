import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, PDFRadioGroup, PDFString, PDFTextField } from "pdf-lib";
import {
  exportFormDataCsv,
  exportFormDataJson,
  findMissingRequiredFields,
  importFormData,
  MAX_FORM_DATA_BYTES,
  previewFormDataImport,
  readFormData,
  resetFormData,
} from "../../src/services/pdf/form-data";

async function fixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const text = form.createTextField("Applicant");
  text.addToPage(page, { x: 20, y: 600, width: 160, height: 25 });
  text.setText("Before");
  text.enableRequired();
  const check = form.createCheckBox("Confirmed");
  check.addToPage(page, { x: 20, y: 550, width: 20, height: 20 });
  check.enableRequired();
  const choice = form.createDropdown("Color");
  choice.setOptions(["Red", "Blue"]);
  choice.addToPage(page, { x: 20, y: 500, width: 160, height: 25 });
  choice.select("Red");
  const radio = form.createRadioGroup("Delivery");
  radio.addOptionToPage("Post", page, { x: 20, y: 450, width: 20, height: 20 });
  radio.addOptionToPage("Email", page, { x: 50, y: 450, width: 20, height: 20 });
  radio.select("Post");
  const list = form.createOptionList("Extras");
  list.setOptions(["A", "B", "C"]);
  list.enableMultiselect();
  list.addToPage(page, { x: 20, y: 350, width: 160, height: 70 });
  list.select(["A", "C"]);
  const locked = form.createTextField("Locked");
  locked.setText("Keep");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 20, y: 280, width: 160, height: 25 });
  const button = form.createButton("Run");
  button.addToPage("Run", page, { x: 20, y: 220, width: 80, height: 25 });
  const signature = doc.context.obj({ FT: "Sig", T: PDFString.of("Approval"), Ff: 0 });
  form.acroForm.addField(doc.context.register(signature));
  doc.setTitle("Preserved title");
  return doc.save();
}

function payload(fields: unknown[]) {
  return JSON.stringify({ format: "navpdf-form-data", version: 1, fields });
}

const updates = [
  { name: "Applicant", type: "text", value: "After" },
  { name: "Confirmed", type: "checkbox", value: true },
  { name: "Color", type: "dropdown", value: ["Blue"] },
  { name: "Delivery", type: "radio", value: "Email" },
  { name: "Extras", type: "list", value: ["B"] },
];

describe("form data exchange", () => {
  it("round-trips custom editable dropdown values without changing choices or flags", async () => {
    const doc = await PDFDocument.load(await fixture());
    const field = doc.getForm().createDropdown("Editable");
    field.setOptions(["Known"]);
    field.enableEditing();
    field.select("Custom");
    field.addToPage(doc.getPage(0), { x: 200, y: 600, width: 160, height: 25 });
    const bytes = await doc.save();
    const json = exportFormDataJson(await readFormData(bytes));
    expect(await previewFormDataImport(bytes, json)).toContainEqual({
      name: "Editable",
      type: "dropdown",
      before: ["Custom"],
      after: ["Custom"],
    });
    const saved = await PDFDocument.load(await importFormData(bytes, json));
    const imported = saved.getForm().getDropdown("Editable");
    expect(imported.getSelected()).toEqual(["Custom"]);
    expect(imported.getOptions()).toEqual(["Known"]);
    expect(imported.isEditable()).toBe(true);
    expect(imported.isMultiselect()).toBe(false);
    expect(imported.acroField.getWidgets()[0].getAppearances()?.normal).toBeTruthy();
    await expect(
      importFormData(bytes, payload([{ name: "Extras", type: "list", value: ["Custom"] }])),
    ).rejects.toThrow(/not available/);
    await expect(
      importFormData(bytes, payload([{ name: "Color", type: "dropdown", value: ["Custom"] }])),
    ).rejects.toThrow(/not available/);
  });

  it("excludes choices with separate export labels and preserves them when clearing", async () => {
    const doc = await PDFDocument.load(await fixture());
    const field = doc.getForm().getDropdown("Color");
    field.acroField.setOptions([{ value: PDFString.of("R"), display: PDFString.of("Red") }]);
    field.acroField.dict.set(PDFName.of("V"), PDFString.of("R"));
    const bytes = await doc.save();
    const report = await readFormData(bytes);
    expect(report.excluded.map((entry) => entry.name)).toContain("Color");
    expect(
      JSON.parse(exportFormDataJson(report)).fields.map((entry: { name: string }) => entry.name),
    ).not.toContain("Color");
    const saved = await PDFDocument.load(await resetFormData(bytes));
    expect(saved.getForm().getDropdown("Color").getSelected()).toEqual(["R"]);
    await expect(
      importFormData(bytes, payload([{ name: "Color", type: "dropdown", value: ["Red"] }])),
    ).rejects.toThrow(/unsupported/);
  });

  it("rejects values the built-in font cannot draw during preview", async () => {
    const bytes = await fixture();
    const data = payload([{ ...updates[0], value: "漢字" }]);
    await expect(previewFormDataImport(bytes, data)).rejects.toThrow(/font cannot draw/);
    await expect(importFormData(bytes, data)).rejects.toThrow(/font cannot draw/);
  });

  it("exports versioned editable values and preserves supported types for round trips", async () => {
    const bytes = await fixture();
    const report = await readFormData(bytes);
    const json = exportFormDataJson(report);
    expect(JSON.parse(json)).toEqual({
      format: "navpdf-form-data",
      version: 1,
      fields: [
        { name: "Applicant", type: "text", value: "Before" },
        { name: "Confirmed", type: "checkbox", value: false },
        { name: "Color", type: "dropdown", value: ["Red"] },
        { name: "Delivery", type: "radio", value: "Post" },
        { name: "Extras", type: "list", value: ["A", "C"] },
      ],
    });
    const output = await importFormData(bytes, json);
    expect(exportFormDataJson(await readFormData(output))).toBe(json);
    expect(report.excluded.map((field) => field.name)).toEqual(["Run", "Approval"]);
  });

  it("previews without changing input and saves all validated values with appearances", async () => {
    const bytes = await fixture();
    const original = bytes.slice();
    const json = payload(updates);
    const preview = await previewFormDataImport(bytes, json);
    expect(preview).toHaveLength(5);
    expect(preview[0]).toMatchObject({ name: "Applicant", before: "Before", after: "After" });
    expect(bytes).toEqual(original);
    const doc = await PDFDocument.load(await importFormData(bytes, json));
    const form = doc.getForm();
    expect(form.getTextField("Applicant").getText()).toBe("After");
    expect(form.getCheckBox("Confirmed").isChecked()).toBe(true);
    expect(form.getDropdown("Color").getSelected()).toEqual(["Blue"]);
    expect(form.getRadioGroup("Delivery").getSelected()).toBe("Email");
    expect(form.getOptionList("Extras").getSelected()).toEqual(["B"]);
    expect(
      form.getTextField("Applicant").acroField.getWidgets()[0].getAppearances()?.normal,
    ).toBeTruthy();
    expect(form.getTextField("Locked").getText()).toBe("Keep");
    expect(form.getField("Approval").acroField.dict.get(PDFName.of("FT"))).toEqual(
      PDFName.of("Sig"),
    );
    expect(form.getButton("Run")).toBeTruthy();
    expect(doc.getTitle()).toBe("Preserved title");
  });

  it.each([
    ["unknown field", [{ name: "Missing", type: "text", value: "x" }]],
    ["duplicate field", [updates[0], updates[0]]],
    ["incompatible field type", [{ name: "Applicant", type: "checkbox", value: true }]],
    ["wrong value type", [{ name: "Confirmed", type: "checkbox", value: "true" }]],
    ["invalid option", [{ name: "Color", type: "dropdown", value: ["Green"] }]],
    [
      "multiple single-choice options",
      [{ name: "Color", type: "dropdown", value: ["Red", "Blue"] }],
    ],
    ["duplicate options", [{ name: "Extras", type: "list", value: ["A", "A"] }]],
    ["read-only field", [{ name: "Locked", type: "text", value: "Change" }]],
    ["unsupported field", [{ name: "Run", type: "text", value: "Change" }]],
    ["oversized value", [{ name: "Applicant", type: "text", value: "x".repeat(65_537) }]],
    ["unknown property", [{ ...updates[0], script: "untrusted" }]],
  ])("rejects %s before changing any field", async (_label, fields) => {
    const bytes = await fixture();
    const setText = vi.spyOn(PDFTextField.prototype, "setText");
    const select = vi.spyOn(PDFRadioGroup.prototype, "select");
    try {
      await expect(importFormData(bytes, payload([updates[3], ...fields]))).rejects.toThrow();
      expect(setText).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect((await PDFDocument.load(bytes)).getForm().getTextField("Applicant").getText()).toBe(
        "Before",
      );
    } finally {
      setText.mockRestore();
      select.mockRestore();
    }
  });

  it.each([
    "{",
    "null",
    "[]",
    '{"format":"navpdf-form-data","version":2,"fields":[]}',
    " ".repeat(MAX_FORM_DATA_BYTES + 1),
  ])("rejects malformed, unsupported or oversized input", async (json) => {
    await expect(previewFormDataImport(await fixture(), json)).rejects.toThrow();
  });

  it("enforces text length and leaves unknown PDF fields untouched", async () => {
    const doc = await PDFDocument.load(await fixture());
    doc.getForm().getTextField("Applicant").setMaxLength(6);
    const unknown = doc.context.obj({
      FT: "Custom",
      T: PDFString.of("Opaque"),
      V: PDFString.of("Keep opaque"),
    });
    doc.getForm().acroForm.addField(doc.context.register(unknown));
    const bytes = await doc.save();
    await expect(
      importFormData(bytes, payload([{ ...updates[0], value: "Too long" }])),
    ).rejects.toThrow(/maximum|length/i);
    const output = await PDFDocument.load(await resetFormData(bytes));
    const opaque = output
      .getForm()
      .acroForm.getAllFields()
      .find(([field]) => field.getFullyQualifiedName() === "Opaque");
    expect(opaque?.[0].dict.lookup(PDFName.of("V"))?.toString()).toContain("Keep opaque");
  });

  it("reports missing required values, including read-only fields", async () => {
    const doc = await PDFDocument.load(await fixture());
    doc.getForm().getTextField("Applicant").setText("   ");
    const locked = doc.getForm().getTextField("Locked");
    locked.setText("");
    locked.enableRequired();
    const missing = findMissingRequiredFields(await readFormData(await doc.save()));
    expect(missing.map((field) => field.name)).toEqual(["Applicant", "Confirmed", "Locked"]);
    expect(missing.find((field) => field.name === "Locked")?.readOnly).toBe(true);
  });

  it("clears supported editable values while retaining defaults, settings and excluded fields", async () => {
    const doc = await PDFDocument.load(await fixture());
    const text = doc.getForm().getTextField("Applicant");
    text.acroField.dict.set(PDFName.of("DV"), doc.context.obj("Default"));
    const output = await PDFDocument.load(await resetFormData(await doc.save()));
    const form = output.getForm();
    expect(form.getTextField("Applicant").getText() ?? "").toBe("");
    expect(form.getTextField("Applicant").isRequired()).toBe(true);
    expect(
      form.getTextField("Applicant").acroField.dict.lookup(PDFName.of("DV"))?.toString(),
    ).toContain("Default");
    expect(form.getCheckBox("Confirmed").isChecked()).toBe(false);
    expect(form.getDropdown("Color").getSelected()).toEqual([]);
    expect(form.getRadioGroup("Delivery").getSelected()).toBeUndefined();
    expect(form.getOptionList("Extras").getSelected()).toEqual([]);
    expect(form.getTextField("Locked").getText()).toBe("Keep");
    expect(form.getField("Approval")).toBeTruthy();
    expect(form.getButton("Run")).toBeTruthy();
  });

  it("quotes CSV values and neutralizes formulas after whitespace", async () => {
    const report = await readFormData(await fixture());
    report.fields[0].name = "=SUM(1,2)";
    report.fields[0].value = '\t+HYPERLINK("bad")\nsecond line';
    const csv = exportFormDataCsv(report);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"\'\t+HYPERLINK(""bad"")\nsecond line"');
    expect(csv).toContain('"Confirmed","checkbox","false"');
    expect(csv).not.toContain("Locked");
  });

  it("rejects XFA before pdf-lib can remove its data", async () => {
    const doc = await PDFDocument.load(await fixture());
    doc.getForm().acroForm.dict.set(PDFName.of("XFA"), doc.context.obj("Preserve XFA"));
    const bytes = await doc.save({ updateFieldAppearances: false });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(readFormData(bytes)).rejects.toThrow(/XFA/);
      await expect(importFormData(bytes, payload(updates))).rejects.toThrow(/XFA/);
      await expect(resetFormData(bytes)).rejects.toThrow(/XFA/);
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it("reports signed documents but refuses mutations that would invalidate signatures", async () => {
    const doc = await PDFDocument.load(await fixture());
    doc
      .getForm()
      .getField("Approval")
      .acroField.dict.set(PDFName.of("V"), doc.context.obj({ Type: "Sig", Contents: "signed" }));
    const bytes = await doc.save();
    expect((await readFormData(bytes)).signed).toBe(true);
    await expect(importFormData(bytes, payload(updates))).rejects.toThrow(/signed/);
    await expect(resetFormData(bytes)).rejects.toThrow(/signed/);
  });
});

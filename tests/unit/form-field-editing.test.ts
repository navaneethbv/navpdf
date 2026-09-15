import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  addFormField,
  createBlankDocument,
  deleteFormField,
  updateFormField,
} from "../../src/services/document-commands";

describe("form field editing", () => {
  it("updates values and flags, then removes a field without dropping its siblings", async () => {
    let bytes = await createBlankDocument(1, 600, 800);
    bytes = await addFormField(bytes, {
      type: "text",
      name: "Applicant",
      page: 1,
      x: 50,
      y: 80,
      width: 220,
      height: 24,
      defaultValue: "Before",
    });
    bytes = await addFormField(bytes, {
      type: "checkbox",
      name: "Confirmed",
      page: 1,
      x: 50,
      y: 130,
      width: 20,
      height: 20,
    });

    bytes = await updateFormField(bytes, {
      name: "Applicant",
      value: "After",
      required: true,
      readOnly: true,
    });
    bytes = await updateFormField(bytes, {
      name: "Confirmed",
      checked: true,
    });

    let doc = await PDFDocument.load(bytes);
    expect(doc.getForm().getTextField("Applicant").getText()).toBe("After");
    expect(doc.getForm().getTextField("Applicant").isRequired()).toBe(true);
    expect(doc.getForm().getTextField("Applicant").isReadOnly()).toBe(true);
    expect(doc.getForm().getCheckBox("Confirmed").isChecked()).toBe(true);

    bytes = await deleteFormField(bytes, "Confirmed");
    doc = await PDFDocument.load(bytes);
    expect(
      doc
        .getForm()
        .getFields()
        .map((field) => field.getName()),
    ).toEqual(["Applicant"]);
  });

  it("creates an empty signature widget in the AcroForm", async () => {
    const bytes = await addFormField(await createBlankDocument(1, 600, 800), {
      type: "signature",
      name: "Approval",
      page: 1,
      x: 50,
      y: 100,
      width: 220,
      height: 48,
    });
    const doc = await PDFDocument.load(bytes);
    const field = doc.getForm().getFieldMaybe("Approval");
    expect(field?.getName()).toBe("Approval");
    expect(doc.getPage(0).node.Annots()?.size()).toBe(1);
    expect(doc.getPage(0).node.Annots()?.lookup(0).toString()).toMatch(/\d+ \d+ R/);
  });
});

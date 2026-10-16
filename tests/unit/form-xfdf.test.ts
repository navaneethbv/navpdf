// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { exportFormXfdf, formXfdfToJson } from "../../src/services/pdf/form-xfdf";
import { importFormData, readFormData } from "../../src/services/pdf/form-data";

async function form() {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const text = doc.getForm().createTextField("person.name");
  text.addToPage(page);
  text.setText("A & B <C>");
  const check = doc.getForm().createCheckBox("approved");
  check.addToPage(page);
  check.check();
  const list = doc.getForm().createOptionList("colors");
  list.addOptions(["red", "blue"]);
  list.enableMultiselect();
  list.select(["red", "blue"]);
  list.addToPage(page);
  return doc.save();
}
it("round trips text, checkboxes and multi-value choices through XFDF and saved PDF appearances", async () => {
  const bytes = await form();
  const xml = await exportFormXfdf(bytes);
  expect(xml).toContain("A &amp; B &lt;C&gt;");
  expect(xml).toContain("<value>Yes</value>");
  const imported = await importFormData(
    bytes,
    await formXfdfToJson(bytes, xml.replace("A &amp; B &lt;C&gt;", "Updated")),
  );
  const report = await readFormData(imported);
  expect(report.fields.find((field) => field.name === "person.name")?.value).toBe("Updated");
  expect(report.fields.find((field) => field.name === "approved")?.value).toBe(true);
  expect(report.fields.find((field) => field.name === "colors")?.value).toEqual(["red", "blue"]);
});
it("supports nested field names and leaves unspecified fields unchanged", async () => {
  const bytes = await form();
  const xml =
    '<xfdf xmlns="http://ns.adobe.com/xfdf/"><fields><field name="person"><field name="name"><value>Nested</value></field></field></fields></xfdf>';
  const result = await readFormData(await importFormData(bytes, await formXfdfToJson(bytes, xml)));
  expect(result.fields.find((field) => field.name === "person.name")?.value).toBe("Nested");
  expect(result.fields.find((field) => field.name === "approved")?.value).toBe(true);
});
it("uses custom checkbox export names instead of assuming Yes", async () => {
  const doc = await PDFDocument.load(await form());
  const box = doc.getForm().getCheckBox("approved");
  const normal = box.acroField.getWidgets()[0].getAppearances()!.normal;
  if (!("set" in normal)) throw new Error("Expected an appearance dictionary");
  const appearance = normal.get(PDFName.of("Yes"))!;
  normal.delete(PDFName.of("Yes"));
  normal.set(PDFName.of("Accepted"), appearance);
  box.acroField.setValue(PDFName.of("Accepted"));
  const bytes = await doc.save();
  const xml = await exportFormXfdf(bytes);
  expect(xml).toContain("<value>Accepted</value>");
  const report = await readFormData(await importFormData(bytes, await formXfdfToJson(bytes, xml)));
  expect(report.fields.find((field) => field.name === "approved")?.value).toBe(true);
});
it("rejects DTDs, malformed XML, annotations, duplicates, unknown fields and unknown states", async () => {
  const bytes = await form();
  const xml = await exportFormXfdf(bytes);
  for (const invalid of [
    '<!DOCTYPE xfdf [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml,
    "<broken>",
    xml.replace("<fields>", "<annots><text/></annots><fields>"),
    xml.replace("</fields>", '<field name="person.name"><value>x</value></field></fields>'),
    xml.replace('name="approved"', 'name="missing"'),
    xml.replace("<value>Yes</value>", "<value>Other</value>"),
  ])
    await expect(formXfdfToJson(bytes, invalid)).rejects.toThrow();
});

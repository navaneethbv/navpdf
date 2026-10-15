import {
  PDFCheckBox,
  PDFAcroNonTerminal,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  type PDFField,
  type PDFFont,
} from "pdf-lib";

export const MAX_FORM_DATA_BYTES = 2 * 1024 * 1024;
const MAX_FIELDS = 10_000;
const MAX_VALUE_LENGTH = 65_536;
const MAX_NAME_LENGTH = 1_024;
const MAX_CHOICES = 1_000;

type FieldType = "text" | "checkbox" | "dropdown" | "radio" | "list";
export type FormValue = string | boolean | string[];
export interface FormValueEntry {
  name: string;
  type: FieldType;
  value: FormValue;
}
export interface FormDataField extends FormValueEntry {
  required: boolean;
  readOnly: boolean;
}
export interface FormDataReport {
  fields: FormDataField[];
  excluded: { name: string; reason: string }[];
  signed: boolean;
}
export interface FormDataPreview {
  name: string;
  type: FieldType;
  before: FormValue;
  after: FormValue;
}

type SupportedField = PDFTextField | PDFCheckBox | PDFDropdown | PDFRadioGroup | PDFOptionList;

function valueOf(field: PDFField): FormValueEntry | null {
  const name = field.getName();
  if (
    (field instanceof PDFDropdown || field instanceof PDFOptionList) &&
    field.acroField
      .getOptions()
      .some((option) => option.value.decodeText() !== option.display.decodeText())
  )
    return null;
  if (field instanceof PDFTextField) return { name, type: "text", value: field.getText() ?? "" };
  if (field instanceof PDFCheckBox) return { name, type: "checkbox", value: field.isChecked() };
  if (field instanceof PDFDropdown) return { name, type: "dropdown", value: field.getSelected() };
  if (field instanceof PDFRadioGroup)
    return { name, type: "radio", value: field.getSelected() ?? "" };
  if (field instanceof PDFOptionList) return { name, type: "list", value: field.getSelected() };
  return null;
}

async function loadForm(bytes: Uint8Array) {
  // Never ignore encryption. Checking XFA before getForm also avoids pdf-lib deleting XFA.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (acroForm instanceof PDFDict && acroForm.has(PDFName.of("XFA")))
    throw new Error("XFA form data is not supported. Use the form's authoring application.");
  const form = doc.getForm();
  const allFields = form.acroForm
    .getAllFields()
    .filter(([field]) => !(field instanceof PDFAcroNonTerminal));
  if (allFields.length > MAX_FIELDS) throw new Error("This form exceeds the 10,000-field limit.");
  const names = new Set<string>();
  for (const [field] of allFields) {
    const name = field.getFullyQualifiedName() ?? "";
    if (names.has(name)) throw new Error("This PDF contains duplicate field names.");
    names.add(name);
  }
  const fields = form.getFields();
  const signed = fields.some(
    (field) => field instanceof PDFSignature && field.acroField.dict.has(PDFName.of("V")),
  );
  return { doc, fields, allFields, signed };
}

/** Reads AcroForm values only. Signature, button and unknown field data are never exported. */
export async function readFormData(bytes: Uint8Array): Promise<FormDataReport> {
  const { fields, allFields, signed } = await loadForm(bytes);
  const result: FormDataReport = { fields: [], excluded: [], signed };
  const supportedNames = new Set<string>();
  for (const field of fields) {
    const entry = valueOf(field);
    if (!entry) continue;
    supportedNames.add(entry.name);
    result.fields.push({ ...entry, required: field.isRequired(), readOnly: field.isReadOnly() });
  }
  for (const [field] of allFields) {
    const name = field.getFullyQualifiedName() ?? "";
    if (!supportedNames.has(name)) result.excluded.push({ name, reason: "Unsupported field type" });
  }
  return result;
}

/** Editable fields make the exported JSON safe to import back into the same form. */
export function exportFormDataJson(report: FormDataReport): string {
  const fields = report.fields
    .filter((field) => !field.readOnly)
    .map(({ name, type, value }) => ({ name, type, value }));
  const json = JSON.stringify({ format: "navpdf-form-data", version: 1, fields }, null, 2);
  // The same limits apply in both directions, so exports stay importable.
  parsePayload(json);
  return json;
}

function csvCell(value: string) {
  const trimmed = value.trimStart();
  const safe =
    /^[=+\-@]/u.test(trimmed) ||
    (trimmed.codePointAt(0) ?? Infinity) < 32 ||
    /^[\t\r\n]/u.test(value)
      ? `'${value}`
      : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportFormDataCsv(report: FormDataReport): string {
  const rows = [["Field", "Type", "Value"]];
  for (const field of report.fields.filter((entry) => !entry.readOnly)) {
    const value = Array.isArray(field.value) ? JSON.stringify(field.value) : String(field.value);
    rows.push([field.name, field.type, value]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function findMissingRequiredFields(report: FormDataReport): FormDataField[] {
  return report.fields.filter((field) => {
    if (!field.required) return false;
    if (typeof field.value === "boolean") return !field.value;
    if (Array.isArray(field.value)) return field.value.length === 0;
    return !field.value.trim();
  });
}

function objectWithKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validString(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

function parsePayload(json: string): FormValueEntry[] {
  if (
    json.length > MAX_FORM_DATA_BYTES ||
    new TextEncoder().encode(json).length > MAX_FORM_DATA_BYTES
  )
    throw new Error("Form JSON exceeds the 2 MB limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Choose a valid JSON form data file.");
  }
  if (
    !objectWithKeys(parsed, ["format", "version", "fields"]) ||
    parsed.format !== "navpdf-form-data" ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.fields)
  )
    throw new Error("Expected NavPDF form data JSON version 1.");
  if (parsed.fields.length > MAX_FIELDS)
    throw new Error("Form JSON exceeds the 10,000-field limit.");
  const names = new Set<string>();
  const entries: FormValueEntry[] = [];
  for (const entry of parsed.fields) {
    if (
      !objectWithKeys(entry, ["name", "type", "value"]) ||
      !validString(entry.name, MAX_NAME_LENGTH) ||
      !entry.name.length
    )
      throw new Error("Every form value must have a valid field name, type and value.");
    if (names.has(entry.name)) throw new Error(`Duplicate field "${entry.name}" in form JSON.`);
    names.add(entry.name);
    const { type, value } = entry;
    const text = (type === "text" || type === "radio") && validString(value, MAX_VALUE_LENGTH);
    const checkbox = type === "checkbox" && typeof value === "boolean";
    const choices =
      (type === "dropdown" || type === "list") &&
      Array.isArray(value) &&
      value.length <= MAX_CHOICES &&
      value.every((item) => validString(item, MAX_VALUE_LENGTH)) &&
      new Set(value).size === value.length;
    if (!text && !checkbox && !choices)
      throw new Error(`Invalid type or oversized value for field "${entry.name}".`);
    entries.push({ name: entry.name, type: type as FieldType, value: value as FormValue });
  }
  return entries;
}

function validateValue(field: SupportedField, entry: FormValueEntry) {
  const current = valueOf(field);
  if (entry.type !== current?.type) throw new Error(`Incompatible type for field "${entry.name}".`);
  if (field.isReadOnly()) throw new Error(`Field "${entry.name}" is read-only.`);
  if (field instanceof PDFTextField) {
    const maximum = field.getMaxLength();
    if (maximum !== undefined && (entry.value as string).length > maximum)
      throw new Error(`Field "${entry.name}" exceeds its maximum length of ${maximum}.`);
  }
  if (
    field instanceof PDFRadioGroup &&
    entry.value !== "" &&
    !field.getOptions().includes(entry.value as string)
  )
    throw new Error(`The selected option is not available in field "${entry.name}".`);
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) validateChoices(field, entry);
}

function validateChoices(field: PDFDropdown | PDFOptionList, entry: FormValueEntry) {
  const selected = entry.value as string[];
  if (!field.isMultiselect() && selected.length > 1)
    throw new Error(`Field "${entry.name}" allows only one selected option.`);
  const allowsCustom = field instanceof PDFDropdown && field.isEditable();
  if (!allowsCustom && selected.some((value) => !field.getOptions().includes(value)))
    throw new Error(`The selected option is not available in field "${entry.name}".`);
}

async function prepareImport(bytes: Uint8Array, json: string) {
  const entries = parsePayload(json);
  const loaded = await loadForm(bytes);
  if (loaded.signed)
    throw new Error(
      "This PDF is digitally signed. Changing values would invalidate its signatures.",
    );
  const byName = new Map(loaded.fields.map((field) => [field.getName(), field]));
  const changes = entries.map((entry) => {
    const field = byName.get(entry.name);
    if (!field) throw new Error(`Unknown field "${entry.name}".`);
    if (!valueOf(field)) throw new Error(`Field "${entry.name}" has an unsupported type.`);
    validateValue(field as SupportedField, entry);
    return { field: field as SupportedField, entry };
  });
  const font = await loaded.doc.embedFont(StandardFonts.Helvetica);
  validateDrawability(font, changes);
  return { ...loaded, changes, font };
}

export async function previewFormDataImport(
  bytes: Uint8Array,
  json: string,
): Promise<FormDataPreview[]> {
  const { changes } = await prepareImport(bytes, json);
  return changes.map(({ field, entry }) => ({
    name: entry.name,
    type: entry.type,
    before: valueOf(field)!.value,
    after: entry.value,
  }));
}

function writeValue(field: SupportedField, value: FormValue) {
  if (field instanceof PDFTextField) field.setText(value as string);
  else if (field instanceof PDFCheckBox) {
    if (value) field.check();
    else field.uncheck();
  } else if (field instanceof PDFRadioGroup) {
    if (value) field.select(value as string);
    else field.clear();
  } else if ((value as string[]).length) field.select(value as string[]);
  else field.clear();
}

function validateDrawability(font: PDFFont, changes: { entry: FormValueEntry }[]) {
  // Check drawability before setting any values. Existing non-Latin fields remain untouched.
  for (const { entry } of changes) {
    let strings: string[] = [];
    if (Array.isArray(entry.value)) strings = entry.value;
    else if (typeof entry.value === "string") strings = [entry.value];
    try {
      for (const value of strings) font.encodeText(value.replaceAll(/[\r\n\t]/g, " "));
    } catch {
      throw new Error(`Field "${entry.name}" contains text the built-in PDF font cannot draw.`);
    }
  }
}

async function saveChanges(
  doc: PDFDocument,
  changes: { field: SupportedField; entry: FormValueEntry }[],
) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  validateDrawability(font, changes);
  for (const { field, entry } of changes) {
    writeValue(field, entry.value);
    field.defaultUpdateAppearances(font);
  }
  // Refresh only changed fields, leaving unsupported and read-only appearances intact.
  return doc.save({ updateFieldAppearances: false });
}

/** Validates the complete payload before editing a private document copy. */
export async function importFormData(bytes: Uint8Array, json: string): Promise<Uint8Array> {
  const { doc, changes } = await prepareImport(bytes, json);
  return saveChanges(doc, changes);
}

/** Clears current editable values; does not restore defaults or remove fields. */
export async function resetFormData(bytes: Uint8Array): Promise<Uint8Array> {
  const { doc, fields, signed } = await loadForm(bytes);
  if (signed)
    throw new Error(
      "This PDF is digitally signed. Clearing values would invalidate its signatures.",
    );
  const changes: { field: SupportedField; entry: FormValueEntry }[] = [];
  for (const field of fields) {
    const entry = valueOf(field);
    if (!entry || field.isReadOnly()) continue;
    let value: FormValue = "";
    if (entry.type === "checkbox") value = false;
    else if (entry.type === "dropdown" || entry.type === "list") value = [];
    changes.push({ field: field as SupportedField, entry: { ...entry, value } });
  }
  return saveChanges(doc, changes);
}

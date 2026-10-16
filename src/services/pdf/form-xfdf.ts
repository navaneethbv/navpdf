import { DOMParser, type Element } from "@xmldom/xmldom";
import { PDFCheckBox, PDFDocument } from "pdf-lib";
import {
  exportFormDataJson,
  MAX_FORM_DATA_BYTES,
  readFormData,
  type FormValueEntry,
} from "./form-data";

const NAMESPACE = "http://ns.adobe.com/xfdf/";
const xmlText = (value: string) => {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      throw new Error("A form value contains characters XML cannot represent.");
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
};

async function checkboxValues(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return new Map(
    doc
      .getForm()
      .getFields()
      .flatMap((field) =>
        field instanceof PDFCheckBox
          ? [[field.getName(), field.acroField.getOnValue()?.decodeText() ?? "Yes"] as const]
          : [],
      ),
  );
}

function xfdfValues(field: FormValueEntry, onValues: Map<string, string>): string[] {
  if (typeof field.value === "boolean")
    return [field.value ? (onValues.get(field.name) ?? "Yes") : "Off"];
  return Array.isArray(field.value) ? field.value : [field.value];
}

function plainValues(field: Element): string[] {
  const kids = Array.from(field.children);
  if (
    kids.some(
      (child) =>
        child.namespaceURI !== NAMESPACE || child.localName !== "value" || child.children.length,
    )
  )
    throw new Error("Only plain XFDF field values are supported.");
  return kids.map((child) => child.textContent ?? "");
}

function importedValue(
  target: FormValueEntry,
  values: string[],
  onValues: Map<string, string>,
): FormValueEntry["value"] {
  if (target.type === "list" || target.type === "dropdown") return values;
  const { name } = target;
  if (values.length !== 1) throw new Error(`Field “${name}” needs exactly one value.`);
  if (target.type !== "checkbox") return values[0];
  if (values[0] !== "Off" && values[0] !== onValues.get(name))
    throw new Error(`Field “${name}” has an unknown checkbox state.`);
  return values[0] !== "Off";
}

function* fieldLeaves(
  parent: Element,
  prefix = "",
  depth = 0,
): Generator<{ name: string; field: Element }> {
  if (depth > 32) throw new Error("XFDF field nesting exceeds 32 levels.");
  for (const field of Array.from(parent.children)) {
    if (field.namespaceURI !== NAMESPACE || field.localName !== "field")
      throw new Error("Unsupported XFDF form data element.");
    const part = field.getAttribute("name");
    if (!part || part.length > 1024) throw new Error("Invalid XFDF field name.");
    const name = prefix ? `${prefix}.${part}` : part;
    const kids = Array.from(field.children);
    if (!kids.some((child) => child.localName === "field")) {
      yield { name, field };
      continue;
    }
    if (kids.some((child) => child.localName !== "field"))
      throw new Error("An XFDF field cannot mix values and child fields.");
    yield* fieldLeaves(field, name, depth + 1);
  }
}

/** Standard XFDF values, including the actual on-state of each checkbox. */
export async function exportFormXfdf(bytes: Uint8Array) {
  const report = await readFormData(bytes);
  exportFormDataJson(report);
  const onValues = await checkboxValues(bytes);
  const fields = report.fields
    .filter((field) => !field.readOnly)
    .map((field) => {
      const values = xfdfValues(field, onValues);
      const content = values.map((value) => `<value>${xmlText(value)}</value>`).join("");
      return `<field name="${xmlText(field.name)}">${content}</field>`;
    });
  const xml = `<?xml version="1.0" encoding="UTF-8"?><xfdf xmlns="${NAMESPACE}" xml:space="preserve"><fields>${fields.join("")}</fields></xfdf>`;
  if (new TextEncoder().encode(xml).length > MAX_FORM_DATA_BYTES)
    throw new Error("Form data exceeds the 2 MB limit.");
  return xml;
}

/** Converts a bounded XFDF field tree to the same validated, previewed import contract as JSON. */
export async function formXfdfToJson(bytes: Uint8Array, xml: string) {
  if (new TextEncoder().encode(xml).length > MAX_FORM_DATA_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("XFDF must be under 2 MB and must not contain document types or entities.");
  const parsed = new DOMParser({
    onError: () => {
      throw new Error("Choose a valid XFDF form data file.");
    },
  }).parseFromString(xml, "application/xml");
  const root = parsed.documentElement;
  if (!root || root.localName !== "xfdf" || root.namespaceURI !== NAMESPACE)
    throw new Error("Choose a valid XFDF form data file.");
  const report = await readFormData(bytes);
  const supported = new Map(report.fields.map((field) => [field.name, field]));
  const onValues = await checkboxValues(bytes);
  const entries: FormValueEntry[] = [];
  const seen = new Set<string>();
  const fields = Array.from(root.children).filter(
    (child) => child.localName === "fields" && child.namespaceURI === NAMESPACE,
  );
  if (fields.length !== 1) throw new Error("XFDF must contain one fields element.");
  // Ignore only inert file identity metadata; never import annotations or actions through this path.
  if (
    Array.from(root.children).some(
      (child) =>
        child.namespaceURI !== NAMESPACE || !["fields", "f", "ids"].includes(child.localName ?? ""),
    )
  )
    throw new Error(
      "This file contains more than form data. Use the comment import tool for annotations.",
    );
  for (const { name, field } of fieldLeaves(fields[0])) {
    if (seen.has(name) || entries.length >= 10000)
      throw new Error("Duplicate or excessive XFDF fields.");
    seen.add(name);
    const target = supported.get(name);
    if (!target || target.readOnly)
      throw new Error(`Field “${name}” is missing, unsupported or read-only.`);
    entries.push({
      name,
      type: target.type,
      value: importedValue(target, plainValues(field), onValues),
    });
  }
  return exportFormDataJson({
    fields: entries.map((entry) => ({ ...entry, required: false, readOnly: false })),
    excluded: [],
    signed: report.signed,
  });
}

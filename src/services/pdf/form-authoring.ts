// Form preparation beyond creating fields: names, tooltips, appearance properties, locking,
// copying a field to other pages, page tab order and batch renaming. Edits keep each field's
// value and widgets, and rebuild appearances only where the built-in font can draw them.

import {
  AnnotationFlags,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFHexString,
  PDFTextField,
  StandardFonts,
  TextAlignment,
  type PDFField,
  type PDFForm,
} from "pdf-lib";
import { pdfText } from "./text-string.ts";
import { listWidgets } from "./field-geometry.ts";

type Color = [number, number, number];

export interface FieldProperties {
  name: string;
  kind: "text" | "checkbox" | "radio" | "dropdown" | "listbox" | "button" | "signature" | "other";
  tooltip: string;
  locked: boolean;
  fontSize: number | null;
  alignment: "left" | "center" | "right" | null;
  maxLength: number | null;
  comb: boolean;
  borderColor: Color | null;
  fillColor: Color | null;
  hidden: boolean;
}

export type FieldPropertyChange = Partial<Omit<FieldProperties, "kind">> & {
  /** New fully qualified name; the last segment is renamed. */
  newName?: string;
};

const MAX_TOOLTIP = 1_000;

function kindOf(field: PDFField): FieldProperties["kind"] {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "listbox";
  if (field instanceof PDFButton) return "button";
  return field.acroField.dict.get(PDFName.of("FT")) === PDFName.of("Sig") ? "signature" : "other";
}

function colorOf(value: number[] | undefined): Color | null {
  return value && value.length === 3 ? [value[0], value[1], value[2]] : null;
}

function textOf(dict: PDFDict, key: string) {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

/** Font size from the field's default appearance string, if one is set. */
function fontSizeOf(field: PDFField): number | null {
  const da = textOf(field.acroField.dict, "DA");
  const match = /([\d.]+)\s+Tf/.exec(da);
  return match ? Number(match[1]) : null;
}

export function describeField(field: PDFField): FieldProperties {
  const widget = field.acroField.getWidgets()[0];
  const characteristics = widget?.getAppearanceCharacteristics();
  const text = field instanceof PDFTextField ? field : null;
  const alignment = text?.getAlignment();
  return {
    name: field.getName(),
    kind: kindOf(field),
    tooltip: textOf(field.acroField.dict, "TU"),
    locked: !!widget?.hasFlag(AnnotationFlags.Locked),
    fontSize: fontSizeOf(field),
    alignment:
      alignment === undefined
        ? null
        : ((["left", "center", "right"] as const)[alignment as number] ?? "left"),
    maxLength: text?.getMaxLength() ?? null,
    comb: !!text?.isCombed(),
    borderColor: colorOf(characteristics?.getBorderColor()),
    fillColor: colorOf(characteristics?.getBackgroundColor()),
    hidden: !!widget?.hasFlag(AnnotationFlags.Hidden),
  };
}

export async function readFieldProperties(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getForm().getFields().map(describeField);
}

function validColor(value: Color | null | undefined) {
  return (
    value === null ||
    value === undefined ||
    value.every((c) => Number.isFinite(c) && c >= 0 && c <= 1)
  );
}

function requireField(form: PDFForm, name: string) {
  const field = form.getFieldMaybe(name);
  if (!field) throw new Error(`Form field "${name}" was not found.`);
  return field;
}

function rename(form: PDFForm, field: PDFField, newName: string) {
  const parts = newName.split(".");
  const last = parts.at(-1) ?? "";
  if (!/^[^.]{1,128}$/.test(last) || parts.some((part) => !part))
    throw new Error("Field names need 1 to 128 characters per segment and no empty segments.");
  const prefix = field.getName().split(".").slice(0, -1).join(".");
  const expected = prefix ? `${prefix}.${last}` : last;
  if (newName !== expected && newName !== last)
    throw new Error("Only the last part of a hierarchical field name can be renamed.");
  if (expected !== field.getName() && form.getFieldMaybe(expected))
    throw new Error(`A form field named "${expected}" already exists.`);
  field.acroField.setPartialName(last);
}

function applyAppearanceProperties(field: PDFField, change: FieldPropertyChange) {
  for (const widget of field.acroField.getWidgets()) {
    const mk = widget.getOrCreateAppearanceCharacteristics();
    if (change.borderColor !== undefined) {
      if (change.borderColor) mk.setBorderColor(change.borderColor);
      else mk.dict.delete(PDFName.of("BC"));
    }
    if (change.fillColor !== undefined) {
      if (change.fillColor) mk.setBackgroundColor(change.fillColor);
      else mk.dict.delete(PDFName.of("BG"));
    }
    if (change.locked !== undefined) widget.setFlagTo(AnnotationFlags.Locked, change.locked);
    if (change.hidden !== undefined) {
      widget.setFlagTo(AnnotationFlags.Hidden, change.hidden);
      widget.setFlagTo(AnnotationFlags.Print, !change.hidden);
    }
  }
}

function applyTextProperties(field: PDFField, change: FieldPropertyChange) {
  if (!(field instanceof PDFTextField)) return;
  if (change.alignment) {
    const value = {
      left: TextAlignment.Left,
      center: TextAlignment.Center,
      right: TextAlignment.Right,
    };
    field.setAlignment(value[change.alignment]);
  }
  if (change.comb !== undefined) {
    if (change.comb) {
      const max = change.maxLength ?? field.getMaxLength();
      if (!max) throw new Error("Set a maximum length before spacing characters into boxes.");
      field.setMaxLength(max);
      field.enableCombing();
    } else field.disableCombing();
  }
  if (change.maxLength !== undefined) {
    if (change.maxLength !== null && (!Number.isInteger(change.maxLength) || change.maxLength < 1))
      throw new Error("The maximum length must be a whole number of at least 1.");
    if ((field.getText()?.length ?? 0) > (change.maxLength ?? Infinity))
      throw new Error("The current value is longer than the new maximum length.");
    field.setMaxLength(change.maxLength ?? undefined);
  }
}

/** Updates one field's name, tooltip, appearance and behaviour flags as a single edit. */
export async function updateFieldProperties(
  bytes: Uint8Array,
  name: string,
  change: FieldPropertyChange,
): Promise<{ bytes: Uint8Array; appearanceRebuilt: boolean }> {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const field = requireField(form, name);
  if (change.tooltip !== undefined && change.tooltip.length > MAX_TOOLTIP)
    throw new Error("The tooltip is too long.");
  if (!validColor(change.borderColor) || !validColor(change.fillColor))
    throw new Error("Colors must use channels from 0 to 1.");
  if (
    change.fontSize !== undefined &&
    change.fontSize !== null &&
    (!Number.isFinite(change.fontSize) || change.fontSize < 0 || change.fontSize > 144)
  )
    throw new Error("Font size must be from 0 (automatic) to 144 points.");
  if (change.newName !== undefined && change.newName !== field.getName())
    rename(form, field, change.newName.trim());
  if (change.tooltip !== undefined) {
    // TU belongs to the field, but some readers only look at the widget, so set both.
    const dicts = [
      field.acroField.dict,
      ...field.acroField.getWidgets().map((widget) => widget.dict),
    ];
    for (const dict of new Set(dicts)) {
      if (change.tooltip) dict.set(PDFName.of("TU"), pdfText(change.tooltip));
      else dict.delete(PDFName.of("TU"));
    }
  }
  applyAppearanceProperties(field, change);
  applyTextProperties(field, change);
  if (change.fontSize !== undefined && change.fontSize !== null) {
    if (
      field instanceof PDFTextField ||
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList ||
      field instanceof PDFButton
    )
      field.setFontSize(change.fontSize);
  }
  let appearanceRebuilt = true;
  try {
    field.defaultUpdateAppearances(await doc.embedFont(StandardFonts.Helvetica));
  } catch {
    // Values outside the built-in font keep their appearance; readers rebuild it.
    appearanceRebuilt = false;
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(true));
  }
  return { bytes: await doc.save(), appearanceRebuilt };
}

/**
 * Adds a widget for the field on each chosen page at the same position as its first widget.
 * All widgets share one value, as Acrobat's "Duplicate across pages" does.
 */
export async function duplicateFieldToPages(bytes: Uint8Array, name: string, pages: number[]) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const field = requireField(form, name);
  const source = listWidgets(doc).find(
    (widget) => widget.field === field.getName() && widget.widget === 0,
  );
  if (!source) throw new Error("The field is not placed on a page.");
  const rect = field.acroField.getWidgets()[0].getRectangle();
  const targets = [...new Set(pages)].filter(
    (index) => index >= 0 && index < doc.getPageCount() && index !== source.page - 1,
  );
  if (!targets.length) throw new Error("Choose at least one other page.");
  const options = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  for (const index of targets) {
    const page = doc.getPage(index);
    if (field instanceof PDFTextField || field instanceof PDFCheckBox)
      field.addToPage(page, options);
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList)
      field.addToPage(page, options);
    else if (field instanceof PDFButton) field.addToPage("", page, options);
    else throw new Error("Radio groups and signature fields cannot be duplicated across pages.");
  }
  return doc.save();
}

export type TabOrder = "R" | "C" | "S" | null;

/** Sets the keyboard order of fields and links on every page: rows, columns or structure. */
export async function setTabOrder(bytes: Uint8Array, order: TabOrder) {
  if (order !== null && !["R", "C", "S"].includes(order)) throw new Error("Choose a tab order.");
  const doc = await PDFDocument.load(bytes);
  for (const page of doc.getPages()) {
    if (order) page.node.set(PDFName.of("Tabs"), PDFName.of(order));
    else page.node.delete(PDFName.of("Tabs"));
  }
  return doc.save();
}

export async function readTabOrder(bytes: Uint8Array): Promise<TabOrder | "mixed"> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const values = new Set(
    doc.getPages().map((page) => {
      const tabs = page.node.lookup(PDFName.of("Tabs"));
      return tabs instanceof PDFName ? tabs.decodeText() : null;
    }),
  );
  if (values.size > 1) return "mixed";
  const [value] = values;
  return value === "R" || value === "C" || value === "S" ? value : null;
}

/** Renames several fields at once; every new name must be unused afterwards. */
export async function renameFields(bytes: Uint8Array, renames: { from: string; to: string }[]) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const finalNames = new Set(form.getFields().map((field) => field.getName()));
  for (const { from, to } of renames) {
    const field = requireField(form, from);
    const name = to.trim();
    finalNames.delete(from);
    if (finalNames.has(name)) throw new Error(`A form field named "${name}" already exists.`);
    rename(form, field, name);
    finalNames.add(field.getName());
  }
  return doc.save();
}

/** Parses "#rrggbb" into PDF color channels. */
export function colorFromHex(hex: string): Color | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return match
    ? ([1, 2, 3].map((index) => Number.parseInt(match[index], 16) / 255) as Color)
    : null;
}

export function hexFromColor(color: Color | null) {
  if (!color) return "";
  return `#${color
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

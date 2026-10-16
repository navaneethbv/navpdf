// Moving and resizing existing form field widgets. Positions are expressed as displayed on the
// page (origin at the top-left, in points) so rotated pages behave as users expect.

import { mapInOrder } from "../../utils/async-sequence.ts";
import {
  PDFDocument,
  PDFName,
  PDFRef,
  StandardFonts,
  type PDFField,
  type PDFPage,
  type PDFWidgetAnnotation,
} from "pdf-lib";
import { fromTopLeftVisual, toTopLeftVisual, visibleBox } from "./page-box.ts";

export interface WidgetGeometry {
  field: string;
  /** Index of the widget within its field; radio groups and repeated fields have several. */
  widget: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 4;

function pageOfWidget(doc: PDFDocument, widget: PDFWidgetAnnotation, ref: PDFRef | undefined) {
  const pages = doc.getPages();
  const direct = widget.P();
  const byParent = direct ? pages.findIndex((page) => page.ref === direct) : -1;
  if (byParent >= 0) return byParent;
  return pages.findIndex((page) =>
    (page.node.Annots()?.asArray() ?? []).some(
      (item) =>
        (item instanceof PDFRef && item === ref) || doc.context.lookup(item) === widget.dict,
    ),
  );
}

function widgetRefs(doc: PDFDocument, field: PDFField) {
  const kids = field.acroField.normalizedEntries().Kids;
  const refs = kids ? kids.asArray().filter((item): item is PDFRef => item instanceof PDFRef) : [];
  return field.acroField.getWidgets().map((widget) => {
    const ref = refs.find((item) => doc.context.lookup(item) === widget.dict);
    return ref ?? doc.context.getObjectRef(widget.dict);
  });
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

/** Every widget of every field with its page and displayed rectangle. */
export function listWidgets(doc: PDFDocument): WidgetGeometry[] {
  const result: WidgetGeometry[] = [];
  for (const field of doc.getForm().getFields()) {
    const refs = widgetRefs(doc, field);
    for (const [index, widget] of field.acroField.getWidgets().entries()) {
      const pageIndex = pageOfWidget(doc, widget, refs[index]);
      if (pageIndex < 0) continue;
      const shown = toTopLeftVisual(doc.getPage(pageIndex), widget.getRectangle());
      result.push({
        field: field.getName(),
        widget: index,
        page: pageIndex + 1,
        x: rounded(shown.x),
        y: rounded(shown.y),
        width: rounded(shown.width),
        height: rounded(shown.height),
      });
    }
  }
  return result;
}

export async function readWidgets(pdfBytes: Uint8Array) {
  return listWidgets(await PDFDocument.load(pdfBytes));
}

function displayedSize(page: PDFPage) {
  const box = visibleBox(page);
  const quarter = box.rotation === 90 || box.rotation === 270;
  return quarter
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/**
 * Rebuilds a resized field's appearance on an unrotated page. Rotated widgets keep their
 * appearance, which readers scale, and the form asks readers to rebuild appearances.
 */
async function refreshAppearance(
  doc: PDFDocument,
  field: PDFField,
  widget: PDFWidgetAnnotation,
  page: PDFPage,
) {
  const rotated =
    visibleBox(page).rotation !== 0 ||
    Boolean(widget.getAppearanceCharacteristics()?.getRotation());
  if (!rotated) {
    try {
      field.defaultUpdateAppearances(await doc.embedFont(StandardFonts.Helvetica));
      return true;
    } catch {
      // Values the built-in font cannot draw keep their current appearance.
    }
  }
  doc.getForm().acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(true));
  return false;
}

/** Moves or resizes one widget in `doc`; returns whether its appearance was rebuilt. */
async function placeWidget(doc: PDFDocument, target: Omit<WidgetGeometry, "page">) {
  const field = doc.getForm().getFieldMaybe(target.field);
  if (!field) throw new Error(`Form field "${target.field}" was not found.`);
  const widget = field.acroField.getWidgets()[target.widget];
  if (!widget) throw new Error(`Form field "${target.field}" has no widget ${target.widget + 1}.`);
  const values = [target.x, target.y, target.width, target.height];
  if (!values.every((value) => Number.isFinite(value)))
    throw new Error("Enter numbers for the position and size.");
  if (target.width < MIN_SIZE || target.height < MIN_SIZE)
    throw new Error(`Fields must be at least ${MIN_SIZE} points wide and high.`);
  const pageIndex = pageOfWidget(doc, widget, widgetRefs(doc, field)[target.widget]);
  if (pageIndex < 0) throw new Error("The field is not placed on a page.");
  const page = doc.getPage(pageIndex);
  const shown = displayedSize(page);
  if (target.width > shown.width || target.height > shown.height)
    throw new Error("The field would be larger than the page.");

  const before = widget.getRectangle();
  const rect = fromTopLeftVisual(page, target.x, target.y, target.width, target.height);
  widget.setRectangle(rect);
  const resized =
    Math.abs(before.width - rect.width) > 0.01 || Math.abs(before.height - rect.height) > 0.01;
  const rebuilt = resized ? await refreshAppearance(doc, field, widget, page) : true;
  // Record the page so later edits find the widget directly.
  if (!(widget.dict.get(PDFName.of("P")) instanceof PDFRef))
    widget.dict.set(PDFName.of("P"), page.ref);
  return rebuilt;
}

/**
 * Moves or resizes one widget, keeping it inside the visible page. Returns the new bytes and
 * whether the field appearance had to be scaled instead of rebuilt.
 */
export async function setWidgetGeometry(
  pdfBytes: Uint8Array,
  target: Omit<WidgetGeometry, "page">,
): Promise<{ bytes: Uint8Array; scaledAppearance: boolean }> {
  const doc = await PDFDocument.load(pdfBytes);
  const rebuilt = await placeWidget(doc, target);
  return { bytes: await doc.save(), scaledAppearance: !rebuilt };
}

export type ArrangeOperation =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "center-horizontal"
  | "center-vertical"
  | "distribute-horizontal"
  | "distribute-vertical"
  | "match-width"
  | "match-height"
  | "match-size";

type Box = Pick<WidgetGeometry, "x" | "y" | "width" | "height">;

/**
 * New displayed rectangles for widgets on one page. The first widget is the anchor that the
 * others align to or match; distributing keeps the outermost widgets and spaces the rest
 * with equal gaps between them.
 */
export function arrangedGeometry(widgets: WidgetGeometry[], operation: ArrangeOperation) {
  const [anchor] = widgets;
  if (!anchor) return [];
  const result: WidgetGeometry[] = widgets.map((widget) => ({ ...widget }));
  const set = (change: (item: Box) => Partial<Box>) =>
    result.forEach((item, index) => index > 0 && Object.assign(item, change(item)));
  switch (operation) {
    case "left":
      set(() => ({ x: anchor.x }));
      break;
    case "right":
      set((item) => ({ x: anchor.x + anchor.width - item.width }));
      break;
    case "top":
      set(() => ({ y: anchor.y }));
      break;
    case "bottom":
      set((item) => ({ y: anchor.y + anchor.height - item.height }));
      break;
    case "center-horizontal":
      set((item) => ({ x: anchor.x + (anchor.width - item.width) / 2 }));
      break;
    case "center-vertical":
      set((item) => ({ y: anchor.y + (anchor.height - item.height) / 2 }));
      break;
    case "match-width":
      set(() => ({ width: anchor.width }));
      break;
    case "match-height":
      set(() => ({ height: anchor.height }));
      break;
    case "match-size":
      set(() => ({ width: anchor.width, height: anchor.height }));
      break;
    case "distribute-horizontal":
    case "distribute-vertical": {
      const [start, size] =
        operation === "distribute-horizontal"
          ? (["x", "width"] as const)
          : (["y", "height"] as const);
      const ordered = [...result].sort((a, b) => a[start] - b[start]);
      const first = ordered[0];
      const last = ordered.at(-1)!;
      const span = last[start] + last[size] - first[start];
      const used = ordered.reduce((total, item) => total + item[size], 0);
      const gap = ordered.length > 1 ? (span - used) / (ordered.length - 1) : 0;
      let position = first[start];
      for (const item of ordered) {
        item[start] = position;
        position += item[size] + gap;
      }
      break;
    }
  }
  return result.map((item) => ({
    ...item,
    x: rounded(item.x),
    y: rounded(item.y),
    width: rounded(item.width),
    height: rounded(item.height),
  }));
}

/** Aligns, distributes or sizes widgets on one page as a single edit. */
export async function arrangeWidgets(
  pdfBytes: Uint8Array,
  targets: Pick<WidgetGeometry, "field" | "widget">[],
  operation: ArrangeOperation,
): Promise<{ bytes: Uint8Array; scaledAppearance: boolean }> {
  const minimum = operation.startsWith("distribute") ? 3 : 2;
  if (targets.length < minimum)
    throw new Error(`Choose at least ${minimum} fields for this arrangement.`);
  const doc = await PDFDocument.load(pdfBytes);
  const all = listWidgets(doc);
  const chosen = targets.map((target) => {
    const found = all.find((item) => item.field === target.field && item.widget === target.widget);
    if (!found) throw new Error(`Form field "${target.field}" was not found on a page.`);
    return found;
  });
  if (new Set(chosen.map((item) => item.page)).size > 1)
    throw new Error("Arrange fields that are on the same page.");
  let scaled = false;
  for await (const rebuilt of mapInOrder(arrangedGeometry(chosen, operation), (target) =>
    placeWidget(doc, target),
  )) {
    scaled ||= !rebuilt;
  }
  return { bytes: await doc.save(), scaledAppearance: scaled };
}

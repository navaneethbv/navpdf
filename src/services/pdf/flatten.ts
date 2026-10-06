// Flattening draws annotation and form widget appearances into page content and removes the
// interactive objects, so every reader shows the same fixed result and fields can no longer be
// edited. Flattening is not redaction: flattened content stays in the file and remains
// selectable where it contains text.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFPage,
} from "pdf-lib";
import { annotationRect, generateAppearance } from "./annotation-appearance.ts";

export interface FlattenOptions {
  annotations: boolean;
  forms: boolean;
}

export interface FlattenReport {
  annotations: number;
  /** Form field widgets drawn into the page; a field can have several. */
  widgets: number;
  /** Annotations left interactive: hidden ones and those whose appearance could not be drawn. */
  skipped: number;
}

/** Flags 2 (Hidden) and 32 (NoView) keep an annotation out of the displayed page. */
const INVISIBLE_FLAGS = 2 | 32;
/** Links and popups are navigation or containers, not page markings. */
const NEVER_DRAWN = new Set(["Link", "Popup"]);

type Matrix = [number, number, number, number, number, number];

function numbers(dict: PDFDict, key: string, fallback: number[]) {
  const value = dict.lookup(PDFName.of(key));
  if (!(value instanceof PDFArray)) return fallback;
  return value.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : 0));
}

function transformPoint([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}

/**
 * The matrix that maps a form's transformed bounding box onto the annotation rectangle,
 * following the appearance algorithm in ISO 32000 section 12.5.5.
 */
export function placementMatrix(
  bbox: number[],
  matrix: number[],
  rect: [number, number, number, number],
): Matrix | null {
  const form = matrix.length === 6 ? (matrix as Matrix) : [1, 0, 0, 1, 0, 0];
  const corners = [
    transformPoint(form as Matrix, bbox[0], bbox[1]),
    transformPoint(form as Matrix, bbox[2], bbox[1]),
    transformPoint(form as Matrix, bbox[0], bbox[3]),
    transformPoint(form as Matrix, bbox[2], bbox[3]),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!(width > 0 && height > 0)) return null;
  const sx = (rect[2] - rect[0]) / width;
  const sy = (rect[3] - rect[1]) / height;
  return [sx, 0, 0, sy, rect[0] - Math.min(...xs) * sx, rect[1] - Math.min(...ys) * sy];
}

/** The normal appearance stream, choosing the state named by /AS for multi-state widgets. */
function normalAppearance(doc: PDFDocument, annotation: PDFDict): PDFRef | null {
  const appearances = annotation.lookup(PDFName.of("AP"));
  if (!(appearances instanceof PDFDict)) return null;
  const normal = appearances.get(PDFName.of("N"));
  const resolved = normal instanceof PDFRef ? doc.context.lookup(normal) : normal;
  if (resolved instanceof PDFStream && normal instanceof PDFRef) return normal;
  if (!(resolved instanceof PDFDict)) return null;
  const state = annotation.get(PDFName.of("AS"));
  const chosen = state instanceof PDFName ? resolved.get(state) : undefined;
  return chosen instanceof PDFRef && doc.context.lookup(chosen) instanceof PDFStream
    ? chosen
    : null;
}

function subtypeOf(annotation: PDFDict) {
  const subtype = annotation.get(PDFName.of("Subtype"));
  return subtype instanceof PDFName ? subtype.decodeText() : "";
}

function shouldFlatten(annotation: PDFDict, options: FlattenOptions) {
  const subtype = subtypeOf(annotation);
  if (NEVER_DRAWN.has(subtype)) return false;
  return subtype === "Widget" ? options.forms : options.annotations;
}

function isInvisible(annotation: PDFDict) {
  const flags = annotation.lookup(PDFName.of("F"));
  return flags instanceof PDFNumber && (flags.asNumber() & INVISIBLE_FLAGS) !== 0;
}

/** Draws one appearance onto the page and returns the operators, or null when impossible. */
function drawOperation(doc: PDFDocument, page: PDFPage, annotation: PDFDict): string | null {
  const rect = annotationRect(annotation);
  if (!rect) return null;
  const appearance = normalAppearance(doc, annotation) ?? generateAppearance(doc, annotation);
  if (!appearance) return null;
  const stream = doc.context.lookup(appearance, PDFStream);
  const bbox = numbers(stream.dict, "BBox", []);
  if (bbox.length !== 4) return null;
  const placement = placementMatrix(bbox, numbers(stream.dict, "Matrix", []), rect);
  if (!placement) return null;
  const name = page.node.newXObject("NavFlat", appearance);
  const values = placement.map((value) => Number(value.toFixed(6))).join(" ");
  return `q ${values} cm ${name.asString()} Do Q`;
}

function popupOf(annotation: PDFDict) {
  const popup = annotation.get(PDFName.of("Popup"));
  return popup instanceof PDFRef ? popup : null;
}

function flattenPage(doc: PDFDocument, page: PDFPage, options: FlattenOptions): FlattenReport {
  const report: FlattenReport = { annotations: 0, widgets: 0, skipped: 0 };
  const annots = page.node.Annots();
  if (!annots) return report;
  const drawn: string[] = [];
  const removed = new Set<string>();
  for (const ref of annots.asArray()) {
    if (!(ref instanceof PDFRef)) continue;
    const annotation = doc.context.lookup(ref);
    if (!(annotation instanceof PDFDict) || !shouldFlatten(annotation, options)) continue;
    const widget = subtypeOf(annotation) === "Widget";
    const hidden = isInvisible(annotation);
    // A hidden widget disappears with its form; a hidden comment is left for the reviewer.
    const operation = hidden ? null : drawOperation(doc, page, annotation);
    if (!operation && !(hidden && widget)) {
      report.skipped++;
      continue;
    }
    if (operation) drawn.push(operation);
    removed.add(ref.toString());
    const popup = popupOf(annotation);
    if (popup) removed.add(popup.toString());
    if (widget) report.widgets++;
    else report.annotations++;
  }
  if (!removed.size) return report;
  if (drawn.length) isolateAndAppend(doc, page, drawn);
  const kept = annots.asArray().filter((ref) => !removed.has(ref.toString()));
  if (kept.length) page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
  else page.node.delete(PDFName.of("Annots"));
  return report;
}

function isolateAndAppend(doc: PDFDocument, page: PDFPage, drawn: string[]) {
  // Existing content is isolated so a stray transformation cannot misplace flattened marks.
  const open = doc.context.register(doc.context.stream("q"));
  const close = doc.context.register(doc.context.stream(`Q\n${drawn.join("\n")}`));
  const contents = page.node.Contents();
  const existing =
    contents instanceof PDFArray
      ? contents.asArray()
      : [page.node.get(PDFName.of("Contents"))].filter(Boolean);
  page.node.set(PDFName.of("Contents"), doc.context.obj([open, ...existing, close]));
}

function hasSignedSignature(doc: PDFDocument) {
  return doc
    .getForm()
    .getFields()
    .some(
      (field) =>
        field.acroField.dict.get(PDFName.of("FT")) === PDFName.of("Sig") &&
        field.acroField.dict.get(PDFName.of("V")) !== undefined,
    );
}

/** Gives fields that lack appearances a generated one so their values are not lost. */
function completeFieldAppearances(doc: PDFDocument) {
  const form = doc.getForm();
  const missing = form
    .getFields()
    .filter((field) => field.acroField.getWidgets().some((widget) => !widget.getAppearances()));
  if (!missing.length) return;
  try {
    form.updateFieldAppearances();
  } catch {
    throw new Error(
      `Form fields such as "${missing[0].getName()}" have no appearance and could not be drawn.`,
    );
  }
}

/** Flattens annotations, form fields or both throughout the document. */
export async function flattenDocument(
  pdfBytes: Uint8Array,
  options: FlattenOptions,
): Promise<{ bytes: Uint8Array; report: FlattenReport }> {
  if (!options.annotations && !options.forms) throw new Error("Choose what to flatten.");
  const doc = await PDFDocument.load(pdfBytes);
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (options.forms && acroForm instanceof PDFDict) {
    if (acroForm.get(PDFName.of("XFA")))
      throw new Error("XFA forms cannot be flattened. Flatten them in the authoring application.");
    if (hasSignedSignature(doc))
      throw new Error("This PDF is digitally signed. Flattening would invalidate the signature.");
    completeFieldAppearances(doc);
  }
  const report: FlattenReport = { annotations: 0, widgets: 0, skipped: 0 };
  for (const page of doc.getPages()) {
    const pageReport = flattenPage(doc, page, options);
    report.annotations += pageReport.annotations;
    report.widgets += pageReport.widgets;
    report.skipped += pageReport.skipped;
  }
  if (options.forms && acroForm instanceof PDFDict) {
    if (report.skipped && hasRemainingWidgets(doc))
      throw new Error("Some form fields could not be drawn, so the form was left unchanged.");
    doc.catalog.delete(PDFName.of("AcroForm"));
  }
  if (!report.annotations && !report.widgets) throw new Error("There is nothing to flatten.");
  return { bytes: await doc.save(), report };
}

function hasRemainingWidgets(doc: PDFDocument) {
  return doc.getPages().some((page) =>
    (page.node.Annots()?.asArray() ?? []).some((ref) => {
      const annotation = doc.context.lookup(ref);
      return annotation instanceof PDFDict && subtypeOf(annotation) === "Widget";
    }),
  );
}

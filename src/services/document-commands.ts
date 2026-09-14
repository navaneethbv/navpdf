import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  PDFDict,
  PDFNumber,
  PDFRadioGroup,
  PDFArray,
  PDFRef,
  PDFObject,
  StandardFonts,
  rgb,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import type { ShapeKind } from "../types/document";
import type {
  MergeInputItem,
  OperationManifestItem,
  OcrPageResult,
} from "../types/operations";

export type TextMarkupKind = "Highlight" | "Underline" | "StrikeOut";

export interface TextMarkupQuad {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextMarkupInput {
  page: number;
  quads: TextMarkupQuad[];
  contents?: string;
  color?: [number, number, number];
  opacity?: number;
  author?: string;
  id?: string;
}

const finite = (value: number) => Number.isFinite(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const annotationId = (() => {
  let sequence = 0;
  return () => {
    sequence++;
    return `navpdf-annotation-${Date.now()}-${sequence}`;
  };
})();

/** Add interoperable text markup annotations without rebuilding page content. */
export async function addTextMarkupAnnotations(
  pdfBytes: Uint8Array,
  kind: TextMarkupKind,
  inputs: TextMarkupInput[],
): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error("At least one text markup is required.");
  const doc = await PDFDocument.load(pdfBytes);
  let added = 0;
  for (const input of inputs) {
    const pageIndex = input.page - 1;
    if (pageIndex < 0 || pageIndex >= doc.getPageCount()) continue;
    const page = doc.getPage(pageIndex);
    const { width, height } = page.getSize();
    const quads = input.quads
      .filter(
        (quad) =>
          [quad.x1, quad.y1, quad.x2, quad.y2].every(finite) &&
          quad.x2 > quad.x1 &&
          quad.y2 > quad.y1,
      )
      .map((quad) => ({
        x1: clamp(quad.x1, 0, width),
        y1: clamp(quad.y1, 0, height),
        x2: clamp(quad.x2, 0, width),
        y2: clamp(quad.y2, 0, height),
      }))
      .filter((quad) => quad.x2 > quad.x1 && quad.y2 > quad.y1);
    if (quads.length === 0) continue;

    const rect = [
      Math.min(...quads.map((quad) => quad.x1)),
      Math.min(...quads.map((quad) => quad.y1)),
      Math.max(...quads.map((quad) => quad.x2)),
      Math.max(...quads.map((quad) => quad.y2)),
    ];
    const quadPoints = quads.flatMap((quad) => [
      quad.x1,
      quad.y2,
      quad.x2,
      quad.y2,
      quad.x1,
      quad.y1,
      quad.x2,
      quad.y1,
    ]);
    const color = input.color ?? [0.96, 0.81, 0.35];
    const opacity = clamp(input.opacity ?? 1, 0, 1);
    const context = doc.context;
    const annotation = context.obj({
      Type: "Annot",
      Subtype: kind,
      Rect: rect,
      QuadPoints: quadPoints,
      C: color,
      CA: opacity,
      F: 4,
      NM: PDFString.of(input.id ?? annotationId()),
      T: PDFString.of(input.author ?? "NavPDF"),
      Contents: PDFString.of(input.contents ?? ""),
    });
    page.node.addAnnot(context.register(annotation));
    added++;
  }
  if (added === 0) throw new Error("Text markup geometry is outside the document.");
  return doc.save();
}

export interface StickyNoteInput {
  page: number;
  x: number;
  y: number;
  size?: number;
  contents: string;
  color?: [number, number, number];
  author?: string;
  id?: string;
}

/** Add a standard /Text annotation with a stable local name. */
export async function addStickyNote(
  pdfBytes: Uint8Array,
  input: StickyNoteInput,
): Promise<Uint8Array> {
  if (!input.contents.trim()) throw new Error("A sticky note needs some text.");
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = input.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount())
    throw new Error("Sticky note page is outside the document.");
  if (![input.x, input.y].every(finite))
    throw new Error("Sticky note position is invalid.");
  const page = doc.getPage(pageIndex);
  const { width, height } = page.getSize();
  const size = clamp(input.size ?? 24, 12, 64);
  const x = clamp(input.x, 0, Math.max(0, width - size));
  const y = clamp(input.y, size, height);
  const context = doc.context;
  const annotation = context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [x, y - size, x + size, y],
    C: input.color ?? [0.96, 0.81, 0.35],
    F: 4,
    Name: "Comment",
    Open: false,
    NM: PDFString.of(input.id ?? annotationId()),
    T: PDFString.of(input.author ?? "NavPDF"),
    Contents: PDFString.of(input.contents.trim()),
  });
  page.node.addAnnot(context.register(annotation));
  return doc.save();
}

export interface ShapeInput {
  page: number;
  kind: ShapeKind;
  start: [number, number];
  end: [number, number];
  color?: [number, number, number];
  width?: number;
  opacity?: number;
  author?: string;
  id?: string;
}

/** Add standard PDF square, circle, and line annotations for drawn shapes. */
export async function addShapeAnnotation(
  pdfBytes: Uint8Array,
  input: ShapeInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = input.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount())
    throw new Error("Shape page is outside the document.");
  if (![...input.start, ...input.end].every(finite))
    throw new Error("Shape geometry is invalid.");
  const page = doc.getPage(pageIndex);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const clampPoint = ([x, y]: [number, number]): [number, number] => [
    clamp(x, 0, pageWidth),
    clamp(y, 0, pageHeight),
  ];
  const start = clampPoint(input.start);
  const end = clampPoint(input.end);
  if (start[0] === end[0] && start[1] === end[1])
    throw new Error("Shape must have a visible size.");
  const color = (input.color ?? [0.15, 0.38, 0.29]).map((channel) =>
    clamp(channel, 0, 1),
  );
  const lineWidth = clamp(input.width ?? 2, 0.5, 20);
  const opacity = clamp(input.opacity ?? 1, 0, 1);
  const margin = lineWidth / 2 + 2;
  const minX = clamp(Math.min(start[0], end[0]) - margin, 0, pageWidth);
  const minY = clamp(Math.min(start[1], end[1]) - margin, 0, pageHeight);
  const maxX = clamp(Math.max(start[0], end[0]) + margin, 0, pageWidth);
  const maxY = clamp(Math.max(start[1], end[1]) + margin, 0, pageHeight);
  const context = doc.context;
  const isLine = input.kind === "Line" || input.kind === "Arrow";
  const annotation = context.obj({
    Type: "Annot",
    Subtype: isLine ? "Line" : input.kind,
    Rect: [minX, minY, maxX, maxY],
    C: color,
    CA: opacity,
    F: 4,
    BS: { W: lineWidth, S: "S" },
    NM: PDFString.of(input.id ?? annotationId()),
    T: PDFString.of(input.author ?? "NavPDF"),
    Contents: PDFString.of(""),
    ...(isLine
      ? {
          L: [start[0], start[1], end[0], end[1]],
          LE: ["None", input.kind === "Arrow" ? "OpenArrow" : "None"],
        }
      : {}),
  });
  page.node.addAnnot(context.register(annotation));
  return doc.save();
}

export interface AnnotationUpdateInput {
  id: string;
  rect?: [number, number, number, number];
  line?: [number, number, number, number];
  color?: [number, number, number];
  width?: number;
  opacity?: number;
  contents?: string;
}

function annotationIdentifier(value: { toString(): string }) {
  return value.toString().replace(/\s+0\s+R$/, "R");
}

function findAnnotation(doc: PDFDocument, id: string) {
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex++) {
    const page = doc.getPage(pageIndex);
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index++) {
      const entry = annots.get(index);
      const annotation = annots.lookup(index, PDFDict);
      const name = annotation.lookupMaybe(
        PDFName.of("NM"),
        PDFString,
        PDFHexString,
      );
      if (
        annotationIdentifier(entry) === id ||
        name?.asString() === id
      )
        return { page, annots, index, annotation };
    }
  }
  return null;
}

/** Update the persisted geometry and drawing properties of one annotation. */
export async function updateAnnotation(
  pdfBytes: Uint8Array,
  input: AnnotationUpdateInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const found = findAnnotation(doc, input.id);
  if (!found) throw new Error("The selected annotation no longer exists.");
  const { width: pageWidth, height: pageHeight } = found.page.getSize();
  const context = doc.context;
  if (input.rect) {
    if (!input.rect.every(finite)) throw new Error("Annotation geometry is invalid.");
    const [x1, y1, x2, y2] = input.rect;
    const left = clamp(Math.min(x1, x2), 0, pageWidth);
    const bottom = clamp(Math.min(y1, y2), 0, pageHeight);
    const right = clamp(Math.max(x1, x2), 0, pageWidth);
    const top = clamp(Math.max(y1, y2), 0, pageHeight);
    if (right <= left || top <= bottom)
      throw new Error("Annotation must have a visible size.");
    found.annotation.set(PDFName.of("Rect"), context.obj([left, bottom, right, top]));
  }
  if (input.line) {
    if (!input.line.every(finite)) throw new Error("Annotation line is invalid.");
    const [x1, y1, x2, y2] = input.line;
    const start: [number, number] = [
      clamp(x1, 0, pageWidth),
      clamp(y1, 0, pageHeight),
    ];
    const end: [number, number] = [
      clamp(x2, 0, pageWidth),
      clamp(y2, 0, pageHeight),
    ];
    if (start[0] === end[0] && start[1] === end[1])
      throw new Error("Annotation line must have a visible size.");
    found.annotation.set(PDFName.of("L"), context.obj([...start, ...end]));
    const lineWidth = clamp(input.width ?? 2, 0.5, 20);
    const margin = lineWidth / 2 + 2;
    found.annotation.set(
      PDFName.of("Rect"),
      context.obj([
        clamp(Math.min(start[0], end[0]) - margin, 0, pageWidth),
        clamp(Math.min(start[1], end[1]) - margin, 0, pageHeight),
        clamp(Math.max(start[0], end[0]) + margin, 0, pageWidth),
        clamp(Math.max(start[1], end[1]) + margin, 0, pageHeight),
      ]),
    );
  }
  if (input.color) {
    if (!input.color.every(finite)) throw new Error("Annotation color is invalid.");
    found.annotation.set(
      PDFName.of("C"),
      context.obj(input.color.map((channel) => clamp(channel, 0, 1))),
    );
  }
  if (input.opacity !== undefined) {
    if (!finite(input.opacity)) throw new Error("Annotation opacity is invalid.");
    found.annotation.set(PDFName.of("CA"), PDFNumber.of(clamp(input.opacity, 0, 1)));
  }
  if (input.width !== undefined) {
    if (!finite(input.width)) throw new Error("Annotation width is invalid.");
    found.annotation.set(
      PDFName.of("BS"),
      context.obj({ W: clamp(input.width, 0.5, 20), S: "S" }),
    );
  }
  if (input.contents !== undefined)
    found.annotation.set(PDFName.of("Contents"), PDFString.of(input.contents));
  return doc.save();
}

/** Remove one annotation while leaving page content and other annotations intact. */
export async function deleteAnnotation(
  pdfBytes: Uint8Array,
  id: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const found = findAnnotation(doc, id);
  if (!found) throw new Error("The selected annotation no longer exists.");
  found.annots.remove(found.index);
  if (found.annots.size() === 0) found.page.node.delete(PDFName.of("Annots"));
  return doc.save();
}

export async function rotatePages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
  angleDegrees: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const indexSet = new Set(pageIndices.filter((i) => i >= 0 && i < total));
  for (let i = 0; i < total; i++) {
    if (indexSet.has(i)) {
      const page = doc.getPage(i);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + angleDegrees + 360) % 360));
    }
  }
  return doc.save();
}

export async function deletePages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const sorted = [...new Set(pageIndices)]
    .filter((i) => i >= 0 && i < total)
    .sort((a, b) => b - a);

  if (sorted.length >= total) {
    throw new Error("Cannot delete all pages. A PDF must contain at least one page.");
  }

  for (const idx of sorted) {
    doc.removePage(idx);
  }
  return doc.save();
}

/**
 * Reorder pages in place.
 *
 * Rebuilding the document with `copyPages` would silently drop the catalog:
 * outlines, the AcroForm and its fields, and document metadata. Rearranging
 * the existing page tree keeps every catalog-level structure intact, so a
 * reorder is a pure permutation of the pages the document already has.
 */
export async function reorderPages(
  pdfBytes: Uint8Array,
  newOrder: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  if (newOrder.length !== total) {
    throw new Error("Page order length must match document page count.");
  }
  const pages = doc.getPages();
  const reordered = newOrder.map((index) => {
    const page = pages[index];
    if (!page) {
      throw new Error(`Page order refers to a page that does not exist: ${index + 1}.`);
    }
    return page;
  });
  for (let i = total - 1; i >= 0; i--) {
    doc.removePage(i);
  }
  reordered.forEach((page, i) => doc.insertPage(i, page));
  return doc.save();
}

export async function extractPages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const total = srcDoc.getPageCount();
  const valid = pageIndices.filter((i) => i >= 0 && i < total);
  if (valid.length === 0) {
    throw new Error("No valid pages selected for extraction.");
  }
  const newDoc = await PDFDocument.create();
  const copied = await newDoc.copyPages(srcDoc, valid);
  for (const page of copied) {
    newDoc.addPage(page);
  }
  return newDoc.save();
}

export async function insertBlankPage(
  pdfBytes: Uint8Array,
  atIndex: number,
  width = 595.28,
  height = 841.89,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const idx = Math.max(0, Math.min(atIndex, total));
  doc.insertPage(idx, [width, height]);
  return doc.save();
}

export async function insertImagePage(
  pdfBytes: Uint8Array,
  atIndex: number,
  imageBytes: Uint8Array,
  type: "png" | "jpg",
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const image =
    type === "png"
      ? await doc.embedPng(imageBytes)
      : await doc.embedJpg(imageBytes);
  const total = doc.getPageCount();
  const idx = Math.max(0, Math.min(atIndex, total));
  const page = doc.insertPage(idx, [image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
  return doc.save();
}

export async function cropPages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
  cropBox: { x: number; y: number; width: number; height: number },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const indexSet = new Set(pageIndices.filter((i) => i >= 0 && i < total));
  for (let i = 0; i < total; i++) {
    if (indexSet.has(i)) {
      const page = doc.getPage(i);
      page.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
    }
  }
  return doc.save();
}

export async function mergeDocuments(
  inputs: (Uint8Array | MergeInputItem)[],
): Promise<Uint8Array> {
  if (inputs.length === 0) {
    throw new Error("At least one document is required to merge.");
  }
  const mergedDoc = await PDFDocument.create();
  for (const input of inputs) {
    const isItem = !(input instanceof Uint8Array) && typeof input === "object" && "bytes" in input;
    const bytes = isItem ? input.bytes : (input as Uint8Array);
    const specifiedRanges = isItem ? input.ranges : undefined;

    const doc = await PDFDocument.load(bytes);
    const allIndices = doc.getPageIndices();
    const pageIndices = specifiedRanges && specifiedRanges.length > 0
      ? specifiedRanges.filter((idx) => idx >= 0 && idx < allIndices.length)
      : allIndices;

    if (pageIndices.length === 0) continue;

    const copied = await mergedDoc.copyPages(doc, pageIndices);
    for (const page of copied) {
      mergedDoc.addPage(page);
    }
  }
  if (mergedDoc.getPageCount() === 0) {
    throw new Error("No valid pages were selected to merge.");
  }
  return mergedDoc.save();
}

export interface SplitResult {
  bytes: Uint8Array;
  manifest: OperationManifestItem;
}

export async function splitDocumentWithManifest(
  pdfBytes: Uint8Array,
  ranges: number[][],
  baseFilename = "split-part",
): Promise<SplitResult[]> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const total = srcDoc.getPageCount();
  const results: SplitResult[] = [];
  let partIndex = 0;
  for (const range of ranges) {
    const valid = range.filter((i) => i >= 0 && i < total);
    if (valid.length > 0) {
      partIndex++;
      const newDoc = await PDFDocument.create();
      const copied = await newDoc.copyPages(srcDoc, valid);
      for (const page of copied) {
        newDoc.addPage(page);
      }
      const savedBytes = await newDoc.save();
      results.push({
        bytes: savedBytes,
        manifest: {
          filename: `${baseFilename}-${partIndex}.pdf`,
          pageCount: valid.length,
          sourcePages: valid,
        },
      });
    }
  }
  return results;
}

export async function splitDocument(
  pdfBytes: Uint8Array,
  ranges: number[][],
): Promise<Uint8Array[]> {
  const results = await splitDocumentWithManifest(pdfBytes, ranges);
  return results.map((r) => r.bytes);
}

export function computeReorderMapping(newOrder: number[]): number[] {
  return [...newOrder];
}

export function computeDeleteMapping(total: number, deletedIndices: number[]): number[] {
  const delSet = new Set(deletedIndices);
  const mapping: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!delSet.has(i)) {
      mapping.push(i);
    }
  }
  return mapping;
}

export function computeInsertMapping(total: number, insertIndex: number, insertedCount = 1): number[] {
  const mapping: number[] = [];
  for (let i = 0; i < insertIndex; i++) {
    mapping.push(i);
  }
  for (let i = 0; i < insertedCount; i++) {
    mapping.push(-1);
  }
  for (let i = insertIndex; i < total; i++) {
    mapping.push(i);
  }
  return mapping;
}

export async function createBlankDocument(
  pageCount = 1,
  width = 595.28,
  height = 841.89,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([width, height]);
  }
  return doc.save();
}

export async function createDocumentFromImage(
  imageBytes: Uint8Array,
  type: "png" | "jpg",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image =
    type === "png"
      ? await doc.embedPng(imageBytes)
      : await doc.embedJpg(imageBytes);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
  return doc.save();
}

/** Catalog-level structures that a whole-document rebuild cannot carry over. */
export type StructureSummary = {
  pages: number;
  hasOutline: boolean;
  formFields: number;
  title: string;
};

export async function inspectStructure(
  pdfBytes: Uint8Array,
): Promise<StructureSummary> {
  const doc = await PDFDocument.load(pdfBytes);
  let formFields: number;
  try {
    formFields = doc.getForm().getFields().length;
  } catch {
    // A malformed AcroForm is reported as carrying no readable fields.
    formFields = 0;
  }
  return {
    pages: doc.getPageCount(),
    hasOutline: !!doc.catalog.get(PDFName.of("Outlines")),
    formFields,
    title: doc.getTitle() ?? "",
  };
}

/**
 * Describe what extraction, merging, and splitting will drop.
 *
 * These operations compose a genuinely new document, so catalog structures
 * belonging to the source do not carry over. The roadmap requires warning
 * about that rather than dropping it silently. Returns "" when there is
 * nothing to lose.
 */
export async function describeStructureLoss(
  sources: Uint8Array[],
): Promise<string> {
  let outlines = 0;
  let formFields = 0;
  for (const bytes of sources) {
    try {
      const summary = await inspectStructure(bytes);
      if (summary.hasOutline) outlines++;
      formFields += summary.formFields;
    } catch {
      // An unreadable input is reported by the operation itself, not here.
    }
  }
  const lost: string[] = [];
  if (outlines > 0) lost.push("bookmarks (document outline)");
  if (formFields > 0)
    lost.push(`${formFields} interactive form field${formFields === 1 ? "" : "s"}`);
  if (lost.length === 0) return "";
  return `This creates a new document, so ${lost.join(" and ")} will not carry over. The open document is unchanged.`;
}

export interface FormFieldDefinition {
  type: "text" | "checkbox" | "radio" | "dropdown" | "button";
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  defaultValue?: string;
  required?: boolean;
  readOnly?: boolean;
  multiline?: boolean;
  options?: string[];
  group?: string;
}

export async function addFormField(
  pdfBytes: Uint8Array<ArrayBuffer>,
  definition: FormFieldDefinition,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const form = doc.getForm();
  const pageIndex = definition.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new Error(`Invalid page number ${definition.page}.`);
  }
  const page = doc.getPage(pageIndex);
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const name = definition.name.trim();
  if (!name) throw new Error("Field name cannot be empty.");

  const x = clamp(definition.x, 0, pageWidth - 10);
  const y = clamp(definition.y, 0, pageHeight - 10);
  const width = Math.max(10, Math.min(definition.width, pageWidth - x));
  const height = Math.max(10, Math.min(definition.height, pageHeight - y));

  if (definition.type === "text") {
    if (form.getFieldMaybe(name)) {
      throw new Error(`A form field named "${name}" already exists.`);
    }
    const tf = form.createTextField(name);
    if (definition.multiline) tf.enableMultiline();
    if (definition.required) tf.enableRequired();
    if (definition.readOnly) tf.enableReadOnly();
    if (definition.defaultValue) tf.setText(definition.defaultValue);
    tf.addToPage(page, { x, y, width, height });
  } else if (definition.type === "checkbox") {
    if (form.getFieldMaybe(name)) {
      throw new Error(`A form field named "${name}" already exists.`);
    }
    const cb = form.createCheckBox(name);
    if (definition.required) cb.enableRequired();
    if (definition.readOnly) cb.enableReadOnly();
    const val = (definition.defaultValue ?? "").toLowerCase();
    if (val === "true" || val === "yes" || val === "checked" || val === "1") {
      cb.check();
    }
    cb.addToPage(page, { x, y, width, height });
  } else if (definition.type === "radio") {
    const groupName = (definition.group || name).trim();
    const rg = form.getFieldMaybe(groupName);
    let radioGroup: PDFRadioGroup;
    if (rg) {
      if (!(rg instanceof PDFRadioGroup)) {
        throw new Error(`Field "${groupName}" already exists and is not a radio group.`);
      }
      radioGroup = rg;
    } else {
      radioGroup = form.createRadioGroup(groupName);
    }
    const optionName = definition.defaultValue || `Option ${radioGroup.getOptions().length + 1}`;
    radioGroup.addOptionToPage(optionName, page, { x, y, width, height });
    if (definition.required) radioGroup.enableRequired();
    if (definition.readOnly) radioGroup.enableReadOnly();
  } else if (definition.type === "dropdown") {
    if (form.getFieldMaybe(name)) {
      throw new Error(`A form field named "${name}" already exists.`);
    }
    const dd = form.createDropdown(name);
    const opts = definition.options && definition.options.length > 0
      ? definition.options
      : ["Option 1", "Option 2"];
    dd.addOptions(opts);
    if (definition.defaultValue && opts.includes(definition.defaultValue)) {
      dd.select(definition.defaultValue);
    }
    if (definition.required) dd.enableRequired();
    if (definition.readOnly) dd.enableReadOnly();
    dd.addToPage(page, { x, y, width, height });
  } else if (definition.type === "button") {
    if (form.getFieldMaybe(name)) {
      throw new Error(`A form field named "${name}" already exists.`);
    }
    const btn = form.createButton(name);
    btn.addToPage(definition.label || definition.defaultValue || "Submit", page, {
      x,
      y,
      width,
      height,
    });
  }

  return doc.save();
}

/** Validate glyph coverage for Standard 14 PDF fonts (WinAnsi encoding). */
export function validateStandardFontCoverage(text: string): {
  valid: boolean;
  unsupportedChars: string[];
} {
  const unsupported: string[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) continue;
    const isWinAnsi =
      (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255) ||
      [
        0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
        0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
        0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
        0x0153, 0x017e, 0x0178,
      ].includes(code);
    if (!isWinAnsi && !unsupported.includes(ch)) {
      unsupported.push(ch);
    }
  }
  return {
    valid: unsupported.length === 0,
    unsupportedChars: unsupported,
  };
}

export type StandardFontFamily =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Times-Roman"
  | "Courier";

export interface InsertTextOptions {
  page: number; // 1-based page number
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  fontFamily?: StandardFontFamily;
  color?: [number, number, number];
  alignment?: "left" | "center" | "right";
  maxWidth?: number;
  lineHeight?: number;
  opacity?: number;
}

function wrapText(
  text: string,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  fontSize: number,
  maxWidth: number,
): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          lines.push(word);
          currentLine = "";
        }
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }
  return lines;
}

/** Insert multiline text with font selection, wrapping, and alignment. */
export async function insertTextContent(
  pdfBytes: Uint8Array,
  options: InsertTextOptions,
): Promise<Uint8Array> {
  if (!options.text.trim()) {
    throw new Error("Text content cannot be empty.");
  }
  const coverage = validateStandardFontCoverage(options.text);
  if (!coverage.valid) {
    throw new Error(
      `Unsupported characters for standard PDF fonts: ${coverage.unsupportedChars.join(", ")}`,
    );
  }
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = options.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new Error("Target page is outside the document.");
  }
  const page = doc.getPage(pageIndex);

  let standardFont = StandardFonts.Helvetica;
  if (options.fontFamily === "Helvetica-Bold") {
    standardFont = StandardFonts.HelveticaBold;
  } else if (options.fontFamily === "Times-Roman") {
    standardFont = StandardFonts.TimesRoman;
  } else if (options.fontFamily === "Courier") {
    standardFont = StandardFonts.Courier;
  }

  const font = await doc.embedFont(standardFont);
  const fontSize = clamp(options.fontSize ?? 14, 4, 144);
  const lineHeight = options.lineHeight ?? fontSize * 1.25;
  const colorTuple = options.color ?? [0.14, 0.2, 0.18];
  const color = rgb(colorTuple[0], colorTuple[1], colorTuple[2]);
  const opacity = options.opacity !== undefined ? clamp(options.opacity, 0, 1) : 1;

  const lines =
    options.maxWidth && options.maxWidth > 0
      ? wrapText(options.text, font, fontSize, options.maxWidth)
      : options.text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    let lineX = options.x;
    const containerWidth =
      options.maxWidth && options.maxWidth > 0 ? options.maxWidth : lineWidth;
    if (options.alignment === "center") {
      lineX = options.x + (containerWidth - lineWidth) / 2;
    } else if (options.alignment === "right") {
      lineX = options.x + (containerWidth - lineWidth);
    }
    const lineY = options.y - i * lineHeight;
    page.drawText(line, {
      x: lineX,
      y: lineY,
      size: fontSize,
      font,
      color,
      opacity,
    });
  }

  return doc.save();
}

export interface InsertImageOptions {
  page: number; // 1-based page number
  imageBytes: Uint8Array;
  imageType: "png" | "jpg";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  opacity?: number;
  preserveAspectRatio?: boolean;
}

/** Insert PNG/JPEG image with aspect-ratio preservation and custom position. */
export async function insertImageContent(
  pdfBytes: Uint8Array,
  options: InsertImageOptions,
): Promise<Uint8Array> {
  if (!options.imageBytes || options.imageBytes.length === 0) {
    throw new Error("Image data is empty.");
  }
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = options.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new Error("Target page is outside the document.");
  }
  const page = doc.getPage(pageIndex);
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const img =
    options.imageType === "png"
      ? await doc.embedPng(options.imageBytes)
      : await doc.embedJpg(options.imageBytes);

  let drawWidth: number;
  let drawHeight: number;

  if (
    options.width !== undefined &&
    options.height !== undefined &&
    options.preserveAspectRatio === false
  ) {
    drawWidth = options.width;
    drawHeight = options.height;
  } else {
    const maxW = options.maxWidth ?? options.width ?? pageWidth * 0.5;
    const maxH = options.maxHeight ?? options.height ?? pageHeight * 0.5;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    drawWidth = img.width * scale;
    drawHeight = img.height * scale;
  }

  const drawX = options.x !== undefined ? options.x : (pageWidth - drawWidth) / 2;
  const drawY = options.y !== undefined ? options.y : (pageHeight - drawHeight) / 2;
  const opacity = options.opacity !== undefined ? clamp(options.opacity, 0, 1) : 1;

  page.drawImage(img, {
    x: drawX,
    y: drawY,
    width: drawWidth,
    height: drawHeight,
    opacity,
  });

  return doc.save();
}

export interface DecorationHeaderFooterSlot {
  left?: string;
  center?: string;
  right?: string;
}

export interface DocumentDecorationsOptions {
  header?: DecorationHeaderFooterSlot;
  footer?: DecorationHeaderFooterSlot;
  watermark?: {
    text?: string;
    opacity?: number;
    rotationDegrees?: number;
    fontSize?: number;
    color?: [number, number, number];
  };
  background?: {
    color?: [number, number, number];
    opacity?: number;
  };
  pageRange?: number[]; // 1-based page numbers; all if omitted
  metadata?: {
    title?: string;
    author?: string;
    date?: string;
  };
}

/** Remove app-owned decorations from specified or all pages without touching other content. */
export async function removeDocumentDecorations(
  pdfBytes: Uint8Array,
  pageRange?: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const targetIndices = new Set(
    pageRange && pageRange.length > 0
      ? pageRange.map((p) => p - 1).filter((i) => i >= 0 && i < total)
      : Array.from({ length: total }, (_, i) => i),
  );

  let removedAny = false;
  for (const pageIndex of targetIndices) {
    const page = doc.getPage(pageIndex);
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) continue;

    const remaining: (PDFRef | PDFDict)[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i);
      const stream = doc.context.lookup(ref);
      const isDec =
        stream instanceof PDFDict
          ? stream.get(PDFName.of("NavPDF_Decoration"))
          : (stream as unknown as { dict?: PDFDict })?.dict?.get(
              PDFName.of("NavPDF_Decoration"),
            );
      if (isDec) {
        removedAny = true;
      } else {
        remaining.push(ref as (PDFRef | PDFDict));
      }
    }
    if (removedAny) {
      page.node.set(
        PDFName.of("Contents"),
        doc.context.obj(remaining as unknown as PDFObject[]),
      );
    }
  }

  return doc.save();
}

/** Apply headers, footers, watermarks, or background fills with app-owned stream tagging. */
export async function applyDocumentDecorations(
  pdfBytes: Uint8Array,
  options: DocumentDecorationsOptions,
): Promise<Uint8Array> {
  // First strip existing decorations in target pages so repeated calls do not stack
  const cleanedBytes = await removeDocumentDecorations(pdfBytes, options.pageRange);
  const doc = await PDFDocument.load(cleanedBytes);
  const total = doc.getPageCount();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const targetIndices =
    options.pageRange && options.pageRange.length > 0
      ? options.pageRange.map((p) => p - 1).filter((i) => i >= 0 && i < total)
      : Array.from({ length: total }, (_, i) => i);

  const today = options.metadata?.date || new Date().toLocaleDateString();
  const docTitle = options.metadata?.title || doc.getTitle() || "";
  const docAuthor = options.metadata?.author || doc.getAuthor() || "";

  const formatTokens = (template: string, pageNum: number) =>
    template
      .replace(/\{page\}/g, String(pageNum))
      .replace(/\{total\}/g, String(total))
      .replace(/\{date\}/g, today)
      .replace(/\{title\}/g, docTitle)
      .replace(/\{author\}/g, docAuthor);

  for (const pageIndex of targetIndices) {
    const page = doc.getPage(pageIndex);
    const { width, height } = page.getSize();
    const pageNum = pageIndex + 1;

    const contentsBefore = page.node.Contents();
    const beforeSize = contentsBefore instanceof PDFArray ? contentsBefore.size() : 0;

    // 1. Background fill
    if (options.background?.color) {
      const [r, g, b] = options.background.color;
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: rgb(r, g, b),
        opacity: clamp(options.background.opacity ?? 0.2, 0, 1),
      });
    }

    // 2. Watermark
    if (options.watermark?.text?.trim()) {
      const text = options.watermark.text.trim();
      const fontSize = clamp(options.watermark.fontSize ?? 48, 12, 120);
      const rot = degrees(options.watermark.rotationDegrees ?? 45);
      const colorTuple = options.watermark.color ?? [0.7, 0.2, 0.2];
      const color = rgb(colorTuple[0], colorTuple[1], colorTuple[2]);
      const opacity = clamp(options.watermark.opacity ?? 0.2, 0.05, 1);
      const textWidth = fontBold.widthOfTextAtSize(text, fontSize);

      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height / 2,
        size: fontSize,
        font: fontBold,
        color,
        opacity,
        rotate: rot,
      });
    }

    // 3. Header slots
    if (options.header) {
      const textColor = rgb(0.4, 0.4, 0.4);
      if (options.header.left) {
        page.drawText(formatTokens(options.header.left, pageNum), {
          x: 40,
          y: height - 30,
          size: 10,
          font,
          color: textColor,
        });
      }
      if (options.header.center) {
        const text = formatTokens(options.header.center, pageNum);
        const w = font.widthOfTextAtSize(text, 10);
        page.drawText(text, {
          x: (width - w) / 2,
          y: height - 30,
          size: 10,
          font,
          color: textColor,
        });
      }
      if (options.header.right) {
        const text = formatTokens(options.header.right, pageNum);
        const w = font.widthOfTextAtSize(text, 10);
        page.drawText(text, {
          x: width - w - 40,
          y: height - 30,
          size: 10,
          font,
          color: textColor,
        });
      }
    }

    // 4. Footer slots
    if (options.footer) {
      const textColor = rgb(0.4, 0.4, 0.4);
      if (options.footer.left) {
        page.drawText(formatTokens(options.footer.left, pageNum), {
          x: 40,
          y: 25,
          size: 10,
          font,
          color: textColor,
        });
      }
      if (options.footer.center) {
        const text = formatTokens(options.footer.center, pageNum);
        const w = font.widthOfTextAtSize(text, 10);
        page.drawText(text, {
          x: (width - w) / 2,
          y: 25,
          size: 10,
          font,
          color: textColor,
        });
      }
      if (options.footer.right) {
        const text = formatTokens(options.footer.right, pageNum);
        const w = font.widthOfTextAtSize(text, 10);
        page.drawText(text, {
          x: width - w - 40,
          y: 25,
          size: 10,
          font,
          color: textColor,
        });
      }
    }

    // Tag all newly created content streams on this page as app-owned decorations
    const contents = page.node.Contents();
    if (contents instanceof PDFArray) {
      const afterSize = contents.size();
      for (let s = beforeSize; s < afterSize; s++) {
        const streamRef = contents.get(s);
        const stream = doc.context.lookup(streamRef) as unknown as { dict?: PDFDict };
        if (stream?.dict) {
          stream.dict.set(PDFName.of("NavPDF_Decoration"), doc.context.obj(true));
        }
      }
    }
  }

  return doc.save();
}

export interface BatesNumberingOptions {
  prefix?: string;
  suffix?: string;
  startNumber?: number;
  padding?: number;
  pageIndices?: number[]; // 0-based; all pages if omitted
  position?:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "bottom-center";
  fontSize?: number;
  color?: [number, number, number];
}

export interface BatesManifestItem {
  pageIndex: number;
  pageNumber: number;
  batesNumber: string;
}

export interface BatesNumberingResult {
  bytes: Uint8Array;
  manifest: {
    prefix: string;
    suffix: string;
    startNumber: number;
    padding: number;
    items: BatesManifestItem[];
  };
}

/** Apply sequential Bates numbering across specified or all pages with manifest. */
export async function applyBatesNumbering(
  pdfBytes: Uint8Array,
  options: BatesNumberingOptions = {},
): Promise<BatesNumberingResult> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const startNumber = Math.max(1, options.startNumber ?? 1);
  const padding = Math.max(1, Math.min(12, options.padding ?? 6));
  const prefix = options.prefix ?? "";
  const suffix = options.suffix ?? "";
  const position = options.position ?? "bottom-right";
  const fontSize = clamp(options.fontSize ?? 10, 6, 24);
  const colorTuple = options.color ?? [0.2, 0.2, 0.2];
  const color = rgb(colorTuple[0], colorTuple[1], colorTuple[2]);

  const targetIndices =
    options.pageIndices && options.pageIndices.length > 0
      ? options.pageIndices.filter((i) => i >= 0 && i < total)
      : Array.from({ length: total }, (_, i) => i);

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const items: BatesManifestItem[] = [];

  for (let i = 0; i < targetIndices.length; i++) {
    const pageIndex = targetIndices[i];
    const page = doc.getPage(pageIndex);
    const { width, height } = page.getSize();
    const currentNum = startNumber + i;
    const numStr = String(currentNum).padStart(padding, "0");
    const batesText = `${prefix}${numStr}${suffix}`;

    items.push({
      pageIndex,
      pageNumber: pageIndex + 1,
      batesNumber: batesText,
    });

    const w = fontBold.widthOfTextAtSize(batesText, fontSize);
    let x: number;
    let y: number;

    switch (position) {
      case "bottom-left":
        x = 40;
        y = 25;
        break;
      case "bottom-center":
        x = (width - w) / 2;
        y = 25;
        break;
      case "top-left":
        x = 40;
        y = height - 30;
        break;
      case "top-right":
        x = width - w - 40;
        y = height - 30;
        break;
      case "bottom-right":
      default:
        x = width - w - 40;
        y = 25;
        break;
    }

    const contentsBefore = page.node.Contents();
    const beforeSize = contentsBefore instanceof PDFArray ? contentsBefore.size() : 0;

    page.drawText(batesText, {
      x,
      y,
      size: fontSize,
      font: fontBold,
      color,
    });

    const contents = page.node.Contents();
    if (contents instanceof PDFArray) {
      const afterSize = contents.size();
      for (let s = beforeSize; s < afterSize; s++) {
        const streamRef = contents.get(s);
        const stream = doc.context.lookup(streamRef) as unknown as { dict?: PDFDict };
        if (stream?.dict) {
          stream.dict.set(PDFName.of("NavPDF_Decoration"), doc.context.obj(true));
        }
      }
    }
  }

  const bytes = await doc.save();
  return {
    bytes,
    manifest: {
      prefix,
      suffix,
      startNumber,
      padding,
      items,
    },
  };
}

/** Validate URL string against explicit safe URL policy (rejects javascript, data, file, vbscript). */
export function validateSafeUrl(url: string): {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
} {
  const trimmed = url.trim();
  if (!trimmed) {
    return { valid: false, reason: "URL cannot be empty." };
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("about:") ||
    lower.startsWith("blob:")
  ) {
    return {
      valid: false,
      reason: `Blocked unsafe URI scheme "${trimmed.split(":")[0]}:". Only https, http, and mailto links are allowed.`,
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) {
      return {
        valid: false,
        reason: `Unsupported protocol "${parsed.protocol}". Only https, http, and mailto are allowed.`,
      };
    }
    return { valid: true, normalizedUrl: parsed.toString() };
  } catch {
    if (/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(trimmed)) {
      return { valid: true, normalizedUrl: `mailto:${trimmed}` };
    }
    return {
      valid: false,
      reason: "Malformed URL. Ensure it starts with https:// or http://",
    };
  }
}

export interface LinkAnnotationOptions {
  page: number; // 1-based page number
  rect: [number, number, number, number]; // [x1, y1, x2, y2]
  target: {
    type: "url" | "page";
    url?: string;
    targetPage?: number; // 1-based page number
  };
}

/** Add a standard PDF /Link annotation (external URL or internal page jump). */
export async function addLinkAnnotation(
  pdfBytes: Uint8Array,
  options: LinkAnnotationOptions,
): Promise<Uint8Array> {
  const [x1, y1, x2, y2] = options.rect;
  if (![x1, y1, x2, y2].every(finite) || x2 <= x1 || y2 <= y1) {
    throw new Error("Invalid link rectangle geometry.");
  }

  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = options.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new Error("Link page is outside the document.");
  }
  const page = doc.getPage(pageIndex);

  let linkAnnot: PDFDict;
  if (options.target.type === "url") {
    const urlCheck = validateSafeUrl(options.target.url ?? "");
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      throw new Error(urlCheck.reason || "Invalid URL destination.");
    }
    linkAnnot = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x1, y1, x2, y2],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(urlCheck.normalizedUrl),
      },
    });
  } else {
    const targetPageIndex = (options.target.targetPage ?? 1) - 1;
    if (targetPageIndex < 0 || targetPageIndex >= doc.getPageCount()) {
      throw new Error("Target destination page does not exist.");
    }
    const targetPageRef = doc.getPage(targetPageIndex).ref;
    const destArray = doc.context.obj([
      targetPageRef,
      PDFName.of("XYZ"),
      null,
      null,
      null,
    ]);
    linkAnnot = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x1, y1, x2, y2],
      Border: [0, 0, 0],
      Dest: destArray,
    });
  }

  page.node.addAnnot(doc.context.register(linkAnnot));
  return doc.save();
}

/** Delete a link annotation from a specific page by link index. */
export async function deleteLinkAnnotation(
  pdfBytes: Uint8Array,
  page: number,
  annotationIndex: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new Error("Page is outside the document.");
  }
  const pageLeaf = doc.getPage(pageIndex);
  const annots = pageLeaf.node.Annots();
  if (!annots || !(annots instanceof PDFArray) || annots.size() === 0) {
    throw new Error("No annotations on the specified page.");
  }

  let linkCount = 0;
  const remaining: (PDFRef | PDFDict)[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const annotRef = annots.get(i);
    const annot = doc.context.lookup(annotRef);
    const isLink =
      annot instanceof PDFDict &&
      annot.get(PDFName.of("Subtype")) === PDFName.of("Link");
    if (isLink) {
      if (linkCount === annotationIndex) {
        linkCount++;
        continue;
      }
      linkCount++;
    }
    remaining.push(annotRef as (PDFRef | PDFDict));
  }

  pageLeaf.node.set(
    PDFName.of("Annots"),
    doc.context.obj(remaining as unknown as PDFObject[]),
  );
  return doc.save();
}

export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Sanitize an attachment filename to prevent directory traversal and illegal characters. */
export function sanitizeAttachmentFilename(filename: string): string {
  if (!filename) return "attachment.bin";
  let clean = Array.from(filename)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const lastSlash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (lastSlash >= 0) {
    clean = clean.slice(lastSlash + 1);
  }
  clean = clean.replace(/\.\.+/g, "");
  clean = clean.trim().replace(/^\.+|\.+$/g, "");
  clean = clean.replace(/[/:*?"<>|\\]+/g, "_");
  return clean || "attachment.bin";
}

export interface EmbeddedAttachmentSummary {
  name: string;
  size?: number;
  description?: string;
}

/** List all embedded file attachments in the PDF document catalog. */
export async function listEmbeddedAttachments(
  pdfBytes: Uint8Array,
): Promise<EmbeddedAttachmentSummary[]> {
  const doc = await PDFDocument.load(pdfBytes);
  const names = doc.catalog.get(PDFName.of("Names"));
  if (!(names instanceof PDFDict)) return [];
  const ef = doc.context.lookup(names.get(PDFName.of("EmbeddedFiles")));
  if (!(ef instanceof PDFDict)) return [];
  const efNames = doc.context.lookup(ef.get(PDFName.of("Names")));
  if (!(efNames instanceof PDFArray)) return [];

  const list: EmbeddedAttachmentSummary[] = [];
  for (let i = 0; i < efNames.size(); i += 2) {
    const nameObj = doc.context.lookup(efNames.get(i)) as unknown;
    const nameStr =
      nameObj && typeof (nameObj as { decodeText?: () => string }).decodeText === "function"
        ? (nameObj as { decodeText: () => string }).decodeText()
        : `attachment-${i / 2 + 1}`;
    const fileSpec = doc.context.lookup(efNames.get(i + 1));
    let size: number | undefined;
    let description: string | undefined;

    if (fileSpec instanceof PDFDict) {
      const descObj = doc.context.lookup(fileSpec.get(PDFName.of("Desc"))) as unknown;
      if (
        descObj &&
        typeof (descObj as { decodeText?: () => string }).decodeText === "function"
      ) {
        description = (descObj as { decodeText: () => string }).decodeText();
      }
      const efDict = doc.context.lookup(fileSpec.get(PDFName.of("EF")));
      if (efDict instanceof PDFDict) {
        const stream = doc.context.lookup(efDict.get(PDFName.of("F"))) as unknown;
        if (
          stream &&
          typeof (stream as { getContents?: () => Uint8Array }).getContents === "function"
        ) {
          const dict = (stream as { dict?: PDFDict }).dict;
          if (dict) {
            const params = doc.context.lookup(dict.get(PDFName.of("Params")));
            if (params instanceof PDFDict) {
              const sizeNum = params.get(PDFName.of("Size"));
              if (sizeNum instanceof PDFNumber) {
                size = sizeNum.asNumber();
              }
            }
          }
          if (size === undefined) {
            size = (stream as { getContents: () => Uint8Array }).getContents().length;
          }
        }
      }
    }
    list.push({ name: nameStr, size, description });
  }
  return list;
}

/** Embed a file attachment with bounded size and sanitized filename. */
export async function addEmbeddedAttachment(
  pdfBytes: Uint8Array,
  name: string,
  data: Uint8Array,
  description?: string,
): Promise<Uint8Array> {
  if (data.length > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error("Attachment exceeds maximum allowed size of 50 MB.");
  }
  const safeName = sanitizeAttachmentFilename(name);
  const doc = await PDFDocument.load(pdfBytes);
  await doc.attach(data, safeName, {
    description:
      description || `Attached by NavPDF on ${new Date().toLocaleDateString()}`,
    creationDate: new Date(),
    modificationDate: new Date(),
  });
  return doc.save();
}

/** Extract an embedded file attachment by name and decompress its data. */
export async function extractEmbeddedAttachment(
  pdfBytes: Uint8Array,
  name: string,
): Promise<Uint8Array | null> {
  const doc = await PDFDocument.load(pdfBytes);
  const names = doc.catalog.get(PDFName.of("Names"));
  if (!(names instanceof PDFDict)) return null;
  const ef = doc.context.lookup(names.get(PDFName.of("EmbeddedFiles")));
  if (!(ef instanceof PDFDict)) return null;
  const efNames = doc.context.lookup(ef.get(PDFName.of("Names")));
  if (!(efNames instanceof PDFArray)) return null;

  for (let i = 0; i < efNames.size(); i += 2) {
    const nameObj = doc.context.lookup(efNames.get(i)) as unknown;
    const nameStr =
      nameObj && typeof (nameObj as { decodeText?: () => string }).decodeText === "function"
        ? (nameObj as { decodeText: () => string }).decodeText()
        : "";
    if (nameStr === name) {
      const fileSpec = doc.context.lookup(efNames.get(i + 1));
      if (!(fileSpec instanceof PDFDict)) return null;
      const efDict = doc.context.lookup(fileSpec.get(PDFName.of("EF")));
      if (!(efDict instanceof PDFDict)) return null;
      const stream = doc.context.lookup(efDict.get(PDFName.of("F"))) as unknown;
      if (!stream) return null;

      const decoded = decodePDFRawStream(stream as never) as unknown as {
        decode?: () => Uint8Array;
        getContents?: () => Uint8Array;
      };
      if (typeof decoded.decode === "function") {
        return decoded.decode();
      } else if (typeof decoded.getContents === "function") {
        return decoded.getContents();
      } else if (
        typeof (stream as { getContents?: () => Uint8Array }).getContents === "function"
      ) {
        return (stream as { getContents: () => Uint8Array }).getContents();
      }
      return null;
    }
  }
  return null;
}

/** Delete an embedded file attachment from the catalog. */
export async function deleteEmbeddedAttachment(
  pdfBytes: Uint8Array,
  name: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const names = doc.catalog.get(PDFName.of("Names"));
  if (!(names instanceof PDFDict)) return pdfBytes;
  const ef = doc.context.lookup(names.get(PDFName.of("EmbeddedFiles")));
  if (!(ef instanceof PDFDict)) return pdfBytes;
  const efNames = doc.context.lookup(ef.get(PDFName.of("Names")));
  if (!(efNames instanceof PDFArray)) return pdfBytes;

  const remaining: (PDFRef | PDFDict)[] = [];
  let found = false;
  let droppedRef: unknown = null;
  for (let i = 0; i < efNames.size(); i += 2) {
    const nameObj = doc.context.lookup(efNames.get(i)) as unknown;
    const nameStr =
      nameObj && typeof (nameObj as { decodeText?: () => string }).decodeText === "function"
        ? (nameObj as { decodeText: () => string }).decodeText()
        : "";
    if (nameStr === name) {
      found = true;
      droppedRef = efNames.get(i + 1);
      continue;
    }
    remaining.push(
      efNames.get(i) as (PDFRef | PDFDict),
      efNames.get(i + 1) as (PDFRef | PDFDict),
    );
  }
  if (!found) return pdfBytes;

  ef.set(
    PDFName.of("Names"),
    doc.context.obj(remaining as unknown as PDFObject[]),
  );

  const af = doc.catalog.get(PDFName.of("AF"));
  if (af instanceof PDFArray && droppedRef) {
    const afRemaining: (PDFRef | PDFDict)[] = [];
    for (let j = 0; j < af.size(); j++) {
      const item = af.get(j);
      if (item !== droppedRef) {
        afRemaining.push(item as (PDFRef | PDFDict));
      }
    }
    doc.catalog.set(
      PDFName.of("AF"),
      doc.context.obj(afRemaining as unknown as PDFObject[]),
    );
  }

  return doc.save();
}

/**
 * Detects whether a page contains digital text (operators BT/ET/Tj/TJ) that is not part of a NavPDF OCR layer.
 */
export async function detectExistingText(
  pdfBytes: Uint8Array,
  pageIndex: number,
): Promise<boolean> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) return false;

  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const streamRefs =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : contents
        ? [contents]
        : [];

  for (const ref of streamRefs) {
    const streamObj = doc.context.lookup(ref);
    const dict =
      streamObj instanceof PDFDict
        ? streamObj
        : (streamObj as unknown as { dict?: PDFDict })?.dict;

    if (dict?.get(PDFName.of("NavPDF_OCR"))) {
      continue;
    }

    let textStr = "";
    try {
      const decoded = decodePDFRawStream(
        streamObj as unknown as Parameters<typeof decodePDFRawStream>[0],
      ) as unknown as { decode?: () => Uint8Array; getContents?: () => Uint8Array };
      if (typeof decoded?.decode === "function") {
        textStr = new TextDecoder().decode(decoded.decode());
      } else if (typeof decoded?.getContents === "function") {
        textStr = new TextDecoder().decode(decoded.getContents());
      }
    } catch {
      // If decompression fails or stream is uncompressed, fallback to string inspection
      if (
        typeof (streamObj as unknown as { getContentsString?: () => string })
          .getContentsString === "function"
      ) {
        textStr = (
          streamObj as unknown as { getContentsString: () => string }
        ).getContentsString();
      }
    }

    if (/\b(BT|Tj|TJ)\b/.test(textStr)) {
      return true;
    }
  }

  return false;
}

/**
 * Removes app-owned OCR text streams from the specified pages (or all pages if omitted).
 */
export async function removeOcrSearchableLayer(
  pdfBytes: Uint8Array,
  pageIndices?: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const total = doc.getPageCount();
  const targetIndices = new Set(
    pageIndices && pageIndices.length > 0
      ? pageIndices.filter((i) => i >= 0 && i < total)
      : Array.from({ length: total }, (_, i) => i),
  );

  let removedAny = false;
  for (const pageIndex of targetIndices) {
    const page = doc.getPage(pageIndex);
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) continue;

    const remaining: (PDFRef | PDFDict)[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i);
      const stream = doc.context.lookup(ref);
      const isOcr =
        stream instanceof PDFDict
          ? stream.get(PDFName.of("NavPDF_OCR"))
          : (stream as unknown as { dict?: PDFDict })?.dict?.get(
              PDFName.of("NavPDF_OCR"),
            );
      if (isOcr) {
        removedAny = true;
      } else {
        remaining.push(ref as (PDFRef | PDFDict));
      }
    }
    if (removedAny) {
      page.node.set(
        PDFName.of("Contents"),
        doc.context.obj(remaining as unknown as PDFObject[]),
      );
    }
  }

  return doc.save();
}

/**
 * Applies an invisible, searchable text layer aligned to recognized OCR word bounding boxes.
 */
export async function applyOcrSearchableLayer(
  pdfBytes: Uint8Array,
  results: OcrPageResult[],
): Promise<Uint8Array> {
  if (!results || results.length === 0) return pdfBytes;

  // Strip existing OCR layers on the target pages so multiple executions don't stack
  const cleanedBytes = await removeOcrSearchableLayer(
    pdfBytes,
    results.map((r) => r.pageIndex),
  );

  const doc = await PDFDocument.load(cleanedBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const totalPages = doc.getPageCount();

  for (const pageRes of results) {
    if (pageRes.pageIndex < 0 || pageRes.pageIndex >= totalPages) continue;
    const page = doc.getPage(pageRes.pageIndex);
    const width = page.getWidth();
    const height = page.getHeight();

    // Register font in page resources
    const fontKey = page.node.newFontDictionary(font.name, font.ref);

    // Build standard ISO 32000-1 invisible text rendering stream
    const ops: string[] = [
      "BT",
      "3 Tr",
      `/${fontKey.asString().slice(1)} 12 Tf`,
    ];

    for (const line of pageRes.lines) {
      for (const word of line.words) {
        if (!word.text || !word.text.trim()) continue;
        const [xNorm, yNorm, , hNorm] = word.bbox;
        const x = (xNorm * width).toFixed(2);
        const y = (yNorm * height).toFixed(2);
        const fontSize = Math.max(hNorm * height * 0.85, 4).toFixed(2);
        const safeText = word.text
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
        ops.push(`/${fontKey.asString().slice(1)} ${fontSize} Tf`);
        ops.push(`1 0 0 1 ${x} ${y} Tm`);
        ops.push(`(${safeText}) Tj`);
      }
    }
    ops.push("0 Tr", "ET");

    const stream = doc.context.stream(ops.join("\n"));
    stream.dict.set(PDFName.of("NavPDF_OCR"), doc.context.obj(true));
    const streamRef = doc.context.register(stream);

    const existingContents = page.node.Contents();
    const existingList: (PDFRef | PDFDict)[] = [];
    if (existingContents instanceof PDFArray) {
      for (let i = 0; i < existingContents.size(); i++) {
        existingList.push(existingContents.get(i) as (PDFRef | PDFDict));
      }
    } else if (existingContents instanceof PDFRef) {
      existingList.push(existingContents);
    }
    existingList.push(streamRef);

    page.node.set(
      PDFName.of("Contents"),
      doc.context.obj(existingList as unknown as PDFObject[]),
    );
  }

  return doc.save();
}

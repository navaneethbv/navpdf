import { decodeBoundedStream } from "./pdf/bounded-stream.ts";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  PDFDict,
  PDFNumber,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  PDFArray,
  PDFRef,
  PDFObject,
  PDFContext,
  StandardFonts,
  rgb,
  PDFRawStream,
  degrees,
  drawLinesOfText,
  drawRectangle,
  pushGraphicsState,
  popGraphicsState,
  PDFOperator,
  PDFForm,
  PDFPage,
  PDFFont,
} from "pdf-lib";
import { pdfText } from "./pdf/text-string.ts";
import { appendTaggedStream, removeTaggedStreams } from "./pdf/content-streams.ts";
import { stripExternalPageLinks } from "./pdf/link-targets.ts";
import { walkEmbeddedFiles } from "./pdf/name-tree.ts";
import { visibleBox, clampRectToBox } from "./pdf/page-box.ts";
import type { ShapeKind } from "../types/document";
import type { MergeInputItem, OperationManifestItem, OcrPageResult } from "../types/operations";

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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const annotationId = (() => {
  let sequence = 0;
  return () => {
    sequence++;
    return `navpdf-annotation-${Date.now()}-${sequence}`;
  };
})();

export function toPdfDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  return `D:${y}${m}${d}${h}${min}${s}Z`;
}

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
    const box = visibleBox(page);
    const quads = input.quads
      .map((quad) => ({
        x1: clamp(quad.x1, box.x, box.x + box.width),
        y1: clamp(quad.y1, box.y, box.y + box.height),
        x2: clamp(quad.x2, box.x, box.x + box.width),
        y2: clamp(quad.y2, box.y, box.y + box.height),
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
    const color = (input.color ?? [1, 0.9, 0.2]).map((channel) => clamp(channel, 0, 1));
    const opacity = clamp(input.opacity ?? (kind === "Highlight" ? 0.4 : 1), 0, 1);
    const context = doc.context;
    const dateStr = toPdfDate();
    const annotation = context.obj({
      Type: "Annot",
      Subtype: kind,
      Rect: rect,
      QuadPoints: quadPoints,
      C: color,
      CA: opacity,
      F: 4,
      P: page.ref,
      M: pdfText(dateStr),
      CreationDate: pdfText(dateStr),
      NM: pdfText(input.id ?? annotationId()),
      T: pdfText(input.author ?? "NavPDF"),
      Contents: pdfText(input.contents ?? ""),
    });
    page.node.addAnnot(context.register(annotation));
    added++;
  }
  if (added === 0) throw new Error("No text markup could be placed on the page.");
  return doc.save();
}

export interface StickyNoteInput {
  page: number;
  x: number;
  y: number;
  contents: string;
  color?: [number, number, number];
  author?: string;
  size?: number;
  id?: string;
}

/** Add standard PDF sticky notes with persistent comments. */
export async function addStickyNote(
  pdfBytes: Uint8Array,
  input: StickyNoteInput,
): Promise<Uint8Array> {
  if (!input.contents.trim()) throw new Error("A sticky note needs some text.");
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = input.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount())
    throw new Error("Sticky note page is outside the document.");
  if (![input.x, input.y].every(finite)) throw new Error("Sticky note position is invalid.");
  const page = doc.getPage(pageIndex);
  const box = visibleBox(page);
  const size = clamp(input.size ?? 24, 12, 64);
  const x = clamp(input.x, box.x, Math.max(box.x, box.x + box.width - size));
  const y = clamp(input.y, box.y + size, box.y + box.height);
  const context = doc.context;
  const dateStr = toPdfDate();
  const textRef = context.nextRef();
  const popupRef = context.nextRef();
  const popupRect = [
    clamp(x + size, box.x, box.x + box.width),
    clamp(y - size - 80, box.y, box.y + box.height),
    clamp(x + size + 160, box.x, box.x + box.width),
    clamp(y, box.y, box.y + box.height),
  ];
  const annotation = context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [x, y - size, x + size, y],
    C: input.color ?? [0.96, 0.81, 0.35],
    F: 4,
    Name: "Comment",
    Open: false,
    P: page.ref,
    M: pdfText(dateStr),
    CreationDate: pdfText(dateStr),
    Popup: popupRef,
    NM: pdfText(input.id ?? annotationId()),
    T: pdfText(input.author ?? "NavPDF"),
    Contents: pdfText(input.contents.trim()),
  });
  const popup = context.obj({
    Type: "Annot",
    Subtype: "Popup",
    Rect: popupRect,
    P: page.ref,
    Parent: textRef,
    Open: false,
    M: pdfText(dateStr),
  });
  context.assign(textRef, annotation);
  context.assign(popupRef, popup);
  page.node.addAnnot(textRef);
  page.node.addAnnot(popupRef);
  return doc.save();
}

export interface ReplyInput {
  parentId: string;
  contents: string;
  author?: string;
  id?: string;
}

/** Add a standard PDF reply linked to an existing markup annotation. */
export async function addReply(pdfBytes: Uint8Array, input: ReplyInput): Promise<Uint8Array> {
  if (!input.contents.trim()) throw new Error("A reply needs some text.");
  const doc = await PDFDocument.load(pdfBytes);
  const found = findAnnotation(doc, input.parentId);
  if (!found) throw new Error("The parent annotation no longer exists.");
  const target = found.annotation.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asRectangle();
  if (!target) throw new Error("The parent annotation has no usable bounds.");
  const context = doc.context;
  const parentEntry = found.annots.get(found.index);
  const reply = context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [
      target.x,
      target.y,
      target.x + Math.min(24, target.width),
      target.y + Math.min(24, target.height),
    ],
    F: 4,
    P: found.page.ref,
    IRT: parentEntry,
    RT: PDFName.of("R"),
    NM: pdfText(input.id ?? annotationId()),
    T: pdfText(input.author ?? "NavPDF"),
    Contents: pdfText(input.contents.trim()),
    M: pdfText(toPdfDate()),
  });
  found.page.node.addAnnot(context.register(reply));
  return doc.save();
}

export type ReviewState = "Accepted" | "Rejected" | "Cancelled" | "Completed";

/** Persist a PDF review state annotation linked to an existing comment. */
export async function setReviewState(
  pdfBytes: Uint8Array,
  annotationIdValue: string,
  state: ReviewState,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const found = findAnnotation(doc, annotationIdValue);
  if (!found) throw new Error("The annotation no longer exists.");
  const target = found.annotation.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asRectangle();
  if (!target) throw new Error("The annotation has no usable bounds.");
  const context = doc.context;
  const stateAnnotation = context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [target.x, target.y, target.x + 1, target.y + 1],
    F: 4,
    P: found.page.ref,
    IRT: found.annots.get(found.index),
    RT: PDFName.of("Group"),
    State: PDFName.of(state),
    StateModel: PDFName.of("Review"),
    NM: pdfText(annotationId()),
    Contents: pdfText(`${state} ${annotationIdValue}`),
    M: pdfText(toPdfDate()),
  });
  found.page.node.addAnnot(context.register(stateAnnotation));
  return doc.save();
}

export interface StampInput {
  page: number;
  rect: [number, number, number, number];
  name?: string;
  contents?: string;
  id?: string;
}

/** Add a standard named stamp annotation with a bounded rectangle. */
export async function addStampAnnotation(
  pdfBytes: Uint8Array,
  input: StampInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = input.page - 1;
  if (pageIndex < 0 || pageIndex >= doc.getPageCount())
    throw new Error("Stamp page is outside the document.");
  const page = doc.getPage(pageIndex);
  const box = visibleBox(page);
  const [x1, y1, x2, y2] = input.rect;
  const left = clamp(Math.min(x1, x2), box.x, box.x + box.width);
  const bottom = clamp(Math.min(y1, y2), box.y, box.y + box.height);
  const right = clamp(Math.max(x1, x2), box.x, box.x + box.width);
  const top = clamp(Math.max(y1, y2), box.y, box.y + box.height);
  if (right <= left || top <= bottom) throw new Error("Stamp must have a visible size.");
  const context = doc.context;
  const stamp = context.obj({
    Type: "Annot",
    Subtype: "Stamp",
    Rect: [left, bottom, right, top],
    Name: PDFName.of(input.name ?? "Approved"),
    F: 4,
    P: page.ref,
    NM: pdfText(input.id ?? annotationId()),
    Contents: pdfText(input.contents ?? input.name ?? "Approved"),
    M: pdfText(toPdfDate()),
  });
  page.node.addAnnot(context.register(stamp));
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
  if (![...input.start, ...input.end].every(finite)) throw new Error("Shape geometry is invalid.");
  const page = doc.getPage(pageIndex);
  const box = visibleBox(page);
  const clampPoint = ([x, y]: [number, number]): [number, number] => [
    clamp(x, box.x, box.x + box.width),
    clamp(y, box.y, box.y + box.height),
  ];
  const start = clampPoint(input.start);
  const end = clampPoint(input.end);
  if (start[0] === end[0] && start[1] === end[1])
    throw new Error("Shape must have a visible size.");
  const color = (input.color ?? [0.15, 0.38, 0.29]).map((channel) => clamp(channel, 0, 1));
  const lineWidth = clamp(input.width ?? 2, 0.5, 20);
  const opacity = clamp(input.opacity ?? 1, 0, 1);
  const isArrow = input.kind === "Arrow";
  const isLine = input.kind === "Line" || isArrow;
  const arrowheadSize = isArrow ? Math.max(10, lineWidth * 3) : 0;
  const margin = lineWidth / 2 + 2 + arrowheadSize;
  const minX = clamp(Math.min(start[0], end[0]) - margin, box.x, box.x + box.width);
  const minY = clamp(Math.min(start[1], end[1]) - margin, box.y, box.y + box.height);
  const maxX = clamp(Math.max(start[0], end[0]) + margin, box.x, box.x + box.width);
  const maxY = clamp(Math.max(start[1], end[1]) + margin, box.y, box.y + box.height);
  const context = doc.context;
  const dateStr = toPdfDate();
  const annotation = context.obj({
    Type: "Annot",
    Subtype: isLine ? "Line" : input.kind,
    Rect: [minX, minY, maxX, maxY],
    C: color,
    CA: opacity,
    F: 4,
    P: page.ref,
    M: pdfText(dateStr),
    CreationDate: pdfText(dateStr),
    BS: { W: lineWidth, S: "S" },
    NM: pdfText(input.id ?? annotationId()),
    T: pdfText(input.author ?? "NavPDF"),
    Contents: pdfText(""),
    ...(isLine
      ? {
          L: [start[0], start[1], end[0], end[1]],
          LE: [PDFName.of("None"), PDFName.of(isArrow ? "OpenArrow" : "None")],
        }
      : {}),
  });
  page.node.addAnnot(context.register(annotation));
  return doc.save();
}

export interface AnnotationUpdateInput {
  id: string;
  page?: number;
  rect?: [number, number, number, number];
  line?: [number, number, number, number];
  color?: [number, number, number];
  width?: number;
  opacity?: number;
  contents?: string;
  dx?: number;
  dy?: number;
}

export function annotationIdentifier(value: unknown): string {
  if (!value) return "";
  if (value instanceof PDFRef) {
    return value.generationNumber === 0
      ? `${value.objectNumber}R`
      : `${value.objectNumber}R${value.generationNumber}`;
  }
  const str = typeof value === "string" ? value : "";
  const match = /^(\d+)\s+(\d+)\s+R$/.exec(str);
  if (match) {
    const num = match[1];
    const gen = Number.parseInt(match[2], 10);
    return gen === 0 ? `${num}R` : `${num}R${gen}`;
  }
  return str;
}

function matchesDirectAnnotationIndex(
  entry: PDFObject,
  index: number,
  directCount: number,
  target: number | null,
): boolean {
  if (target === null) return false;
  const isDirect = !(entry instanceof PDFRef);
  return (
    (isDirect && directCount === target) ||
    (isDirect && directCount - 1 === target) ||
    index === target
  );
}

function matchesAnnotationId(entry: PDFObject, annotation: PDFDict, id: string): boolean {
  const entryIdent = annotationIdentifier(entry);
  const entryRef =
    entry instanceof PDFRef ? `${entry.objectNumber}R${entry.generationNumber}` : null;
  const shortRef = entry instanceof PDFRef ? `${entry.objectNumber}R` : null;
  const name = annotation.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText();
  return entryIdent === id || entryRef === id || shortRef === id || name === id;
}

function searchAnnotationPage(
  doc: PDFDocument,
  pageIndex: number,
  id: string,
  targetDirectIdx: number | null,
) {
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) return null;
  const page = doc.getPage(pageIndex);
  const annots = page.node.Annots();
  if (!annots) return null;
  let directCount = 0;
  for (let index = 0; index < annots.size(); index++) {
    const entry = annots.get(index);
    if (!(entry instanceof PDFRef)) directCount++;
    const annotation = annots.lookup(index, PDFDict);
    if (
      matchesDirectAnnotationIndex(entry, index, directCount, targetDirectIdx) ||
      matchesAnnotationId(entry, annotation, id)
    ) {
      return { page, annots, index, annotation };
    }
  }
  return null;
}

export function findAnnotation(doc: PDFDocument, id: string, targetPage?: number) {
  const directMatch = /^annot_(\d+)$/.exec(id);
  const targetDirectIdx = directMatch ? Number.parseInt(directMatch[1], 10) : null;

  if (targetPage !== undefined) {
    const match = searchAnnotationPage(doc, targetPage - 1, id, targetDirectIdx);
    if (match) return match;
  }

  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex++) {
    if (targetPage !== undefined && pageIndex === targetPage - 1) continue;
    const match = searchAnnotationPage(doc, pageIndex, id, targetDirectIdx);
    if (match) return match;
  }
  return null;
}

type AnnotationBox = ReturnType<typeof visibleBox>;

function annotationHasArrow(annotation: PDFDict): boolean {
  const lineEndings = annotation.lookupMaybe(PDFName.of("LE"), PDFArray);
  return Boolean(
    lineEndings &&
    Array.from({ length: lineEndings.size() }).some((_, index) => {
      const value = lineEndings.lookupMaybe(index, PDFName)?.asString()?.toLowerCase() ?? "";
      return value.includes("arrow");
    }),
  );
}

function setLineGeometry(
  annotation: PDFDict,
  context: PDFContext,
  box: AnnotationBox,
  start: [number, number],
  end: [number, number],
  width?: number,
) {
  annotation.set(PDFName.of("L"), context.obj([...start, ...end]));
  const existingBS = annotation.lookupMaybe(PDFName.of("BS"), PDFDict);
  const existingWidth = existingBS?.lookupMaybe(PDFName.of("W"), PDFNumber)?.asNumber();
  const lineWidth = clamp(width ?? existingWidth ?? 2, 0.5, 20);
  const arrowheadSize = annotationHasArrow(annotation) ? Math.max(10, lineWidth * 3) : 0;
  const margin = lineWidth / 2 + 2 + arrowheadSize;
  annotation.set(
    PDFName.of("Rect"),
    context.obj([
      clamp(Math.min(start[0], end[0]) - margin, box.x, box.x + box.width),
      clamp(Math.min(start[1], end[1]) - margin, box.y, box.y + box.height),
      clamp(Math.max(start[0], end[0]) + margin, box.x, box.x + box.width),
      clamp(Math.max(start[1], end[1]) + margin, box.y, box.y + box.height),
    ]),
  );
}

function translateAnnotation(
  annotation: PDFDict,
  context: PDFContext,
  box: AnnotationBox,
  input: AnnotationUpdateInput,
) {
  if (input.dx === undefined && input.dy === undefined) return;
  const dx = input.dx ?? 0;
  const dy = input.dy ?? 0;
  const existingLine = annotation.lookupMaybe(PDFName.of("L"), PDFArray);
  if (existingLine?.size() === 4) {
    const start: [number, number] = [
      clamp((existingLine.get(0) as PDFNumber).asNumber() + dx, box.x, box.x + box.width),
      clamp((existingLine.get(1) as PDFNumber).asNumber() + dy, box.y, box.y + box.height),
    ];
    const end: [number, number] = [
      clamp((existingLine.get(2) as PDFNumber).asNumber() + dx, box.x, box.x + box.width),
      clamp((existingLine.get(3) as PDFNumber).asNumber() + dy, box.y, box.y + box.height),
    ];
    setLineGeometry(annotation, context, box, start, end, input.width);
    return;
  }
  const existingRect = annotation.lookupMaybe(PDFName.of("Rect"), PDFArray);
  if (existingRect?.size() !== 4) return;
  const rect = existingRect.asRectangle();
  annotation.set(
    PDFName.of("Rect"),
    context.obj([
      clamp(rect.x + dx, box.x, box.x + box.width),
      clamp(rect.y + dy, box.y, box.y + box.height),
      clamp(rect.x + rect.width + dx, box.x, box.x + box.width),
      clamp(rect.y + rect.height + dy, box.y, box.y + box.height),
    ]),
  );
}

function updateRectangle(
  annotation: PDFDict,
  context: PDFContext,
  box: AnnotationBox,
  rect?: [number, number, number, number],
) {
  if (!rect) return;
  if (!rect.every(finite)) throw new Error("Annotation geometry is invalid.");
  const [x1, y1, x2, y2] = rect;
  const left = clamp(Math.min(x1, x2), box.x, box.x + box.width);
  const bottom = clamp(Math.min(y1, y2), box.y, box.y + box.height);
  const right = clamp(Math.max(x1, x2), box.x, box.x + box.width);
  const top = clamp(Math.max(y1, y2), box.y, box.y + box.height);
  if (right <= left || top <= bottom) throw new Error("Annotation must have a visible size.");
  annotation.set(PDFName.of("Rect"), context.obj([left, bottom, right, top]));
}

function updateLine(
  annotation: PDFDict,
  context: PDFContext,
  box: AnnotationBox,
  line?: [number, number, number, number],
  width?: number,
) {
  if (!line) return;
  if (!line.every(finite)) throw new Error("Annotation line is invalid.");
  const [x1, y1, x2, y2] = line;
  const start: [number, number] = [
    clamp(x1, box.x, box.x + box.width),
    clamp(y1, box.y, box.y + box.height),
  ];
  const end: [number, number] = [
    clamp(x2, box.x, box.x + box.width),
    clamp(y2, box.y, box.y + box.height),
  ];
  if (start[0] === end[0] && start[1] === end[1])
    throw new Error("Annotation line must have a visible size.");
  setLineGeometry(annotation, context, box, start, end, width);
}

function updateAnnotationAppearance(
  annotation: PDFDict,
  context: PDFContext,
  input: AnnotationUpdateInput,
) {
  if (input.color) {
    if (!input.color.every(finite)) throw new Error("Annotation color is invalid.");
    annotation.set(
      PDFName.of("C"),
      context.obj(input.color.map((channel) => clamp(channel, 0, 1))),
    );
  }
  if (input.opacity !== undefined) {
    if (!finite(input.opacity)) throw new Error("Annotation opacity is invalid.");
    annotation.set(PDFName.of("CA"), PDFNumber.of(clamp(input.opacity, 0, 1)));
  }
  if (input.width !== undefined) {
    if (!finite(input.width)) throw new Error("Annotation width is invalid.");
    annotation.set(PDFName.of("BS"), context.obj({ W: clamp(input.width, 0.5, 20), S: "S" }));
  }
  if (input.contents !== undefined) annotation.set(PDFName.of("Contents"), pdfText(input.contents));
}

/** Update the persisted geometry and drawing properties of one annotation. */
export async function updateAnnotation(
  pdfBytes: Uint8Array,
  input: AnnotationUpdateInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const found = findAnnotation(doc, input.id, input.page);
  if (!found) throw new Error("The selected annotation no longer exists.");
  const box = visibleBox(found.page);
  const context = doc.context;
  found.annotation.set(PDFName.of("M"), pdfText(toPdfDate()));
  if (input.width !== undefined && !finite(input.width)) {
    throw new Error("Annotation width is invalid.");
  }
  translateAnnotation(found.annotation, context, box, input);
  updateRectangle(found.annotation, context, box, input.rect);
  updateLine(found.annotation, context, box, input.line, input.width);
  updateAnnotationAppearance(found.annotation, context, input);
  return doc.save();
}

/** Remove one annotation while leaving page content and other annotations intact. */
function collectRelatedAnnotationRefs(
  annots: PDFArray,
  targetEntry: PDFObject,
  annotation: PDFDict,
): Set<string> {
  const refsToDelete = new Set<string>();
  if (targetEntry instanceof PDFRef) refsToDelete.add(targetEntry.toString());
  const popup = annotation.get(PDFName.of("Popup"));
  if (popup instanceof PDFRef) refsToDelete.add(popup.toString());
  const parent = annotation.get(PDFName.of("Parent"));
  if (parent instanceof PDFRef) refsToDelete.add(parent.toString());
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.get(i);
      const entryKey = entry instanceof PDFRef ? entry.toString() : null;
      if (entryKey && refsToDelete.has(entryKey)) continue;
      const annotDict = annots.lookup(i, PDFDict);
      const replyTo = annotDict.get(PDFName.of("IRT"));
      if (!(replyTo instanceof PDFRef) || !refsToDelete.has(replyTo.toString())) continue;
      if (entryKey) {
        refsToDelete.add(entryKey);
        changed = true;
      }
      const childPopup = annotDict.get(PDFName.of("Popup"));
      if (childPopup instanceof PDFRef && !refsToDelete.has(childPopup.toString())) {
        refsToDelete.add(childPopup.toString());
        changed = true;
      }
    }
  }
  return refsToDelete;
}

function shouldDeleteAnnotation(
  index: number,
  foundIndex: number,
  entry: PDFObject,
  annotation: PDFDict,
  id: string,
  refsToDelete: Set<string>,
): boolean {
  const entryKey = entry instanceof PDFRef ? entry.toString() : null;
  const name = annotation.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText();
  return index === foundIndex || (entryKey !== null && refsToDelete.has(entryKey)) || name === id;
}

export async function deleteAnnotation(
  pdfBytes: Uint8Array,
  id: string,
  page?: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const found = findAnnotation(doc, id, page);
  if (!found) throw new Error("The selected annotation no longer exists.");

  const annots = found.annots;
  const targetEntry = annots.get(found.index);
  const refsToDelete = collectRelatedAnnotationRefs(annots, targetEntry, found.annotation);

  for (let i = annots.size() - 1; i >= 0; i--) {
    const entry = annots.get(i);
    const annotDict = annots.lookup(i, PDFDict);
    if (shouldDeleteAnnotation(i, found.index, entry, annotDict, id, refsToDelete)) {
      annots.remove(i);
    }
  }

  if (annots.size() === 0) found.page.node.delete(PDFName.of("Annots"));
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
  const sorted = [...new Set(pageIndices)].filter((i) => i >= 0 && i < total).sort((a, b) => b - a);

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
export async function reorderPages(pdfBytes: Uint8Array, newOrder: number[]): Promise<Uint8Array> {
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

/** Duplicate selected pages in their original order, including page resources and annotations. */
export async function duplicatePages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const selected = [...new Set(pageIndices)]
    .filter((index) => index >= 0 && index < doc.getPageCount())
    .sort((a, b) => a - b);
  let offset = 0;
  for (const originalIndex of selected) {
    const sourceIndex = originalIndex + offset;
    const [copy] = await doc.copyPages(doc, [sourceIndex]);
    doc.insertPage(sourceIndex + 1, copy);
    offset++;
  }
  return doc.save();
}

/** Insert pages copied from another PDF without carrying external page links across documents. */
export async function insertDocumentPages(
  pdfBytes: Uint8Array,
  otherBytes: Uint8Array,
  atIndex: number,
  pageIndices?: number[],
): Promise<Uint8Array> {
  const destination = await PDFDocument.load(pdfBytes);
  const source = await PDFDocument.load(otherBytes);
  const all = source.getPageIndices();
  const selected = (pageIndices ?? all).filter((index) => index >= 0 && index < all.length);
  if (selected.length === 0) throw new Error("No valid pages selected to insert.");
  stripExternalPageLinks(source, new Set(selected));
  const copied = await destination.copyPages(source, selected);
  const index = Math.max(0, Math.min(atIndex, destination.getPageCount()));
  copied.forEach((page, offset) => destination.insertPage(index + offset, page));
  return destination.save();
}

/** Replace one page while retaining the destination page count and surrounding page order. */
export async function replacePage(
  pdfBytes: Uint8Array,
  pageIndex: number,
  otherBytes: Uint8Array,
  otherPageIndex = 0,
): Promise<Uint8Array> {
  const destination = await PDFDocument.load(pdfBytes);
  const source = await PDFDocument.load(otherBytes);
  if (pageIndex < 0 || pageIndex >= destination.getPageCount()) {
    throw new Error("Destination page is outside the document.");
  }
  if (otherPageIndex < 0 || otherPageIndex >= source.getPageCount()) {
    throw new Error("Source page is outside the document.");
  }
  stripExternalPageLinks(source, new Set([otherPageIndex]));
  const [replacement] = await destination.copyPages(source, [otherPageIndex]);
  destination.removePage(pageIndex);
  destination.insertPage(pageIndex, replacement);
  return destination.save();
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
  stripExternalPageLinks(srcDoc, new Set(valid));
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
  const image = type === "png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
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
  cropBox: { x?: number; y?: number; width: number; height: number },
): Promise<Uint8Array> {
  validateCropBox(cropBox);
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const indexSet = new Set(pageIndices.filter((i) => i >= 0 && i < total));
  for (const index of indexSet) {
    cropPage(doc.getPage(index), cropBox);
  }
  return doc.save();
}

function validateCropBox(cropBox: { x?: number; y?: number; width: number; height: number }) {
  const invalid =
    !finite(cropBox.width) ||
    !finite(cropBox.height) ||
    cropBox.width <= 0 ||
    cropBox.height <= 0 ||
    (cropBox.x !== undefined && !finite(cropBox.x)) ||
    (cropBox.y !== undefined && !finite(cropBox.y));
  if (invalid) throw new Error("Crop dimensions must be positive finite values.");
}

function cropPage(
  page: ReturnType<PDFDocument["getPage"]>,
  cropBox: { x?: number; y?: number; width: number; height: number },
) {
  const box = visibleBox(page);
  const originX =
    cropBox.x !== undefined && cropBox.x >= box.x ? cropBox.x : box.x + (cropBox.x ?? 0);
  const originY =
    cropBox.y !== undefined && cropBox.y >= box.y ? cropBox.y : box.y + (cropBox.y ?? 0);
  const targetW = Math.min(cropBox.width, Math.max(0, box.x + box.width - originX));
  const targetH = Math.min(cropBox.height, Math.max(0, box.y + box.height - originY));
  if (targetW <= 0 || targetH <= 0) {
    throw new Error("The crop rectangle does not intersect the selected page.");
  }
  page.setCropBox(originX, originY, targetW, targetH);
}

export async function mergeDocuments(inputs: (Uint8Array | MergeInputItem)[]): Promise<Uint8Array> {
  if (inputs.length === 0) {
    throw new Error("At least one document is required to merge.");
  }
  const mergedDoc = await PDFDocument.create();
  for (const input of inputs) {
    await appendMergeInput(mergedDoc, input);
  }
  if (mergedDoc.getPageCount() === 0) {
    throw new Error("No valid pages were selected to merge.");
  }
  return mergedDoc.save();
}

async function appendMergeInput(
  mergedDoc: PDFDocument,
  input: Uint8Array | MergeInputItem,
): Promise<void> {
  const isItem = !(input instanceof Uint8Array) && typeof input === "object" && "bytes" in input;
  const bytes = isItem ? input.bytes : input;
  const ranges = isItem ? input.ranges : undefined;
  const doc = await PDFDocument.load(bytes);
  const allIndices = doc.getPageIndices();
  const pageIndices =
    ranges && ranges.length > 0
      ? ranges.filter((index) => index >= 0 && index < allIndices.length)
      : allIndices;
  if (pageIndices.length === 0) return;
  if (pageIndices.length < allIndices.length) stripExternalPageLinks(doc, new Set(pageIndices));
  const copied = await mergedDoc.copyPages(doc, pageIndices);
  for (const page of copied) mergedDoc.addPage(page);
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
  const results: SplitResult[] = [];
  let partIndex = 0;
  for (const range of ranges) {
    const srcDoc = await PDFDocument.load(pdfBytes);
    const total = srcDoc.getPageCount();
    const valid = range.filter((i) => i >= 0 && i < total);
    if (valid.length > 0) {
      partIndex++;
      stripExternalPageLinks(srcDoc, new Set(valid));
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

export function computeInsertMapping(
  total: number,
  insertIndex: number,
  insertedCount = 1,
): number[] {
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
  const image = type === "png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
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

export async function inspectStructure(pdfBytes: Uint8Array): Promise<StructureSummary> {
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
export async function describeStructureLoss(sources: Uint8Array[]): Promise<string> {
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
  type: "text" | "checkbox" | "radio" | "dropdown" | "button" | "signature";
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

interface FieldGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

function requireUnusedField(form: PDFForm, name: string) {
  if (form.getFieldMaybe(name)) throw new Error(`A form field named "${name}" already exists.`);
}

function addTextField(
  form: PDFForm,
  page: PDFPage,
  definition: FormFieldDefinition,
  geometry: FieldGeometry,
) {
  requireUnusedField(form, definition.name);
  const field = form.createTextField(definition.name);
  if (definition.multiline) field.enableMultiline();
  if (definition.required) field.enableRequired();
  if (definition.readOnly) field.enableReadOnly();
  if (definition.defaultValue) field.setText(definition.defaultValue);
  field.addToPage(page, geometry);
}

function addCheckboxField(
  form: PDFForm,
  page: PDFPage,
  definition: FormFieldDefinition,
  geometry: FieldGeometry,
) {
  requireUnusedField(form, definition.name);
  const field = form.createCheckBox(definition.name);
  if (definition.required) field.enableRequired();
  if (definition.readOnly) field.enableReadOnly();
  const value = (definition.defaultValue ?? "").toLowerCase();
  if (["true", "yes", "checked", "1"].includes(value)) field.check();
  field.addToPage(page, geometry);
}

function addRadioField(
  form: PDFForm,
  page: PDFPage,
  definition: FormFieldDefinition,
  geometry: FieldGeometry,
) {
  const groupName = (definition.group || definition.name).trim();
  const existing = form.getFieldMaybe(groupName);
  const radioGroup = existing
    ? existing instanceof PDFRadioGroup
      ? existing
      : (() => {
          throw new TypeError(`Field "${groupName}" already exists and is not a radio group.`);
        })()
    : form.createRadioGroup(groupName);
  const optionName = definition.defaultValue || `Option ${radioGroup.getOptions().length + 1}`;
  radioGroup.addOptionToPage(optionName, page, geometry);
  if (definition.required) radioGroup.enableRequired();
  if (definition.readOnly) radioGroup.enableReadOnly();
}

function addDropdownField(
  form: PDFForm,
  page: PDFPage,
  definition: FormFieldDefinition,
  geometry: FieldGeometry,
) {
  requireUnusedField(form, definition.name);
  const field = form.createDropdown(definition.name);
  const options = definition.options?.length ? definition.options : ["Option 1", "Option 2"];
  field.addOptions(options);
  if (definition.defaultValue && options.includes(definition.defaultValue)) {
    field.select(definition.defaultValue);
  }
  if (definition.required) field.enableRequired();
  if (definition.readOnly) field.enableReadOnly();
  field.addToPage(page, geometry);
}

function addButtonField(
  form: PDFForm,
  page: PDFPage,
  definition: FormFieldDefinition,
  geometry: FieldGeometry,
) {
  requireUnusedField(form, definition.name);
  const field = form.createButton(definition.name);
  field.addToPage(definition.label || definition.defaultValue || "Submit", page, geometry);
}

function addSignatureField(
  doc: PDFDocument,
  form: PDFForm,
  page: PDFPage,
  definition: FormFieldDefinition,
  geometry: FieldGeometry,
) {
  requireUnusedField(form, definition.name);
  const context = doc.context;
  const appearance = context.formXObject([], {
    BBox: context.obj([0, 0, geometry.width, geometry.height]),
    Resources: context.obj({}),
  });
  const appearanceRef = context.register(appearance);
  const field = context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    T: pdfText(definition.name),
    F: 4,
    Rect: context.obj([
      geometry.x,
      geometry.y,
      geometry.x + geometry.width,
      geometry.y + geometry.height,
    ]),
    P: page.ref,
    AP: context.obj({ N: appearanceRef }),
  });
  const fieldRef = context.register(field);
  doc.catalog.getOrCreateAcroForm().addField(fieldRef);
  const annots = page.node.Annots() ?? context.obj([]);
  annots.push(fieldRef);
  page.node.set(PDFName.of("Annots"), annots);
}

function createFormField(
  doc: PDFDocument,
  form: PDFForm,
  page: PDFPage,
  definition: FormFieldDefinition,
  geometry: FieldGeometry,
) {
  switch (definition.type) {
    case "text":
      addTextField(form, page, definition, geometry);
      break;
    case "checkbox":
      addCheckboxField(form, page, definition, geometry);
      break;
    case "radio":
      addRadioField(form, page, definition, geometry);
      break;
    case "dropdown":
      addDropdownField(form, page, definition, geometry);
      break;
    case "button":
      addButtonField(form, page, definition, geometry);
      break;
    case "signature":
      addSignatureField(doc, form, page, definition, geometry);
      break;
  }
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
  const box = visibleBox(page);

  const name = definition.name.trim();
  if (!name) throw new Error("Field name cannot be empty.");

  const x = clamp(definition.x, box.x, box.x + box.width - 10);
  const y = clamp(definition.y, box.y, box.y + box.height - 10);
  const width = Math.max(10, Math.min(definition.width, box.x + box.width - x));
  const height = Math.max(10, Math.min(definition.height, box.y + box.height - y));

  createFormField(doc, form, page, definition, { x, y, width, height });

  return doc.save();
}

export interface FormFieldUpdate {
  name: string;
  value?: string;
  checked?: boolean;
  required?: boolean;
  readOnly?: boolean;
}

function updateFieldFlags(field: ReturnType<PDFForm["getField"]>, update: FormFieldUpdate) {
  if (update.required !== undefined) {
    if (update.required) field.enableRequired();
    else field.disableRequired();
  }
  if (update.readOnly !== undefined) {
    if (update.readOnly) field.enableReadOnly();
    else field.disableReadOnly();
  }
}

function applyFieldValue(field: ReturnType<PDFForm["getField"]>, value: string | undefined) {
  if (value === undefined) return;
  if (field instanceof PDFTextField) {
    field.setText(value);
    return;
  }
  if (field instanceof PDFCheckBox) {
    if (value) field.check();
    else field.uncheck();
    return;
  }
  if (field instanceof PDFRadioGroup) {
    if (!value) {
      field.clear();
      return;
    }
    if (!field.getOptions().includes(value)) {
      throw new Error(`The radio option "${value}" is not available.`);
    }
    field.select(value);
    return;
  }
  if (field instanceof PDFDropdown) {
    if (!value) {
      field.clear();
      return;
    }
    if (!field.getOptions().includes(value)) {
      throw new Error(`The dropdown option "${value}" is not available.`);
    }
    field.select(value);
    return;
  }
  throw new Error(`Form field "${field.getName()}" does not accept text values.`);
}

/** Update an existing standard AcroForm field while preserving its widget. */
export async function updateFormField(
  pdfBytes: Uint8Array<ArrayBuffer>,
  update: FormFieldUpdate,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const form = doc.getForm();
  const name = update.name.trim();
  const field = form.getFieldMaybe(name);
  if (!field) throw new Error(`Form field "${name}" was not found.`);
  updateFieldFlags(field, update);
  if (field instanceof PDFCheckBox && update.checked !== undefined) {
    if (update.checked) field.check();
    else field.uncheck();
  } else {
    applyFieldValue(field, update.value);
  }

  return doc.save();
}

/** Remove an existing field and all of its widgets from a PDF. */
export async function deleteFormField(
  pdfBytes: Uint8Array<ArrayBuffer>,
  name: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const form = doc.getForm();
  const normalizedName = name.trim();
  const field = form.getFieldMaybe(normalizedName);
  if (!field) throw new Error(`Form field "${normalizedName}" was not found.`);
  form.removeField(field);
  return doc.save();
}

/** Validate glyph coverage for Standard 14 PDF fonts (WinAnsi encoding). */
export function validateStandardFontCoverage(text: string): {
  valid: boolean;
  unsupportedChars: string[];
} {
  const unsupported: string[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) continue;
    const isWinAnsi =
      (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255) ||
      [
        0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
        0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
        0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
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

export type StandardFontFamily = "Helvetica" | "Helvetica-Bold" | "Times-Roman" | "Courier";

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
      } else if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        lines.push(word);
        currentLine = "";
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }
  return lines;
}

function standardFont(family: StandardFontFamily | undefined): StandardFonts {
  switch (family) {
    case "Helvetica-Bold":
      return StandardFonts.HelveticaBold;
    case "Times-Roman":
      return StandardFonts.TimesRoman;
    case "Courier":
      return StandardFonts.Courier;
    default:
      return StandardFonts.Helvetica;
  }
}

function drawTextContent(
  page: PDFPage,
  font: PDFFont,
  lines: string[],
  options: InsertTextOptions,
  box: AnnotationBox,
) {
  const fontSize = clamp(options.fontSize ?? 14, 4, 144);
  const lineHeight = options.lineHeight ?? fontSize * 1.25;
  const colorTuple = options.color ?? [0.14, 0.2, 0.18];
  const color = rgb(colorTuple[0], colorTuple[1], colorTuple[2]);
  const opacity = options.opacity === undefined ? 1 : clamp(options.opacity, 0, 1);
  const x = clamp(options.x, box.x, box.x + box.width - 10);
  const y = clamp(options.y, box.y + fontSize, box.y + box.height - fontSize);
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    const containerWidth = options.maxWidth && options.maxWidth > 0 ? options.maxWidth : lineWidth;
    const offset =
      options.alignment === "center"
        ? (containerWidth - lineWidth) / 2
        : options.alignment === "right"
          ? containerWidth - lineWidth
          : 0;
    page.drawText(line, {
      x: x + offset,
      y: y - index * lineHeight,
      size: fontSize,
      font,
      color,
      opacity,
    });
  }
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
  const box = visibleBox(page);

  const font = await doc.embedFont(standardFont(options.fontFamily));
  const fontSize = clamp(options.fontSize ?? 14, 4, 144);
  const lines =
    options.maxWidth && options.maxWidth > 0
      ? wrapText(options.text, font, fontSize, options.maxWidth)
      : options.text.split("\n");
  drawTextContent(page, font, lines, options, box);
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
  rotationDegrees?: number;
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
  const box = visibleBox(page);

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
    const maxW = options.maxWidth ?? options.width ?? box.width * 0.5;
    const maxH = options.maxHeight ?? options.height ?? box.height * 0.5;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    drawWidth = img.width * scale;
    drawHeight = img.height * scale;
  }

  const drawX =
    options.x !== undefined
      ? clamp(options.x, box.x, box.x + box.width - drawWidth)
      : box.x + (box.width - drawWidth) / 2;
  const drawY =
    options.y !== undefined
      ? clamp(options.y, box.y, box.y + box.height - drawHeight)
      : box.y + (box.height - drawHeight) / 2;
  const opacity = options.opacity !== undefined ? clamp(options.opacity, 0, 1) : 1;
  const rotationDegrees = clamp(options.rotationDegrees ?? 0, -360, 360);

  page.drawImage(img, {
    x: drawX,
    y: drawY,
    width: drawWidth,
    height: drawHeight,
    opacity,
    rotate: degrees(rotationDegrees),
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

  for (const pageIndex of targetIndices) {
    const page = doc.getPage(pageIndex);
    removeTaggedStreams(doc, page, "NavPDF_Decoration");
  }

  return doc.save();
}

/** Apply headers, footers, watermarks, or background fills with app-owned stream tagging. */
function decorationTexts(options: DocumentDecorationsOptions): string[] {
  return [
    options.watermark?.text?.trim() ? options.watermark.text : undefined,
    options.header?.left,
    options.header?.center,
    options.header?.right,
    options.footer?.left,
    options.footer?.center,
    options.footer?.right,
    options.metadata?.title,
    options.metadata?.author,
    options.metadata?.date,
  ].filter((text): text is string => Boolean(text));
}

function decorationPageIndices(pageRange: number[] | undefined, total: number): number[] {
  if (pageRange && pageRange.length > 0) {
    return pageRange.map((page) => page - 1).filter((index) => index >= 0 && index < total);
  }
  return Array.from({ length: total }, (_, index) => index);
}

type DecorationTokenFormatter = (template: string, page: number) => string;

function createDecorationTokenFormatter(
  total: number,
  today: string,
  title: string,
  author: string,
): DecorationTokenFormatter {
  return (template, page) =>
    template
      .replaceAll("{page}", () => String(page))
      .replaceAll("{total}", () => String(total))
      .replaceAll("{date}", () => today)
      .replaceAll("{title}", () => title)
      .replaceAll("{author}", () => author);
}

function drawDecorationBackground(
  doc: PDFDocument,
  page: PDFPage,
  ops: PDFOperator[],
  background: DocumentDecorationsOptions["background"],
  width: number,
  height: number,
) {
  if (!background?.color) return;
  const [r, g, b] = background.color;
  const opacity = clamp(background.opacity ?? 0.2, 0, 1);
  const graphicsState = page.node.newExtGState(
    "NavPDF_BgGS",
    doc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity }),
  );
  ops.push(
    ...drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: rgb(r, g, b),
      rotate: degrees(0),
      xSkew: degrees(0),
      ySkew: degrees(0),
      borderWidth: 0,
      borderColor: undefined,
      graphicsState,
    }),
  );
}

function drawWatermark(
  doc: PDFDocument,
  page: PDFPage,
  ops: PDFOperator[],
  watermark: DocumentDecorationsOptions["watermark"],
  font: PDFFont,
  fontKey: PDFName,
  fontBold: PDFFont,
  fontBoldKey: PDFName,
  width: number,
  height: number,
) {
  const settings = watermark;
  if (!settings) return;
  const text = settings.text?.trim();
  if (!text) return;
  const fontSize = clamp(settings.fontSize ?? 48, 12, 120);
  const colorTuple = settings.color ?? [0.7, 0.2, 0.2];
  const graphicsState = page.node.newExtGState(
    "NavPDF_WmGS",
    doc.context.obj({
      Type: "ExtGState",
      ca: clamp(settings.opacity ?? 0.2, 0.05, 1),
      CA: clamp(settings.opacity ?? 0.2, 0.05, 1),
    }),
  );
  ops.push(
    ...drawLinesOfText([fontBold.encodeText(text)], {
      color: rgb(colorTuple[0], colorTuple[1], colorTuple[2]),
      font: fontBoldKey,
      size: fontSize,
      rotate: degrees(settings.rotationDegrees ?? 45),
      xSkew: degrees(0),
      ySkew: degrees(0),
      x: (width - font.widthOfTextAtSize(text, fontSize)) / 2,
      y: height / 2,
      lineHeight: fontSize * 1.2,
      graphicsState,
    }),
  );
}

function drawHeaderFooter(
  ops: PDFOperator[],
  font: PDFFont,
  fontKey: PDFName,
  slot: DecorationHeaderFooterSlot | undefined,
  y: number,
  width: number,
  pageNumber: number,
  formatTokens: DecorationTokenFormatter,
) {
  if (!slot) return;
  const textColor = rgb(0.4, 0.4, 0.4);
  const positions: [string | undefined, "left" | "center" | "right"][] = [
    [slot.left, "left"],
    [slot.center, "center"],
    [slot.right, "right"],
  ];
  for (const [template, alignment] of positions) {
    if (!template) continue;
    const text = formatTokens(template, pageNumber);
    const textWidth = font.widthOfTextAtSize(text, 10);
    const x =
      alignment === "center"
        ? (width - textWidth) / 2
        : alignment === "right"
          ? width - textWidth - 40
          : 40;
    ops.push(
      ...drawLinesOfText([font.encodeText(text)], {
        x,
        y,
        size: 10,
        font: fontKey,
        color: textColor,
        rotate: degrees(0),
        xSkew: degrees(0),
        ySkew: degrees(0),
        lineHeight: 12,
      }),
    );
  }
}

function renderDecorationPage(
  doc: PDFDocument,
  page: PDFPage,
  options: DocumentDecorationsOptions,
  font: PDFFont,
  fontBold: PDFFont,
  pageNumber: number,
  formatTokens: DecorationTokenFormatter,
) {
  const { width, height } = page.getSize();
  const fontKey = page.node.newFontDictionary("NavPDF_DecFont", font.ref);
  const fontBoldKey = page.node.newFontDictionary("NavPDF_DecFontBold", fontBold.ref);
  const ops: PDFOperator[] = [pushGraphicsState()];
  drawDecorationBackground(doc, page, ops, options.background, width, height);
  drawWatermark(
    doc,
    page,
    ops,
    options.watermark,
    font,
    fontKey,
    fontBold,
    fontBoldKey,
    width,
    height,
  );
  drawHeaderFooter(
    ops,
    font,
    fontKey,
    options.header,
    height - 30,
    width,
    pageNumber,
    formatTokens,
  );
  drawHeaderFooter(ops, font, fontKey, options.footer, 25, width, pageNumber, formatTokens);
  ops.push(popGraphicsState());
  if (ops.length > 2) appendTaggedStream(doc, page, "NavPDF_Decoration", ops);
}

export async function applyDocumentDecorations(
  pdfBytes: Uint8Array,
  options: DocumentDecorationsOptions,
): Promise<Uint8Array> {
  const coverage = validateStandardFontCoverage(decorationTexts(options).join(" "));
  if (!coverage.valid) {
    throw new Error(
      `Unsupported characters for standard PDF fonts: ${coverage.unsupportedChars.join(", ")}`,
    );
  }

  // First strip existing decorations in target pages so repeated calls do not stack
  const cleanedBytes = await removeDocumentDecorations(pdfBytes, options.pageRange);
  const doc = await PDFDocument.load(cleanedBytes);
  const total = doc.getPageCount();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const targetIndices = decorationPageIndices(options.pageRange, total);

  const today = options.metadata?.date || new Date().toLocaleDateString();
  const docTitle = options.metadata?.title || doc.getTitle() || "";
  const docAuthor = options.metadata?.author || doc.getAuthor() || "";

  const formatTokens = createDecorationTokenFormatter(total, today, docTitle, docAuthor);

  for (const pageIndex of targetIndices) {
    renderDecorationPage(
      doc,
      doc.getPage(pageIndex),
      options,
      font,
      fontBold,
      pageIndex + 1,
      formatTokens,
    );
  }

  return doc.save();
}

export interface BatesNumberingOptions {
  prefix?: string;
  suffix?: string;
  startNumber?: number;
  padding?: number;
  pageIndices?: number[]; // 0-based; all pages if omitted
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "bottom-center";
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
  const batesTextsToValidate = [prefix, suffix].filter(Boolean).join(" ");
  if (batesTextsToValidate) {
    const coverage = validateStandardFontCoverage(batesTextsToValidate);
    if (!coverage.valid) {
      throw new Error(
        `Unsupported characters for standard PDF fonts: ${coverage.unsupportedChars.join(", ")}`,
      );
    }
  }
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

    const fontBoldKey = page.node.newFontDictionary("NavPDF_BatesFontBold", fontBold.ref);
    const ops: PDFOperator[] = [
      pushGraphicsState(),
      ...drawLinesOfText([fontBold.encodeText(batesText)], {
        x,
        y,
        size: fontSize,
        font: fontBoldKey,
        color,
        rotate: degrees(0),
        xSkew: degrees(0),
        ySkew: degrees(0),
        lineHeight: fontSize * 1.2,
      }),
      popGraphicsState(),
    ];

    appendTaggedStream(doc, page, "NavPDF_Decoration", ops);
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
  const box = visibleBox(page);
  const clampedRect = clampRectToBox(options.rect, box);
  if (clampedRect[2] <= clampedRect[0] || clampedRect[3] <= clampedRect[1]) {
    throw new Error("Invalid link rectangle geometry.");
  }

  let linkAnnot: PDFDict;
  if (options.target.type === "url") {
    const urlCheck = validateSafeUrl(options.target.url ?? "");
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      throw new Error(urlCheck.reason || "Invalid URL destination.");
    }
    linkAnnot = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: clampedRect,
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: pdfText(urlCheck.normalizedUrl),
      },
    });
  } else {
    const targetPageIndex = (options.target.targetPage ?? 1) - 1;
    if (targetPageIndex < 0 || targetPageIndex >= doc.getPageCount()) {
      throw new Error("Target destination page does not exist.");
    }
    const targetPageRef = doc.getPage(targetPageIndex).ref;
    const destArray = doc.context.obj([targetPageRef, PDFName.of("XYZ"), null, null, null]);
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
      annot instanceof PDFDict && annot.get(PDFName.of("Subtype")) === PDFName.of("Link");
    if (isLink) {
      if (linkCount === annotationIndex) {
        linkCount++;
        continue;
      }
      linkCount++;
    }
    remaining.push(annotRef as PDFRef | PDFDict);
  }

  pageLeaf.node.set(PDFName.of("Annots"), doc.context.obj(remaining as unknown as PDFObject[]));
  return doc.save();
}

export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Sanitize an attachment filename to prevent directory traversal and illegal characters. */
export function sanitizeAttachmentFilename(filename: string): string {
  if (!filename) return "attachment.bin";
  let clean = Array.from(filename)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // Bidirectional overrides and isolates can disguise an extension ("txt.exe").
      const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
      return code >= 32 && code !== 127 && !bidi;
    })
    .join("");
  const lastSlash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (lastSlash >= 0) {
    clean = clean.slice(lastSlash + 1);
  }
  clean = clean.replaceAll(/\.\.+/g, "");
  clean = clean.trim();
  while (clean.startsWith(".")) clean = clean.slice(1);
  while (clean.endsWith(".")) clean = clean.slice(0, -1);
  clean = clean.replaceAll(/[/:*?"<>|\\]+/g, "_");
  return clean || "attachment.bin";
}

export interface EmbeddedAttachmentSummary {
  name: string;
  size?: number;
  description?: string;
}

/** List all embedded file attachments in the PDF document catalog. */
function embeddedAttachmentDescription(doc: PDFDocument, fileSpec: PDFDict): string | undefined {
  const value = doc.context.lookup(fileSpec.get(PDFName.of("Desc"))) as unknown;
  if (value && typeof (value as { decodeText?: () => string }).decodeText === "function") {
    return (value as { decodeText: () => string }).decodeText();
  }
  return undefined;
}

function embeddedAttachmentSize(doc: PDFDocument, fileSpec: PDFDict): number | undefined {
  const efDict = doc.context.lookup(fileSpec.get(PDFName.of("EF")));
  if (!(efDict instanceof PDFDict)) return undefined;
  const stream = doc.context.lookup(efDict.get(PDFName.of("F"))) as unknown;
  if (!stream || typeof (stream as { getContents?: () => Uint8Array }).getContents !== "function") {
    return undefined;
  }
  const dict = (stream as { dict?: PDFDict }).dict;
  const params = dict ? doc.context.lookup(dict.get(PDFName.of("Params"))) : undefined;
  const size = params instanceof PDFDict ? params.get(PDFName.of("Size")) : undefined;
  return size instanceof PDFNumber
    ? size.asNumber()
    : (stream as { getContents: () => Uint8Array }).getContents().length;
}

function summarizeEmbeddedAttachment(
  doc: PDFDocument,
  entry: ReturnType<typeof walkEmbeddedFiles>[number],
  index: number,
): EmbeddedAttachmentSummary {
  return {
    name: entry.name || `attachment-${index + 1}`,
    size: embeddedAttachmentSize(doc, entry.fileSpec),
    description: embeddedAttachmentDescription(doc, entry.fileSpec),
  };
}

export async function listEmbeddedAttachments(
  pdfBytes: Uint8Array,
): Promise<EmbeddedAttachmentSummary[]> {
  const doc = await PDFDocument.load(pdfBytes);
  const entries = walkEmbeddedFiles(doc);
  return entries.map((entry, index) => summarizeEmbeddedAttachment(doc, entry, index));
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
    description: description || `Attached by NavPDF on ${new Date().toLocaleDateString()}`,
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
  const entries = walkEmbeddedFiles(doc);
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;

  const fileSpec = entry.fileSpec;
  const efDict = doc.context.lookup(fileSpec.get(PDFName.of("EF")));
  if (!(efDict instanceof PDFDict)) return null;
  const stream = doc.context.lookup(efDict.get(PDFName.of("F"))) as unknown;
  if (!stream) return null;
  if (!(stream instanceof PDFRawStream)) return null;
  return decodeBoundedStream(stream, MAX_ATTACHMENT_SIZE_BYTES);
}

function removeEmbeddedNameTreeEntry(
  doc: PDFDocument,
  entry: ReturnType<typeof walkEmbeddedFiles>[number],
): void {
  const names = doc.context.lookup(entry.containingDict.get(PDFName.of("Names")));
  if (!(names instanceof PDFArray)) throw new Error("Attachment not found.");
  const remaining: (PDFRef | PDFObject)[] = [];
  for (let index = 0; index < names.size(); index += 2) {
    if (index !== entry.indexInNames) remaining.push(names.get(index), names.get(index + 1));
  }
  entry.containingDict.set(PDFName.of("Names"), doc.context.obj(remaining));
  if (!entry.containingDict.has(PDFName.of("Limits"))) return;
  if (remaining.length < 2) {
    entry.containingDict.delete(PDFName.of("Limits"));
    return;
  }
  entry.containingDict.set(PDFName.of("Limits"), doc.context.obj([remaining[0], remaining.at(-2)]));
}

function removeAssociatedFile(
  doc: PDFDocument,
  entry: ReturnType<typeof walkEmbeddedFiles>[number],
) {
  const associatedFiles = doc.context.lookup(doc.catalog.get(PDFName.of("AF")));
  if (!(associatedFiles instanceof PDFArray)) return;
  const remaining: PDFObject[] = [];
  for (let index = 0; index < associatedFiles.size(); index++) {
    const item = associatedFiles.get(index);
    if (entry.fileSpecRef && item instanceof PDFRef && item.tag === entry.fileSpecRef.tag) continue;
    if (doc.context.lookup(item) === entry.fileSpec) continue;
    remaining.push(item);
  }
  doc.catalog.set(PDFName.of("AF"), doc.context.obj(remaining));
}

/** Delete an embedded file attachment from the catalog. */
export async function deleteEmbeddedAttachment(
  pdfBytes: Uint8Array,
  name: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const entries = walkEmbeddedFiles(doc);
  const entry = entries.find((e) => e.name === name);
  if (!entry) throw new Error("Attachment not found.");
  removeEmbeddedNameTreeEntry(doc, entry);
  removeAssociatedFile(doc, entry);

  return doc.save();
}

function streamContainsText(streamObj: unknown): boolean {
  if (!(streamObj instanceof PDFRawStream)) return false;
  const text = new TextDecoder().decode(decodeBoundedStream(streamObj, MAX_ATTACHMENT_SIZE_BYTES));
  return /\b(BT|Tj|TJ)\b/.test(text);
}

function resourcesContainText(
  resourcesObj: unknown,
  context: PDFContext,
  visited: Set<unknown> = new Set(),
): boolean {
  if (!resourcesObj || visited.has(resourcesObj)) return false;
  visited.add(resourcesObj);

  const resDict =
    resourcesObj instanceof PDFDict ? resourcesObj : (resourcesObj as { dict?: PDFDict })?.dict;
  if (!resDict) return false;

  const xobject = context.lookup(resDict.get(PDFName.of("XObject")));
  if (!xobject || !(xobject instanceof PDFDict)) return false;

  return xobjectsContainText(xobject, context, visited);
}

function xobjectsContainText(
  xobject: PDFDict,
  context: PDFContext,
  visited: Set<unknown>,
): boolean {
  for (const [, valRef] of xobject.entries()) {
    if (xobjectEntryContainsText(valRef, context, visited)) return true;
  }
  return false;
}

function xobjectEntryContainsText(
  value: PDFObject,
  context: PDFContext,
  visited: Set<unknown>,
): boolean {
  const xobjStream = context.lookup(value);
  if (!xobjStream || visited.has(xobjStream)) return false;
  visited.add(xobjStream);

  const xobjDict =
    xobjStream instanceof PDFDict ? xobjStream : (xobjStream as { dict?: PDFDict })?.dict;
  if (xobjDict?.get(PDFName.of("Subtype")) !== PDFName.of("Form")) return false;
  if (xobjDict.get(PDFName.of("NavPDF_OCR"))) return false;
  if (streamContainsText(xobjStream)) return true;

  const subResources = context.lookup(xobjDict.get(PDFName.of("Resources")));
  return Boolean(subResources && resourcesContainText(subResources, context, visited));
}

function contentStreamRefs(contents: PDFObject | PDFArray | undefined): PDFObject[] {
  if (contents instanceof PDFArray) {
    return Array.from({ length: contents.size() }, (_, index) => contents.get(index));
  }
  if (contents) return [contents];
  return [];
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
  const streamRefs = contentStreamRefs(page.node.Contents());

  for (const ref of streamRefs) {
    const streamObj = doc.context.lookup(ref);
    const dict =
      streamObj instanceof PDFDict ? streamObj : (streamObj as unknown as { dict?: PDFDict })?.dict;

    if (dict?.get(PDFName.of("NavPDF_OCR"))) {
      continue;
    }

    if (streamContainsText(streamObj)) {
      return true;
    }
  }

  const resources = doc.context.lookup(page.node.get(PDFName.of("Resources")));
  if (resources && resourcesContainText(resources, doc.context)) {
    return true;
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

  for (const pageIndex of targetIndices) {
    const page = doc.getPage(pageIndex);
    removeTaggedStreams(doc, page, "NavPDF_OCR");
  }

  return doc.save();
}

function validateOcrWord(word: OcrPageResult["lines"][number]["words"][number]) {
  const [xNorm, yNorm, wNorm, hNorm] = word.bbox;
  const valid =
    word.bbox.every(Number.isFinite) &&
    xNorm >= 0 &&
    yNorm >= 0 &&
    wNorm > 0 &&
    hNorm > 0 &&
    xNorm + wNorm <= 1.01 &&
    yNorm + hNorm <= 1.01;
  if (!valid) throw new Error("OCR returned an invalid text rectangle.");
}

async function appendOcrPageLayer(
  doc: PDFDocument,
  font: PDFFont,
  pageResult: OcrPageResult,
): Promise<void> {
  const page = doc.getPage(pageResult.pageIndex);
  const { x: cropX, y: cropY, width, height } = page.getCropBox();
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const ops: PDFOperator[] = [
    { toString: () => "q\n1 0 0 1 0 0 cm\nBT\n3 Tr" } as PDFOperator,
    { toString: () => `/${fontKey.asString().slice(1)} 12 Tf` } as PDFOperator,
  ];

  for (const line of pageResult.lines) {
    for (const word of line.words) {
      if (!word.text?.trim()) continue;
      validateOcrWord(word);
      const [xNorm, yNorm, wNorm, hNorm] = word.bbox;
      const x = (cropX + xNorm * width).toFixed(2);
      const y = (cropY + yNorm * height).toFixed(2);
      const fontSize = Math.max(hNorm * height * 0.85, 4);
      let encodedText: string;
      try {
        encodedText = font.encodeText(word.text).toString();
      } catch {
        throw new Error(
          "This OCR text needs a font not supported by searchable export. Use Extract Text Only.",
        );
      }
      const advance = [...word.text].reduce(
        (sum, glyph) => sum + font.widthOfTextAtSize(glyph, fontSize),
        0,
      );
      const horizontalScale = (wNorm * width) / advance;
      ops.push(
        { toString: () => `/${fontKey.asString().slice(1)} ${fontSize} Tf` } as PDFOperator,
        { toString: () => `${horizontalScale.toFixed(6)} 0 0 1 ${x} ${y} Tm` } as PDFOperator,
        { toString: () => `${encodedText} Tj` } as PDFOperator,
      );
    }
  }
  ops.push({ toString: () => "0 Tr\nET\nQ" } as PDFOperator);
  appendTaggedStream(doc, page, "NavPDF_OCR", ops);
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
    await appendOcrPageLayer(doc, font, pageRes);
  }

  return doc.save();
}

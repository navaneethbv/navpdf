// Operations on several comments at once, each saved as one document change: moving, deleting,
// reshaping lines and polygons, and copying comments with their pop-ups and replies to paste
// into this or another document.

import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFRef,
  PDFString,
  type PDFContext,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import { deleteAnnotationIn, findAnnotation, toPdfDate } from "../document-commands";
import { generateAppearance } from "./annotation-appearance";
import { visibleBox } from "./page-box";

/** The most comments one move, delete or copy acts on. */
export const MAX_BATCH_COMMENTS = 500;
/** Text markup belongs to its text and is never moved. */
const TEXT_MARKUP = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);
/** The /F flag that stops a comment from being moved, resized or deleted in readers. */
const LOCKED_FLAG = 1 << 7;
/** Keys of arrays of x, y pairs that move with a comment. */
const POINT_ARRAYS = ["L", "Vertices", "QuadPoints", "CL"] as const;

type Box = ReturnType<typeof visibleBox>;

function numbers(array: PDFArray | undefined): number[] {
  if (!array) return [];
  return array.asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN));
}

function subtypeOf(annotation: PDFDict) {
  return annotation.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() ?? "";
}

/** Whether readers should leave the comment where it is. */
export function isLocked(annotation: PDFDict) {
  const flags = annotation.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
  return (flags & LOCKED_FLAG) !== 0;
}

function checkCount(ids: readonly string[]) {
  if (ids.length === 0) throw new Error("Select a comment first.");
  if (ids.length > MAX_BATCH_COMMENTS)
    throw new Error(`Select at most ${MAX_BATCH_COMMENTS} comments at once.`);
}

/** Shift every point the comment stores, so its appearance and geometry move together. */
function shiftGeometry(annotation: PDFDict, context: PDFContext, dx: number, dy: number) {
  const rect = numbers(annotation.lookupMaybe(PDFName.of("Rect"), PDFArray));
  if (rect.length === 4 && rect.every(Number.isFinite))
    annotation.set(
      PDFName.of("Rect"),
      context.obj([rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy]),
    );
  for (const key of POINT_ARRAYS) {
    const values = numbers(annotation.lookupMaybe(PDFName.of(key), PDFArray));
    if (values.length < 2 || !values.every(Number.isFinite)) continue;
    annotation.set(
      PDFName.of(key),
      context.obj(values.map((value, index) => value + (index % 2 === 0 ? dx : dy))),
    );
  }
  const ink = annotation.lookupMaybe(PDFName.of("InkList"), PDFArray);
  if (ink) {
    const strokes = ink.asArray().map((stroke) => {
      const values = numbers(context.lookupMaybe(stroke, PDFArray));
      return values.map((value, index) => value + (index % 2 === 0 ? dx : dy));
    });
    if (strokes.every((stroke) => stroke.every(Number.isFinite)))
      annotation.set(PDFName.of("InkList"), context.obj(strokes));
  }
}

/** The offset clamped so the comment's rectangle stays on the visible page. */
function clampedOffset(annotation: PDFDict, box: Box, dx: number, dy: number): [number, number] {
  const rect = numbers(annotation.lookupMaybe(PDFName.of("Rect"), PDFArray));
  if (rect.length !== 4 || !rect.every(Number.isFinite)) return [dx, dy];
  const [x1, y1, x2, y2] = [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3]),
  ];
  const fit = (delta: number, low: number, high: number, min: number, max: number) =>
    high - low > max - min ? delta : Math.min(Math.max(delta, min - low), max - high);
  return [fit(dx, x1, x2, box.x, box.x + box.width), fit(dy, y1, y2, box.y, box.y + box.height)];
}

export interface MoveResult {
  bytes: Uint8Array;
  moved: number;
  /** Text markup and locked comments, which stay where they are. */
  skipped: number;
}

/**
 * Move comments by an offset in PDF points, together with their pop-ups, as one change. Each
 * stays on its visible page; text markup and locked comments are left in place.
 */
export async function moveAnnotations(
  bytes: Uint8Array,
  ids: readonly string[],
  dx: number,
  dy: number,
): Promise<MoveResult> {
  checkCount(ids);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 1e5 || Math.abs(dy) > 1e5)
    throw new Error("The move is not valid.");
  const doc = await PDFDocument.load(bytes);
  let moved = 0;
  let skipped = 0;
  for (const id of new Set(ids)) {
    const found = findAnnotation(doc, id);
    if (!found) throw new Error("A selected comment no longer exists.");
    const { annotation, page } = found;
    if (TEXT_MARKUP.has(subtypeOf(annotation)) || isLocked(annotation)) {
      skipped++;
      continue;
    }
    const [x, y] = clampedOffset(annotation, visibleBox(page), dx, dy);
    shiftGeometry(annotation, doc.context, x, y);
    const popup = annotation.lookupMaybe(PDFName.of("Popup"), PDFDict);
    if (popup) shiftGeometry(popup, doc.context, x, y);
    annotation.set(PDFName.of("M"), PDFString.of(toPdfDate()));
    moved++;
  }
  if (moved === 0) throw new Error("Text markup and locked comments stay where they are.");
  return { bytes: await doc.save(), moved, skipped };
}

/** Delete comments with their pop-ups and replies as one change. */
export async function deleteAnnotations(bytes: Uint8Array, ids: readonly string[]) {
  checkCount(ids);
  const doc = await PDFDocument.load(bytes);
  let deleted = 0;
  for (const id of new Set(ids)) if (deleteAnnotationIn(doc, id)) deleted++;
  if (deleted === 0) throw new Error("The selected comments no longer exist.");
  return { bytes: await doc.save(), deleted };
}

/** Points a reshaped comment can have: a line's two ends or a polygon's corners. */
export function reshapePoints(
  annotation: PDFDict,
): { key: "L" | "Vertices"; points: number[] } | null {
  const subtype = subtypeOf(annotation);
  if (subtype === "Line") {
    const line = numbers(annotation.lookupMaybe(PDFName.of("L"), PDFArray));
    return line.length === 4 && line.every(Number.isFinite) ? { key: "L", points: line } : null;
  }
  if (subtype === "Polygon" || subtype === "PolyLine") {
    const vertices = numbers(annotation.lookupMaybe(PDFName.of("Vertices"), PDFArray));
    return vertices.length >= 4 && vertices.length % 2 === 0 && vertices.every(Number.isFinite)
      ? { key: "Vertices", points: vertices }
      : null;
  }
  return null;
}

/** Space around a reshaped line or polygon for its width, endings and cloudy border. */
function outlineMargin(annotation: PDFDict) {
  const width =
    annotation
      .lookupMaybe(PDFName.of("BS"), PDFDict)
      ?.lookupMaybe(PDFName.of("W"), PDFNumber)
      ?.asNumber() ?? 1;
  const endings = annotation.lookupMaybe(PDFName.of("LE"), PDFArray);
  const hasEnding = !!endings
    ?.asArray()
    .some((name) => name instanceof PDFName && name.decodeText() !== "None");
  const cloudy = !!annotation.lookupMaybe(PDFName.of("BE"), PDFDict);
  return width / 2 + 2 + Math.max(hasEnding ? Math.max(10, width * 5) : 0, cloudy ? 6 : 0);
}

/**
 * Move one end of a line or one corner of connected lines, a polygon or a cloud, as one change.
 * The rectangle follows the new outline and the appearance is redrawn so every reader shows it.
 */
export async function reshapeAnnotation(
  bytes: Uint8Array,
  id: string,
  index: number,
  point: [number, number],
): Promise<Uint8Array> {
  if (!point.every(Number.isFinite)) throw new Error("The new point is not valid.");
  const doc = await PDFDocument.load(bytes);
  const found = findAnnotation(doc, id);
  if (!found) throw new Error("The selected comment no longer exists.");
  const { annotation, page } = found;
  if (isLocked(annotation)) throw new Error("This comment is locked.");
  const shape = reshapePoints(annotation);
  if (!shape) throw new Error("Only lines, connected lines and polygons can be reshaped.");
  const count = shape.points.length / 2;
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new Error("Choose an end or corner of the comment.");
  const box = visibleBox(page);
  const x = Math.min(Math.max(point[0], box.x), box.x + box.width);
  const y = Math.min(Math.max(point[1], box.y), box.y + box.height);
  const points = [...shape.points];
  points[index * 2] = x;
  points[index * 2 + 1] = y;
  const context = doc.context;
  annotation.set(PDFName.of(shape.key), context.obj(points));
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const margin = outlineMargin(annotation);
  annotation.set(
    PDFName.of("Rect"),
    context.obj([
      Math.max(box.x, Math.min(...xs) - margin),
      Math.max(box.y, Math.min(...ys) - margin),
      Math.min(box.x + box.width, Math.max(...xs) + margin),
      Math.min(box.y + box.height, Math.max(...ys) + margin),
    ]),
  );
  annotation.set(PDFName.of("M"), PDFString.of(toPdfDate()));
  // Another reader's appearance shows the old outline; NavPDF draws the new one instead.
  const appearance = generateAppearance(doc, annotation);
  if (appearance) annotation.set(PDFName.of("AP"), context.obj({ N: appearance }));
  else annotation.delete(PDFName.of("AP"));
  return doc.save();
}

/** Comments copied to paste elsewhere, kept as a one-page PDF that holds only them. */
export interface CommentClip {
  bytes: Uint8Array;
  /** Comments copied, not counting pop-ups and replies. */
  count: number;
  /** The page they were copied from, for pasting at the same place. */
  page: number;
  /** Plain text of the comments, written to the system clipboard. */
  text: string;
}

function refKey(value: PDFObject | undefined) {
  return value instanceof PDFRef ? value.toString() : null;
}

/** The selected comments and everything that belongs to them on their page. */
function relatedEntries(annots: PDFArray, roots: Set<string>) {
  const keep = new Set(roots);
  let grown = true;
  while (grown) {
    grown = false;
    for (let index = 0; index < annots.size(); index++) {
      const key = refKey(annots.get(index));
      if (!key || keep.has(key)) continue;
      const dict = annots.lookupMaybe(index, PDFDict);
      const parent =
        refKey(dict?.get(PDFName.of("IRT"))) ?? refKey(dict?.get(PDFName.of("Parent")));
      if (parent && keep.has(parent)) {
        keep.add(key);
        grown = true;
      }
    }
  }
  return keep;
}

/**
 * Cut links from the comments to copy to anything outside them, so the copier does not pull in
 * the source page tree, structure tree or unrelated comments.
 */
function detachForCopy(source: PDFDocument, refs: PDFRef[], keep: Set<string>) {
  for (const ref of refs) {
    const dict = source.context.lookup(ref, PDFDict);
    dict.delete(PDFName.of("P"));
    dict.delete(PDFName.of("StructParent"));
    const parent = refKey(dict.get(PDFName.of("Parent")));
    if (parent && !keep.has(parent)) dict.delete(PDFName.of("Parent"));
    const irt = refKey(dict.get(PDFName.of("IRT")));
    if (irt && !keep.has(irt)) dict.delete(PDFName.of("IRT"));
    const popup = refKey(dict.get(PDFName.of("Popup")));
    if (popup && !keep.has(popup)) dict.delete(PDFName.of("Popup"));
  }
}

function textOf(annotation: PDFDict) {
  return (
    annotation.lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)?.decodeText() ?? ""
  );
}

/**
 * Copy comments with their pop-ups and replies. All must be on one page; the copy keeps their
 * appearance, style and text but not their page, structure tags or form links.
 */
export async function copyAnnotations(
  bytes: Uint8Array,
  ids: readonly string[],
): Promise<CommentClip> {
  checkCount(ids);
  const source = await PDFDocument.load(bytes);
  let pageIndex = -1;
  const roots = new Set<string>();
  const texts: string[] = [];
  for (const id of new Set(ids)) {
    const found = findAnnotation(source, id);
    if (!found) throw new Error("A selected comment no longer exists.");
    const index = source.getPages().indexOf(found.page);
    if (pageIndex >= 0 && index !== pageIndex)
      throw new Error("Copy comments from one page at a time.");
    pageIndex = index;
    const subtype = subtypeOf(found.annotation);
    if (subtype === "Widget" || subtype === "Link" || subtype === "Popup")
      throw new Error("Only comments can be copied.");
    const key = refKey(found.annots.get(found.index));
    if (!key) throw new Error("This comment cannot be copied.");
    roots.add(key);
    const text = textOf(found.annotation).trim();
    if (text) texts.push(text);
  }
  const page = source.getPage(pageIndex);
  const annots = page.node.Annots()!;
  const keep = relatedEntries(annots, roots);
  const refs = annots
    .asArray()
    .filter((entry): entry is PDFRef => entry instanceof PDFRef && keep.has(entry.toString()));
  detachForCopy(source, refs, keep);
  const clip = await PDFDocument.create();
  const box = visibleBox(page);
  // Same box and rotation as the source, so a render of the clip lines up with the page.
  const clipPage = clip.addPage([box.width, box.height]);
  clipPage.setMediaBox(box.x, box.y, box.width, box.height);
  clipPage.setRotation(degrees(page.getRotation().angle));
  const copier = PDFObjectCopier.for(source.context, clip.context);
  // Copying by reference keeps reply and pop-up links between the copies.
  const copied = refs.map((ref) => copier.copy(ref));
  clipPage.node.set(PDFName.of("Annots"), clip.context.obj(copied));
  // The clip page records the source box so pasting can place comments at the same spot.
  clipPage.node.set(
    PDFName.of("NavPDFSourceBox"),
    clip.context.obj([box.x, box.y, box.width, box.height]),
  );
  return {
    bytes: await clip.save(),
    count: roots.size,
    page: pageIndex + 1,
    text: texts.join("\n\n"),
  };
}

function uniqueName(existing: Set<string>) {
  let name: string;
  do name = `navpdf-${crypto.randomUUID()}`;
  while (existing.has(name));
  existing.add(name);
  return name;
}

function annotationNames(doc: PDFDocument) {
  const names = new Set<string>();
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index++) {
      const name = annots
        .lookupMaybe(index, PDFDict)
        ?.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)
        ?.decodeText();
      if (name) names.add(name);
    }
  }
  return names;
}

export interface PasteResult {
  bytes: Uint8Array;
  /** Names of the pasted comments, not counting pop-ups and replies. */
  ids: string[];
}

/**
 * Paste copied comments onto a page as one change. They keep their place from the source page,
 * shifted by `offset` points down and right, and stay within the target's visible page.
 */
export async function pasteAnnotations(
  bytes: Uint8Array,
  clip: CommentClip,
  pageNumber: number,
  offset: number,
): Promise<PasteResult> {
  const doc = await PDFDocument.load(bytes);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.getPageCount())
    throw new Error("Choose a page to paste on.");
  const source = await PDFDocument.load(clip.bytes);
  const clipPage = source.getPage(0);
  const annots = clipPage.node.Annots();
  if (!annots || annots.size() === 0) throw new Error("There are no copied comments to paste.");
  if (annots.size() > MAX_BATCH_COMMENTS * 4) throw new Error("Too many comments to paste.");
  const page: PDFPage = doc.getPage(pageNumber - 1);
  const box = visibleBox(page);
  const [sx, sy] = numbers(clipPage.node.lookupMaybe(PDFName.of("NavPDFSourceBox"), PDFArray));
  // Same offset from the visible page's corner, then stepped down and to the right.
  const baseDx = box.x - (Number.isFinite(sx) ? sx : 0) + offset;
  const baseDy = box.y - (Number.isFinite(sy) ? sy : 0) - offset;
  const copier = PDFObjectCopier.for(source.context, doc.context);
  const names = annotationNames(doc);
  const pasted: PDFRef[] = [];
  const ids: string[] = [];
  const dicts: PDFDict[] = [];
  for (let index = 0; index < annots.size(); index++) {
    const entry = annots.get(index);
    if (!(entry instanceof PDFRef)) continue;
    const ref = copier.copy(entry);
    const dict = doc.context.lookupMaybe(ref, PDFDict);
    if (!dict) continue;
    dicts.push(dict);
    pasted.push(ref);
  }
  // One offset for the whole group, clamped so the group's bounds stay on the page.
  const bounds = dicts
    .map((dict) => numbers(dict.lookupMaybe(PDFName.of("Rect"), PDFArray)))
    .filter((rect) => rect.length === 4 && rect.every(Number.isFinite));
  let dx = baseDx;
  let dy = baseDy;
  if (bounds.length) {
    const left = Math.min(...bounds.map((r) => Math.min(r[0], r[2]))) + dx;
    const right = Math.max(...bounds.map((r) => Math.max(r[0], r[2]))) + dx;
    const bottom = Math.min(...bounds.map((r) => Math.min(r[1], r[3]))) + dy;
    const top = Math.max(...bounds.map((r) => Math.max(r[1], r[3]))) + dy;
    if (right - left <= box.width) {
      if (left < box.x) dx += box.x - left;
      else if (right > box.x + box.width) dx -= right - box.x - box.width;
    }
    if (top - bottom <= box.height) {
      if (bottom < box.y) dy += box.y - bottom;
      else if (top > box.y + box.height) dy -= top - box.y - box.height;
    }
  }
  const now = PDFString.of(toPdfDate());
  for (const dict of dicts) {
    // An appearance follows its rectangle, so moving the rectangle moves what readers draw.
    shiftGeometry(dict, doc.context, dx, dy);
    dict.set(PDFName.of("P"), page.ref);
    const name = uniqueName(names);
    dict.set(PDFName.of("NM"), PDFString.of(name));
    dict.set(PDFName.of("M"), now);
    if (!dict.has(PDFName.of("IRT")) && subtypeOf(dict) !== "Popup") ids.push(name);
  }
  const existing = page.node.Annots();
  if (existing) for (const ref of pasted) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj(pasted));
  return { bytes: await doc.save(), ids };
}

/** Annotations that are not review comments, or that importing must not copy. */
const NOT_COMMENTS = new Set([
  "Link",
  "Widget",
  "Popup",
  "Screen",
  "Movie",
  "Sound",
  "3D",
  "RichMedia",
  "PrinterMark",
  "TrapNet",
  "Watermark",
]);

export interface ImportedComments {
  bytes: Uint8Array;
  /** Comments added or replaced, not counting pop-ups and replies. */
  imported: number;
  /** Comments on pages past the end of this document. */
  outside: number;
  /** Redaction marks, which are not copied. */
  redactions: number;
}

function nameOf(dict: PDFDict) {
  return dict.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText() ?? "";
}

/**
 * Copy every comment from another PDF onto the page with the same number, at the same place
 * relative to the visible page, with its appearance, pop-up and replies. A comment whose name is
 * already used here replaces that comment. Redaction marks are left out, and a PDF that needs a
 * password is refused.
 */
export async function importCommentsFromPdf(
  bytes: Uint8Array,
  sourceBytes: Uint8Array,
): Promise<ImportedComments> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(sourceBytes);
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message))
      throw new Error("Comments cannot be imported from a password-protected PDF.", {
        cause: error,
      });
    throw new Error("Choose a valid PDF to import comments from.", { cause: error });
  }
  if (source.isEncrypted)
    throw new Error("Comments cannot be imported from a password-protected PDF.");
  const doc = await PDFDocument.load(bytes);
  const copier = PDFObjectCopier.for(source.context, doc.context);
  let imported = 0;
  let outside = 0;
  let redactions = 0;
  let total = 0;
  for (const [index, sourcePage] of source.getPages().entries()) {
    const annots = sourcePage.node.Annots();
    if (!annots) continue;
    const roots = new Set<string>();
    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.get(i);
      const dict = annots.lookupMaybe(i, PDFDict);
      if (!(entry instanceof PDFRef) || !dict) continue;
      const subtype = subtypeOf(dict);
      if (subtype === "Redact") {
        redactions++;
        continue;
      }
      if (NOT_COMMENTS.has(subtype) || dict.has(PDFName.of("IRT"))) continue;
      if (index >= doc.getPageCount()) {
        outside++;
        continue;
      }
      roots.add(entry.toString());
    }
    if (!roots.size) continue;
    if ((total += roots.size) > MAX_BATCH_COMMENTS * 20)
      throw new Error("The PDF has too many comments to import at once.");
    const keep = relatedEntries(annots, roots);
    const refs = annots
      .asArray()
      .filter((entry): entry is PDFRef => entry instanceof PDFRef && keep.has(entry.toString()));
    detachForCopy(source, refs, keep);
    const page = doc.getPage(index);
    const from = visibleBox(sourcePage);
    const to = visibleBox(page);
    for (const ref of refs) {
      const name = nameOf(source.context.lookup(ref, PDFDict));
      // Same-named comments are replaced, with their own pop-ups and replies.
      while (name && deleteAnnotationIn(doc, name, index + 1)) {
        // Each pass removes one comment of that name.
      }
    }
    for (const ref of refs) {
      const copied = copier.copy(ref);
      const dict = doc.context.lookup(copied, PDFDict);
      shiftGeometry(dict, doc.context, to.x - from.x, to.y - from.y);
      dict.set(PDFName.of("P"), page.ref);
      page.node.addAnnot(copied);
      if (roots.has(ref.toString())) imported++;
    }
  }
  if (imported === 0)
    throw new Error(
      outside
        ? "Every comment in that PDF is on a page this document does not have."
        : "That PDF has no comments to import.",
    );
  return { bytes: await doc.save(), imported, outside, redactions };
}

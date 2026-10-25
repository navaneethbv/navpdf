// Erasing parts of freehand ink annotations. Each stroke is cut where the eraser passed and the
// remaining pieces are kept as strokes of the same annotation; an emptied drawing is deleted.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, type PDFPage } from "pdf-lib";
import { generateAppearance } from "./annotation-appearance.ts";

type Point = [number, number];

/** Distance from a point to a segment. */
function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length),
        );
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

/** Whether a point lies within `radius` of the eraser's path. */
function erased(point: Point, path: Point[], radius: number) {
  const [first] = path;
  if (path.length === 1) return Math.hypot(point[0] - first[0], point[1] - first[1]) <= radius;
  return path.slice(1).some((end, index) => segmentDistance(point, path.at(index)!, end) <= radius);
}

/** Adds points along long segments so a cut falls where the eraser crossed between points. */
function densify(stroke: Point[], step: number) {
  const points: Point[] = [];
  for (const [index, point] of stroke.entries()) {
    const previous = stroke[index - 1];
    if (previous) {
      const parts = Math.floor(Math.hypot(point[0] - previous[0], point[1] - previous[1]) / step);
      for (let part = 1; part < parts; part++) {
        const t = part / parts;
        points.push([
          previous[0] + (point[0] - previous[0]) * t,
          previous[1] + (point[1] - previous[1]) * t,
        ]);
      }
    }
    points.push(point);
  }
  return points;
}

/**
 * Splits strokes into the pieces outside the eraser. A stroke the eraser does not touch is
 * returned unchanged; single leftover points are dropped.
 */
export function eraseStrokes(strokes: Point[][], path: Point[], radius: number) {
  let changed = false;
  const kept = strokes.flatMap((stroke) => {
    if (!touches(stroke, path, radius)) return [stroke];
    changed = true;
    const pieces: Point[][] = [[]];
    for (const point of densify(stroke, Math.max(radius / 2, 0.5))) {
      if (erased(point, path, radius)) {
        if (pieces.at(-1)!.length) pieces.push([]);
      } else pieces.at(-1)!.push(point);
    }
    return pieces.filter((piece) => piece.length > 1);
  });
  return { strokes: kept, changed };
}

/** Whether the eraser crosses a stroke between two of its points. */
function touches(stroke: Point[], path: Point[], radius: number) {
  return densify(stroke, Math.max(radius / 2, 0.5)).some((point) => erased(point, path, radius));
}

function inkStrokes(annotation: PDFDict): Point[][] {
  const list = annotation.lookup(PDFName.of("InkList"));
  if (!(list instanceof PDFArray)) return [];
  return list.asArray().map((stroke) => {
    const values =
      stroke instanceof PDFRef ? annotation.context.lookup(stroke, PDFArray) : (stroke as PDFArray);
    const numbers = values
      .asArray()
      .map((value) => (value instanceof PDFNumber ? value.asNumber() : Number.NaN));
    // Coordinates come in x, y pairs; an incomplete or non-numeric pair is skipped.
    return numbers
      .flatMap((x, index): Point[] =>
        index % 2 === 0 ? [[x, numbers.at(index + 1) ?? Number.NaN]] : [],
      )
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  });
}

function strokeWidth(annotation: PDFDict) {
  const style = annotation.lookup(PDFName.of("BS"));
  const width = style instanceof PDFDict ? style.lookup(PDFName.of("W")) : undefined;
  return width instanceof PDFNumber ? width.asNumber() : 1;
}

/** The ink list and fitted rectangle for an ink annotation's remaining strokes. */
function strokeEntries(doc: PDFDocument, width: number, strokes: Point[][]) {
  const margin = width / 2 + 1;
  const xs = strokes.flat().map(([x]) => x);
  const ys = strokes.flat().map(([, y]) => y);
  return {
    InkList: doc.context.obj(strokes.map((stroke) => stroke.flat())),
    Rect: doc.context.obj([
      Math.min(...xs) - margin,
      Math.min(...ys) - margin,
      Math.max(...xs) + margin,
      Math.max(...ys) + margin,
    ]),
  };
}

/** Removes emptied drawings, with their pop-up notes, from a page's annotations. */
function removeAnnotations(
  doc: PDFDocument,
  page: PDFPage,
  annots: PDFArray,
  removed: Set<number>,
) {
  const popups = new Set(
    [...removed].flatMap((index) => {
      const popup = (annots.lookup(index) as PDFDict).get(PDFName.of("Popup"));
      return popup instanceof PDFRef ? [popup.toString()] : [];
    }),
  );
  const keep = annots
    .asArray()
    .filter((entry, index) => !removed.has(index) && !popups.has(entry.toString()));
  page.node.set(PDFName.of("Annots"), doc.context.obj(keep));
}

/** Ink annotations on a page with their positions in its annotation list. */
function inkAnnotations(annots: PDFArray) {
  return annots.asArray().flatMap((_, index) => {
    const annotation = annots.lookup(index);
    return annotation instanceof PDFDict &&
      annotation.lookup(PDFName.of("Subtype")) === PDFName.of("Ink")
      ? [[index, annotation] as const]
      : [];
  });
}

/**
 * Erases ink along `path`, in PDF user space, on a 1-based page. Returns the new bytes and how
 * many ink annotations changed, including deleted ones.
 */
export async function eraseInk(
  bytes: Uint8Array,
  pageNumber: number,
  path: Point[],
  radius: number,
) {
  if (!path.length || !Number.isFinite(radius) || radius <= 0) return { bytes, changed: 0 };
  const doc = await PDFDocument.load(bytes);
  if (pageNumber < 1 || pageNumber > doc.getPageCount())
    throw new Error("That page does not exist.");
  const page = doc.getPage(pageNumber - 1);
  const annots = page.node.Annots();
  if (!annots) return { bytes, changed: 0 };
  let changed = 0;
  const removed = new Set<number>();
  for (const [index, annotation] of inkAnnotations(annots)) {
    const result = eraseStrokes(inkStrokes(annotation), path, radius);
    if (!result.changed) continue;
    changed++;
    if (!result.strokes.length) {
      removed.add(index);
      continue;
    }
    // The remaining strokes replace the old ones, and the drawing is redrawn from them.
    const entries = strokeEntries(doc, strokeWidth(annotation), result.strokes);
    for (const [key, value] of Object.entries(entries)) annotation.set(PDFName.of(key), value);
    const appearance = generateAppearance(doc, annotation);
    if (appearance) annotation.set(PDFName.of("AP"), doc.context.obj({ N: appearance }));
    else annotation.delete(PDFName.of("AP"));
  }
  if (!changed) return { bytes, changed: 0 };
  if (removed.size) removeAnnotations(doc, page, annots, removed);
  return { bytes: await doc.save(), changed };
}

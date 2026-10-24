// Erasing parts of freehand ink annotations. Each stroke is cut where the eraser passed and the
// remaining pieces are kept as strokes of the same annotation; an emptied drawing is deleted.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from "pdf-lib";
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
  if (path.length === 1) return Math.hypot(point[0] - path[0][0], point[1] - path[0][1]) <= radius;
  for (let index = 1; index < path.length; index++)
    if (segmentDistance(point, path[index - 1], path[index]) <= radius) return true;
  return false;
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
    const points: Point[] = [];
    for (let index = 0; index + 1 < numbers.length; index += 2)
      if (Number.isFinite(numbers[index]) && Number.isFinite(numbers[index + 1]))
        points.push([numbers[index], numbers[index + 1]]);
    return points;
  });
}

function strokeWidth(annotation: PDFDict) {
  const style = annotation.lookup(PDFName.of("BS"));
  const width = style instanceof PDFDict ? style.lookup(PDFName.of("W")) : undefined;
  return width instanceof PDFNumber ? width.asNumber() : 1;
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
  if (!path.length || !(radius > 0)) return { bytes, changed: 0 };
  const doc = await PDFDocument.load(bytes);
  if (pageNumber < 1 || pageNumber > doc.getPageCount())
    throw new Error("That page does not exist.");
  const page = doc.getPage(pageNumber - 1);
  const annots = page.node.Annots();
  if (!annots) return { bytes, changed: 0 };
  let changed = 0;
  const removed = new Set<number>();
  for (let index = 0; index < annots.size(); index++) {
    const annotation = annots.lookup(index);
    if (!(annotation instanceof PDFDict)) continue;
    if (annotation.lookup(PDFName.of("Subtype")) !== PDFName.of("Ink")) continue;
    const result = eraseStrokes(inkStrokes(annotation), path, radius);
    if (!result.changed) continue;
    changed++;
    if (!result.strokes.length) {
      removed.add(index);
      continue;
    }
    annotation.set(
      PDFName.of("InkList"),
      doc.context.obj(result.strokes.map((stroke) => stroke.flat())),
    );
    const margin = strokeWidth(annotation) / 2 + 1;
    const xs = result.strokes.flat().map(([x]) => x);
    const ys = result.strokes.flat().map(([, y]) => y);
    annotation.set(
      PDFName.of("Rect"),
      doc.context.obj([
        Math.min(...xs) - margin,
        Math.min(...ys) - margin,
        Math.max(...xs) + margin,
        Math.max(...ys) + margin,
      ]),
    );
    const appearance = generateAppearance(doc, annotation);
    if (appearance) annotation.set(PDFName.of("AP"), doc.context.obj({ N: appearance }));
    else annotation.delete(PDFName.of("AP"));
  }
  if (!changed) return { bytes, changed: 0 };
  if (removed.size) {
    // Deleting an emptied drawing also deletes its pop-up note.
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
  return { bytes: await doc.save(), changed };
}

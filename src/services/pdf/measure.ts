// Distance, perimeter and area measurements saved as standard measurement annotations
// (ISO 32000 section 12.9): a Line, PolyLine or Polygon with a /Measure scale, a caption and an
// appearance, so other readers show the same value.

import {
  PDFDocument,
  PDFName,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setFontAndSize,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  stroke,
  closePath,
  lineTo,
  moveTo,
  type PDFOperator,
} from "pdf-lib";
import { pdfText } from "./text-string.ts";
import { toPdfDate } from "../document-commands.ts";
import { visibleBox } from "./page-box.ts";
import {
  APPEARANCE_FONT_NAMES,
  annotationAuthor,
  embedAppearanceFonts,
  encodeStandardText,
  normalAppearance,
} from "./appearance.ts";

export type MeasureKind = "distance" | "perimeter" | "area";
export type MeasureUnit = "pt" | "in" | "ft" | "yd" | "mm" | "cm" | "m";
export type Point = [number, number];

/** A drawing scale: `pageInches` on the page represent `realValue` real units. */
export interface MeasureScale {
  pageInches: number;
  realValue: number;
  unit: MeasureUnit;
}

export const UNIT_NAMES: Record<MeasureUnit, string> = {
  pt: "points",
  in: "inches",
  ft: "feet",
  yd: "yards",
  mm: "millimeters",
  cm: "centimeters",
  m: "meters",
};

export const ACTUAL_SIZE: MeasureScale = { pageInches: 1, realValue: 1, unit: "in" };

/** Real units per PDF point (1/72 inch) under a scale. */
export function unitsPerPoint(scale: MeasureScale) {
  if (!(scale.pageInches > 0 && scale.realValue > 0))
    throw new Error("Enter a positive scale on both sides.");
  return scale.realValue / (scale.pageInches * 72);
}

export function scaleLabel(scale: MeasureScale) {
  return `${scale.pageInches} in = ${scale.realValue} ${scale.unit}`;
}

const distanceBetween = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Path length in points; a closed path includes the edge back to the start. */
export function pathLength(points: Point[], closed = false) {
  let total = 0;
  for (let index = 1; index < points.length; index++)
    total += distanceBetween(points[index - 1], points[index]);
  if (closed && points.length > 2) total += distanceBetween(points.at(-1)!, points[0]);
  return total;
}

/** Polygon area in square points by the shoelace formula. */
export function polygonArea(points: Point[]) {
  let twice = 0;
  for (let index = 0; index < points.length; index++) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** The measured value in real units, formatted with its unit. */
export function measurementText(kind: MeasureKind, points: Point[], scale: MeasureScale) {
  const factor = unitsPerPoint(scale);
  if (kind === "area")
    return `${formatNumber(polygonArea(points) * factor * factor)} sq ${scale.unit}`;
  return `${formatNumber(pathLength(points) * factor)} ${scale.unit}`;
}

const MINIMUM_POINTS: Record<MeasureKind, number> = { distance: 2, perimeter: 2, area: 3 };
const SUBTYPES: Record<MeasureKind, [string, string]> = {
  distance: ["Line", "LineDimension"],
  perimeter: ["PolyLine", "PolyLineDimension"],
  area: ["Polygon", "PolygonDimension"],
};

export interface MeasurementInput {
  page: number;
  kind: MeasureKind;
  /** Vertices in PDF user space. */
  points: Point[];
  scale: MeasureScale;
  color?: [number, number, number];
  author?: string;
}

function measureDictionary(doc: PDFDocument, scale: MeasureScale) {
  const factor = unitsPerPoint(scale);
  const format = (unit: string, conversion: number) =>
    doc.context.obj({ Type: "NumberFormat", U: pdfText(unit), C: conversion, D: 100 });
  return doc.context.obj({
    Type: "Measure",
    Subtype: "RL",
    R: pdfText(scaleLabel(scale)),
    X: [format(scale.unit, factor)],
    D: [format(scale.unit, 1)],
    // Areas use the scaled x and y conversions, so their own conversion is 1.
    A: [format(`sq ${scale.unit}`, 1)],
  });
}

/** Where the caption sits: the middle of a distance line, otherwise the vertex centroid. */
function captionAnchor(kind: MeasureKind, points: Point[]): Point {
  if (kind === "distance")
    return [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
  const sum = points.reduce<Point>((total, [x, y]) => [total[0] + x, total[1] + y], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

/** Adds one measurement with its scale, caption and appearance to a page. */
export async function addMeasurement(pdfBytes: Uint8Array, input: MeasurementInput) {
  const doc = await PDFDocument.load(pdfBytes);
  const pageIndex = input.page - 1;
  if (!Number.isInteger(input.page) || pageIndex < 0 || pageIndex >= doc.getPageCount())
    throw new Error("The measurement page is outside the document.");
  const points = input.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < MINIMUM_POINTS[input.kind])
    throw new Error(
      input.kind === "area"
        ? "Mark at least three corners to measure an area."
        : "Mark at least two points to measure a length.",
    );
  if (pathLength(points) <= 0) throw new Error("The measured points are all in one place.");
  const page = doc.getPage(pageIndex);
  const rotation = visibleBox(page).rotation;
  const label = measurementText(input.kind, points, input.scale);
  const color = input.color ?? [0.8, 0.1, 0.1];
  const fonts = await embedAppearanceFonts(doc);
  const size = 9;
  const textWidth = fonts.bold.widthOfTextAtSize(label, size);
  const [anchorX, anchorY] = captionAnchor(input.kind, points);

  // The caption runs along the displayed horizontal, centered just above the anchor, so it
  // reads upright on rotated pages.
  const radians = (rotation * Math.PI) / 180;
  const along: Point = [Math.cos(radians), Math.sin(radians)];
  const up: Point = [-along[1], along[0]];
  const offset = (base: Point, a: number, u: number): Point => [
    base[0] + along[0] * a + up[0] * u,
    base[1] + along[1] * a + up[1] * u,
  ];
  const start = offset([anchorX, anchorY], -textWidth / 2, 4);
  const caption: PDFOperator[] = [
    beginText(),
    setFontAndSize(APPEARANCE_FONT_NAMES.bold, size),
    setTextMatrix(along[0], along[1], up[0], up[1], start[0], start[1]),
    showText(encodeStandardText(fonts.bold, label)),
    endText(),
  ];
  const [first, ...rest] = points;
  const operators = [
    pushGraphicsState(),
    setStrokingRgbColor(...color),
    setFillingRgbColor(...color),
    setLineWidth(1.5),
    setLineCap(1),
    setLineJoin(1),
    moveTo(...first),
    ...rest.map((point) => lineTo(...point)),
    ...(input.kind === "area" ? [closePath()] : []),
    stroke(),
    ...caption,
    popGraphicsState(),
  ];

  const corners = [
    start,
    offset(start, textWidth, 0),
    offset(start, 0, size),
    offset(start, textWidth, size),
  ];
  const xs = [...points, ...corners].map(([x]) => x);
  const ys = [...points, ...corners].map(([, y]) => y);
  const margin = 4;
  const rect = [
    Math.min(...xs) - margin,
    Math.min(...ys) - margin,
    Math.max(...xs) + margin,
    Math.max(...ys) + margin,
  ];
  const appearance = doc.context.register(
    doc.context.formXObject(operators, {
      BBox: rect,
      Matrix: [1, 0, 0, 1, 0, 0],
      Resources: { Font: { [APPEARANCE_FONT_NAMES.bold]: fonts.bold.ref } },
    }),
  );
  const [subtype, intent] = SUBTYPES[input.kind];
  const flat = points.flat();
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: subtype,
    IT: PDFName.of(intent),
    Rect: rect,
    ...(input.kind === "distance"
      ? { L: flat, Cap: true, LE: ["None", "None"] }
      : { Vertices: flat }),
    C: color,
    BS: { W: 1.5, S: "S" },
    F: 4,
    P: page.ref,
    NM: pdfText(`navpdf-measure-${crypto.randomUUID()}`),
    T: pdfText(annotationAuthor(input.author)),
    Contents: pdfText(label),
    Subj: pdfText(input.kind === "area" ? "Area measurement" : "Length measurement"),
    M: pdfText(toPdfDate()),
    Measure: measureDictionary(doc, input.scale),
    AP: normalAppearance(doc, appearance),
  });
  page.node.addAnnot(doc.context.register(annotation));
  return { bytes: await doc.save(), label };
}

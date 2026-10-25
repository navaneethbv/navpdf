// Fallback appearances for common markup annotations that were saved without one. The drawing
// follows the annotation's own geometry and colors in default user space, so the result can be
// flattened into page content. Unsupported subtypes return null instead of guessing.

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  appendBezierCurve,
  closePath,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setDashPattern,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setFillingRgbColor,
  setStrokingRgbColor,
  stroke,
  type PDFDocument,
  type PDFOperator,
  type PDFRef,
} from "pdf-lib";

type Point = [number, number];
type Rect = [number, number, number, number];

function numbersOf(dict: PDFDict, key: string): number[] {
  const value = dict.lookup(PDFName.of(key));
  if (!(value instanceof PDFArray)) return [];
  return value
    .asArray()
    .map((item) => (item instanceof PDFNumber ? item.asNumber() : Number.NaN))
    .filter((item) => Number.isFinite(item));
}

function numberOf(dict: PDFDict, key: string, fallback: number) {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

/** DeviceGray, DeviceRGB and DeviceCMYK annotation colors as RGB, or null when absent. */
export function annotationColor(dict: PDFDict, key: "C" | "IC"): [number, number, number] | null {
  const values = numbersOf(dict, key).map((value) => Math.min(1, Math.max(0, value)));
  if (values.length === 1) return [values[0], values[0], values[0]];
  if (values.length === 3) return [values[0], values[1], values[2]];
  if (values.length === 4) {
    const [c, m, y, k] = values;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return null;
}

export function annotationRect(dict: PDFDict): Rect | null {
  const values = numbersOf(dict, "Rect");
  if (values.length < 4) return null;
  const [x1, y1, x2, y2] = values;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

function pairs(values: number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2)
    points.push([values[index], values[index + 1]]);
  return points;
}

function polyline(points: Point[], closed = false): PDFOperator[] {
  if (points.length < 2) return [];
  return [
    moveTo(...points[0]),
    ...points.slice(1).map((point) => lineTo(...point)),
    ...(closed ? [closePath()] : []),
  ];
}

function ellipse([x1, y1, x2, y2]: Rect): PDFOperator[] {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2;
  const ry = (y2 - y1) / 2;
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  return [
    moveTo(cx + rx, cy),
    appendBezierCurve(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry),
    appendBezierCurve(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy),
    appendBezierCurve(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry),
    appendBezierCurve(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy),
    closePath(),
  ];
}

function borderWidth(dict: PDFDict) {
  const style = dict.lookup(PDFName.of("BS"));
  if (style instanceof PDFDict) return numberOf(style, "W", 1);
  const border = numbersOf(dict, "Border");
  return border.length >= 3 ? border[2] : 1;
}

function dashOperators(dict: PDFDict): PDFOperator[] {
  const style = dict.lookup(PDFName.of("BS"));
  if (!(style instanceof PDFDict) || style.get(PDFName.of("S")) !== PDFName.of("D")) return [];
  const dash = numbersOf(style, "D");
  return [setDashPattern(dash.length ? dash : [3], 0)];
}

/** Quadrilaterals as [upper-left, upper-right, lower-left, lower-right] corner points. */
function quads(dict: PDFDict): Point[][] {
  const values = numbersOf(dict, "QuadPoints");
  const result: Point[][] = [];
  for (let index = 0; index + 7 < values.length; index += 8)
    result.push(pairs(values.slice(index, index + 8)));
  return result;
}

const between = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function textMarkup(dict: PDFDict, subtype: string, color: [number, number, number]) {
  const boxes = quads(dict);
  if (!boxes.length) return null;
  if (subtype === "Highlight")
    return [
      setFillingRgbColor(...color),
      ...boxes.flatMap(([ul, ur, ll, lr]) => [...polyline([ul, ur, lr, ll], true), fill()]),
    ];
  // Underline sits just above the bottom edge; strikeout crosses the middle.
  const position = subtype === "Underline" ? 0.1 : 0.5;
  return [
    setStrokingRgbColor(...color),
    ...boxes.flatMap(([ul, ur, ll, lr]) => [
      setLineWidth(Math.max(0.5, distance(ul, ll) * 0.07)),
      ...polyline([between(ll, ul, position), between(lr, ur, position)]),
      stroke(),
    ]),
  ];
}

/** The ten line ending styles of ISO 32000, in the order Acrobat lists them. */
export const LINE_ENDINGS = [
  "None",
  "Square",
  "Circle",
  "Diamond",
  "OpenArrow",
  "ClosedArrow",
  "Butt",
  "ROpenArrow",
  "RClosedArrow",
  "Slash",
] as const;
export type LineEnding = (typeof LINE_ENDINGS)[number];

/** How far a line ending reaches from its point, for a line of `width`. */
export function lineEndingSize(width: number) {
  return Math.max(9, width * 3);
}

function arrowHead(
  tip: Point,
  from: Point,
  size: number,
  closed: boolean,
  reversed = false,
): PDFOperator[] {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  // A reversed arrow opens away from the line, so its wings reach past the end point.
  const direction = reversed ? -1 : 1;
  const wing = (offset: number): Point => [
    tip[0] - direction * size * Math.cos(angle + offset),
    tip[1] - direction * size * Math.sin(angle + offset),
  ];
  return [
    ...polyline([wing(Math.PI / 6), tip, wing(-Math.PI / 6)], closed),
    closed ? fillAndStroke() : stroke(),
  ];
}

/** Draws one line ending at `tip` for a segment arriving from `from`. */
function lineEnding(name: string, tip: Point, from: Point, size: number): PDFOperator[] {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const half = size / 3;
  const across = (length: number, turn: number): Point[] => [
    [tip[0] + length * Math.cos(angle + turn), tip[1] + length * Math.sin(angle + turn)],
    [tip[0] - length * Math.cos(angle + turn), tip[1] - length * Math.sin(angle + turn)],
  ];
  switch (name) {
    case "OpenArrow":
    case "ClosedArrow":
      return arrowHead(tip, from, size, name === "ClosedArrow");
    case "ROpenArrow":
    case "RClosedArrow":
      return arrowHead(tip, from, size, name === "RClosedArrow", true);
    case "Square":
      return [
        ...polyline(
          [
            [tip[0] - half, tip[1] - half],
            [tip[0] + half, tip[1] - half],
            [tip[0] + half, tip[1] + half],
            [tip[0] - half, tip[1] + half],
          ],
          true,
        ),
        fillAndStroke(),
      ];
    case "Circle":
      return [
        ...ellipse([tip[0] - half, tip[1] - half, tip[0] + half, tip[1] + half]),
        fillAndStroke(),
      ];
    case "Diamond":
      return [
        ...polyline(
          [
            [tip[0] - half, tip[1]],
            [tip[0], tip[1] - half],
            [tip[0] + half, tip[1]],
            [tip[0], tip[1] + half],
          ],
          true,
        ),
        fillAndStroke(),
      ];
    case "Butt":
      return [...polyline(across(half, Math.PI / 2)), stroke()];
    case "Slash":
      return [...polyline(across(half, Math.PI / 3)), stroke()];
    default:
      return [];
  }
}

function lineEndings(dict: PDFDict, start: Point, end: Point, width: number): PDFOperator[] {
  return lineEndingPair(dict, [start, end], [end, start], width);
}

/** Endings for the first and last segments: `first` is [start, next], `last` is [end, previous]. */
function lineEndingPair(
  dict: PDFDict,
  first: [Point, Point],
  last: [Point, Point],
  width: number,
): PDFOperator[] {
  const endings = dict.lookup(PDFName.of("LE"));
  if (!(endings instanceof PDFArray)) return [];
  const names = endings.asArray().map((name) => (name instanceof PDFName ? name.decodeText() : ""));
  const size = lineEndingSize(width);
  // Ending shapes are drawn solid even on a dashed line.
  return [
    setDashPattern([], 0),
    ...lineEnding(names[0] ?? "", first[0], first[1], size),
    ...lineEnding(names[1] ?? "", last[0], last[1], size),
  ];
}

/** Points around an ellipse, counterclockwise, for a cloudy oval. */
function ellipsePoints([x1, y1, x2, y2]: Rect, count: number): Point[] {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 2 * Math.PI;
    return [cx + ((x2 - x1) / 2) * Math.cos(angle), cy + ((y2 - y1) / 2) * Math.sin(angle)];
  });
}

function shape(dict: PDFDict, subtype: string, rect: Rect, color: [number, number, number]) {
  const width = borderWidth(dict);
  const interior = annotationColor(dict, "IC");
  // A cloudy border bulges outward, so the shape under it is drawn further in.
  const radius = cloudy(dict);
  const inset = width / 2 + (radius ?? 0);
  const box: Rect = [rect[0] + inset, rect[1] + inset, rect[2] - inset, rect[3] - inset];
  if (radius !== null) {
    const corners: Point[] =
      subtype === "Circle"
        ? ellipsePoints(box, Math.max(8, Math.round((box[2] - box[0] + box[3] - box[1]) / radius)))
        : [
            [box[0], box[1]],
            [box[2], box[1]],
            [box[2], box[3]],
            [box[0], box[3]],
          ];
    return [
      setLineWidth(width),
      setLineJoin(1),
      setStrokingRgbColor(...color),
      ...(interior ? [setFillingRgbColor(...interior)] : []),
      ...cloudPath(corners, radius),
      interior ? fillAndStroke() : stroke(),
    ];
  }
  const path =
    subtype === "Circle"
      ? ellipse(box)
      : polyline(
          [
            [box[0], box[1]],
            [box[2], box[1]],
            [box[2], box[3]],
            [box[0], box[3]],
          ],
          true,
        );
  return [
    setLineWidth(width),
    ...dashOperators(dict),
    setStrokingRgbColor(...color),
    ...(interior ? [setFillingRgbColor(...interior)] : []),
    ...path,
    interior ? fillAndStroke() : stroke(),
  ];
}

function lines(dict: PDFDict, subtype: string, color: [number, number, number]) {
  const width = borderWidth(dict);
  const common = [
    setLineWidth(width),
    setLineCap(1),
    setLineJoin(1),
    ...dashOperators(dict),
    setStrokingRgbColor(...color),
    setFillingRgbColor(...color),
  ];
  if (subtype === "Line") {
    const [start, end] = pairs(numbersOf(dict, "L"));
    if (!start || !end) return null;
    return [
      ...common,
      ...polyline([start, end]),
      stroke(),
      ...lineEndings(dict, start, end, width),
    ];
  }
  if (subtype === "Ink") {
    const strokes = dict.lookup(PDFName.of("InkList"));
    if (!(strokes instanceof PDFArray)) return null;
    const paths = strokes.asArray().flatMap((path) => {
      if (!(path instanceof PDFArray)) return [];
      const points = pairs(
        path.asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : 0)),
      );
      return points.length > 1 ? [...polyline(points), stroke()] : [];
    });
    return paths.length ? [...common, ...paths] : null;
  }
  const vertices = pairs(numbersOf(dict, "Vertices"));
  if (vertices.length < 2) return null;
  const endings =
    subtype === "PolyLine"
      ? lineEndingPair(
          dict,
          [vertices[0], vertices[1]],
          [vertices.at(-1)!, vertices.at(-2)!],
          width,
        )
      : [];
  return [...common, ...polyline(vertices, subtype === "Polygon"), stroke(), ...endings];
}

/** Cloud radius in points for a border effect intensity, as readers draw cloudy borders. */
export function cloudRadius(intensity: number) {
  return 4 + Math.min(2, Math.max(0, intensity)) * 2;
}

/** Signed area of a closed polygon; positive when the vertices run counterclockwise. */
function signedArea(points: Point[]) {
  let area = 0;
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length];
    area += point[0] * next[1] - next[0] * point[1];
  }
  return area / 2;
}

/** Outward bulging arcs along one edge, about `radius` each, as Bézier curves. */
function scallops(start: Point, end: Point, radius: number): PDFOperator[] {
  const length = distance(start, end);
  if (length === 0) return [];
  const k = 0.5523;
  const along: Point = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
  // Counterclockwise vertices put the outside on the right of each edge.
  const out: Point = [along[1], -along[0]];
  const count = Math.max(1, Math.round(length / (radius * 2)));
  const r = length / count / 2;
  const ops: PDFOperator[] = [];
  for (let part = 0; part < count; part++) {
    const p0 = between(start, end, part / count);
    const p1 = between(start, end, (part + 1) / count);
    const mid = between(p0, p1, 0.5);
    const top: Point = [mid[0] + out[0] * r, mid[1] + out[1] * r];
    ops.push(
      appendBezierCurve(
        p0[0] + out[0] * k * r,
        p0[1] + out[1] * k * r,
        top[0] - along[0] * k * r,
        top[1] - along[1] * k * r,
        top[0],
        top[1],
      ),
      appendBezierCurve(
        top[0] + along[0] * k * r,
        top[1] + along[1] * k * r,
        p1[0] + out[0] * k * r,
        p1[1] + out[1] * k * r,
        p1[0],
        p1[1],
      ),
    );
  }
  return ops;
}

/**
 * A cloudy outline around a closed polygon: each edge becomes a run of outward semicircular
 * scallops of roughly the given radius.
 */
export function cloudPath(vertices: Point[], radius: number): PDFOperator[] {
  if (vertices.length < 3) return [];
  const points = signedArea(vertices) < 0 ? [...vertices].reverse() : vertices;
  const ops: PDFOperator[] = [moveTo(...points[0])];
  for (const [index, start] of points.entries())
    ops.push(...scallops(start, points[(index + 1) % points.length], radius));
  ops.push(closePath());
  return ops;
}

function cloudy(dict: PDFDict) {
  const effect = dict.lookup(PDFName.of("BE"));
  if (!(effect instanceof PDFDict) || effect.get(PDFName.of("S")) !== PDFName.of("C")) return null;
  return cloudRadius(numberOf(effect, "I", 1));
}

/** An upward caret marking where text is inserted. */
function caret(rect: Rect, color: [number, number, number]) {
  const [x1, y1, x2, y2] = rect;
  return [
    setFillingRgbColor(...color),
    moveTo(x1, y1),
    lineTo((x1 + x2) / 2, y2),
    lineTo(x2, y1),
    lineTo((x1 + x2) / 2, y1 + (y2 - y1) * 0.35),
    closePath(),
    fill(),
  ];
}

/** A page with a folded corner and a clip, the usual attachment icon. */
function attachmentIcon(rect: Rect, color: [number, number, number]) {
  const [x1, y1] = rect;
  const size = Math.min(20, rect[2] - x1, rect[3] - y1);
  const w = size * 0.7;
  const fold = size * 0.25;
  const left = x1 + (size - w) / 2;
  return [
    setLineWidth(0.8),
    setStrokingRgbColor(0.2, 0.2, 0.2),
    setFillingRgbColor(...color),
    ...polyline(
      [
        [left, y1],
        [left + w, y1],
        [left + w, y1 + size - fold],
        [left + w - fold, y1 + size],
        [left, y1 + size],
      ],
      true,
    ),
    fillAndStroke(),
    setLineWidth(1.2),
    ...polyline([
      [left + w * 0.35, y1 + size * 0.85],
      [left + w * 0.35, y1 + size * 0.25],
      [left + w * 0.65, y1 + size * 0.25],
      [left + w * 0.65, y1 + size * 0.7],
    ]),
    stroke(),
  ];
}

/** A plain note icon in the annotation rectangle, as readers show for collapsed comments. */
function noteIcon(rect: Rect, color: [number, number, number]) {
  const [x1, y1] = rect;
  const size = Math.min(20, rect[2] - x1, rect[3] - y1);
  const top = y1 + size;
  const fold = size * 0.3;
  return [
    setLineWidth(0.8),
    setStrokingRgbColor(0.2, 0.2, 0.2),
    setFillingRgbColor(...color),
    ...polyline(
      [
        [x1, y1],
        [x1 + size, y1],
        [x1 + size, top - fold],
        [x1 + size - fold, top],
        [x1, top],
      ],
      true,
    ),
    fillAndStroke(),
    ...[0.35, 0.55, 0.75].flatMap((t) => [
      ...polyline([
        [x1 + size * 0.2, y1 + size * t],
        [x1 + size * 0.7, y1 + size * t],
      ]),
      stroke(),
    ]),
  ];
}

const SUPPORTED = new Set([
  "Highlight",
  "Underline",
  "StrikeOut",
  "Square",
  "Circle",
  "Line",
  "Ink",
  "Polygon",
  "PolyLine",
  "Text",
  "Caret",
  "FileAttachment",
]);

function drawing(dict: PDFDict, subtype: string, rect: Rect): PDFOperator[] | null {
  const fallback: [number, number, number] = subtype === "Text" ? [1, 0.85, 0.3] : [0, 0, 0];
  const color = annotationColor(dict, "C") ?? fallback;
  if (subtype === "Highlight" || subtype === "Underline" || subtype === "StrikeOut")
    return textMarkup(dict, subtype, color);
  if (subtype === "Square" || subtype === "Circle") return shape(dict, subtype, rect, color);
  if (subtype === "Text") return noteIcon(rect, color);
  if (subtype === "Caret") return caret(rect, color);
  if (subtype === "FileAttachment") return attachmentIcon(rect, color);
  const radius = subtype === "Polygon" ? cloudy(dict) : null;
  if (radius !== null) {
    const vertices = pairs(numbersOf(dict, "Vertices"));
    const path = cloudPath(vertices, radius);
    if (!path.length) return null;
    const interior = annotationColor(dict, "IC");
    return [
      setLineWidth(borderWidth(dict)),
      setLineJoin(1),
      setStrokingRgbColor(...color),
      ...(interior ? [setFillingRgbColor(...interior)] : []),
      ...path,
      interior ? fillAndStroke() : stroke(),
    ];
  }
  return lines(dict, subtype, color);
}

export const GENERATED_APPEARANCE = "NavPDFAppearance";

/**
 * Builds and registers a normal appearance for a supported annotation without one.
 * Returns null for unsupported subtypes or unusable geometry.
 */
export function generateAppearance(doc: PDFDocument, dict: PDFDict): PDFRef | null {
  const subtype = dict.get(PDFName.of("Subtype"));
  if (!(subtype instanceof PDFName) || !SUPPORTED.has(subtype.decodeText())) return null;
  const rect = annotationRect(dict);
  if (!rect || rect[2] - rect[0] <= 0 || rect[3] - rect[1] <= 0) return null;
  const operators = drawing(dict, subtype.decodeText(), rect);
  if (!operators) return null;
  const opacity = Math.min(1, Math.max(0, numberOf(dict, "CA", 1)));
  const highlight = subtype.decodeText() === "Highlight";
  const state =
    opacity < 1 || highlight
      ? doc.context.obj({
          Type: "ExtGState",
          CA: opacity,
          ca: opacity,
          ...(highlight ? { BM: "Multiply" } : {}),
        })
      : null;
  const stream = doc.context.formXObject(
    [
      pushGraphicsState(),
      ...(state ? [setGraphicsState("GS0")] : []),
      ...operators,
      popGraphicsState(),
    ],
    {
      BBox: rect,
      Matrix: [1, 0, 0, 1, 0, 0],
      ...(state ? { Resources: { ExtGState: { GS0: state } } } : {}),
      // Marks an appearance NavPDF drew, which an edit may redraw.
      [GENERATED_APPEARANCE]: true,
    },
  );
  return doc.context.register(stream);
}

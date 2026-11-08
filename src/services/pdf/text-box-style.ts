// A text box's border shape (rectangle, oval or circle around its text) and the separate opacity
// of its text, border and fill. NavPDF redraws the text box's appearance in Helvetica so every
// reader shows the shape.

import {
  appendBezierCurve,
  beginText,
  closePath,
  endText,
  fill,
  moveTo,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  StandardFonts,
  stroke,
  type PDFFont,
  type PDFOperator,
} from "pdf-lib";
import { findAnnotation, toPdfDate } from "../document-commands";
import {
  BORDER_SHAPE,
  FILL_OPACITY,
  GENERATED_APPEARANCE,
  STROKE_OPACITY,
} from "./annotation-appearance";

export type TextBoxShape = "rectangle" | "oval" | "circle";
/** NavPDF's key for a text box's text opacity. */
export const TEXT_OPACITY = "NavPDFTextOpacity";
/** Bezier control distance for a quarter ellipse. */
const KAPPA = 0.5522847498;
const MAX_TEXT = 10_000;

export interface TextBoxStyle {
  shape?: TextBoxShape;
  textOpacity?: number;
  borderOpacity?: number;
  fillOpacity?: number;
}

type Rect = [number, number, number, number];

function numbers(array: PDFArray | undefined) {
  return (
    array?.asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : Number.NaN)) ??
    []
  );
}

const NUMBER_TOKEN = /^[\d.]+$/;

function numericSuffix(token: string): string {
  let start = token.length;
  while (start > 0 && /[\d.]/.test(token[start - 1])) start--;
  return token.slice(start);
}

function appearanceOperands(
  tokens: string[],
  operator: RegExp,
  count: number,
): number[] | undefined {
  // The first operand can end a token with a nonnumeric prefix. Other operands must be whole tokens.
  for (let index = count; index < tokens.length; index++) {
    if (!operator.test(tokens[index])) continue;
    const first = numericSuffix(tokens[index - count]);
    const rest = tokens.slice(index - count + 1, index);
    if (first && rest.every((token) => NUMBER_TOKEN.test(token)))
      return [first, ...rest].map(Number);
  }
}

/** Font size and RGB text colour from a default appearance string such as "/Helv 12 Tf 0 0 1 rg". */
export function parseDefaultAppearance(da: string): {
  size: number;
  color: [number, number, number];
} {
  const tokens = da.split(/\s+/);
  const [size = Number.NaN] = appearanceOperands(tokens, /^Tf/, 1) ?? [];
  const rgb = appearanceOperands(tokens, /^rg/, 3);
  const [gray = 0] = rgb ? [] : (appearanceOperands(tokens, /^g(?![a-z])/, 1) ?? []);
  const [red, green, blue] = rgb ?? [gray, gray, gray];
  return {
    size: Number.isFinite(size) && size >= 2 && size <= 200 ? size : 12,
    color: [unit(red, 0), unit(green, 0), unit(blue, 0)],
  };
}

/**
 * The outer rectangle for a shape drawn around `inner`: the rectangle itself, an oval through its
 * corners (each half-axis √2 times the box's), or a circle through its corners.
 */
export function shapeBounds(inner: Rect, shape: TextBoxShape, width: number): Rect {
  const [x1, y1, x2, y2] = inner;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  let a = (x2 - x1) / 2;
  let b = (y2 - y1) / 2;
  if (shape === "oval") {
    a *= Math.SQRT2;
    b *= Math.SQRT2;
  } else if (shape === "circle") {
    a = b = Math.hypot(a, b);
  }
  const margin = shape === "rectangle" ? 0 : width / 2;
  return [cx - a - margin, cy - b - margin, cx + a + margin, cy + b + margin];
}

function ellipse(rect: Rect): PDFOperator[] {
  const [x1, y1, x2, y2] = rect;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const a = (x2 - x1) / 2;
  const b = (y2 - y1) / 2;
  const ox = a * KAPPA;
  const oy = b * KAPPA;
  return [
    moveTo(cx + a, cy),
    appendBezierCurve(cx + a, cy + oy, cx + ox, cy + b, cx, cy + b),
    appendBezierCurve(cx - ox, cy + b, cx - a, cy + oy, cx - a, cy),
    appendBezierCurve(cx - a, cy - oy, cx - ox, cy - b, cx, cy - b),
    appendBezierCurve(cx + ox, cy - b, cx + a, cy - oy, cx + a, cy),
    closePath(),
  ];
}

/** Break text into lines that fit `width` at `size`, keeping the author's line breaks. */
export function wrapLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function unit(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function textBoxInnerRect(annotation: PDFDict): Rect {
  const rect = numbers(annotation.lookupMaybe(PDFName.of("Rect"), PDFArray));
  if (rect.length !== 4 || !rect.every(Number.isFinite))
    throw new Error("The text box has no box.");
  const outer: Rect = [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3]),
  ];
  // The text area is the rectangle less /RD, the space a drawn shape takes around it.
  const rd = numbers(annotation.lookupMaybe(PDFName.of("RD"), PDFArray));
  const inner: Rect =
    rd.length === 4 && rd.every((value) => Number.isFinite(value) && value >= 0)
      ? [outer[0] + rd[0], outer[1] + rd[1], outer[2] - rd[2], outer[3] - rd[3]]
      : outer;
  if (inner[2] - inner[0] < 1 || inner[3] - inner[1] < 1)
    throw new Error("The text box is too small.");
  return inner;
}

function storedShape(annotation: PDFDict): TextBoxShape {
  const current = annotation.lookupMaybe(PDFName.of(BORDER_SHAPE), PDFName)?.decodeText();
  if (current === "Oval") return "oval";
  if (current === "Circle") return "circle";
  return "rectangle";
}

function textBoxOperators(
  inner: Rect,
  bounds: Rect,
  shape: TextBoxShape,
  width: number,
  fillColor: number[] | null,
  text: { color: [number, number, number]; size: number; lines: PDFHexString[] },
): PDFOperator[] {
  const { color, size, lines } = text;
  const shapePath =
    shape === "rectangle"
      ? [
          rectangle(
            inner[0] + width / 2,
            inner[1] + width / 2,
            inner[2] - inner[0] - width,
            inner[3] - inner[1] - width,
          ),
        ]
      : ellipse([
          bounds[0] + width / 2,
          bounds[1] + width / 2,
          bounds[2] - width / 2,
          bounds[3] - width / 2,
        ]);
  const operators: PDFOperator[] = [pushGraphicsState()];
  if (fillColor) {
    operators.push(
      setGraphicsState("GSFill"),
      setFillingRgbColor(fillColor[0], fillColor[1], fillColor[2]),
      ...shapePath,
      fill(),
    );
  }
  if (width > 0) {
    operators.push(
      setGraphicsState("GSBorder"),
      setLineWidth(width),
      setStrokingRgbColor(...color),
      ...shapePath,
      stroke(),
    );
  }
  operators.push(
    setGraphicsState("GSText"),
    setFillingRgbColor(...color),
    beginText(),
    setFontAndSize("Helv", size),
    ...lines.flatMap((line, index) => [
      setTextMatrix(1, 0, 0, 1, inner[0] + 2, inner[3] - 2 - size * (0.9 + index * 1.2)),
      showText(line),
    ]),
    endText(),
    popGraphicsState(),
  );
  return operators;
}

function storeTextBoxStyle(
  annotation: PDFDict,
  context: PDFDocument["context"],
  style: TextBoxStyle,
  shape: TextBoxShape,
  inner: Rect,
  bounds: Rect,
  textOpacity: number,
) {
  annotation.set(PDFName.of("Rect"), context.obj(bounds));
  if (shape === "rectangle") {
    annotation.delete(PDFName.of("RD"));
    annotation.delete(PDFName.of(BORDER_SHAPE));
  } else {
    annotation.set(
      PDFName.of("RD"),
      context.obj([
        inner[0] - bounds[0],
        inner[1] - bounds[1],
        bounds[2] - inner[2],
        bounds[3] - inner[3],
      ]),
    );
    annotation.set(PDFName.of(BORDER_SHAPE), PDFName.of(shape === "oval" ? "Oval" : "Circle"));
  }
  for (const [key, value] of [
    [TEXT_OPACITY, style.textOpacity],
    [STROKE_OPACITY, style.borderOpacity],
    [FILL_OPACITY, style.fillOpacity],
  ] as const)
    if (value !== undefined) annotation.set(PDFName.of(key), PDFNumber.of(unit(value, 1)));
  // Readers that redraw the box themselves use /CA for all of it; the text's value is closest.
  if (style.textOpacity !== undefined) annotation.set(PDFName.of("CA"), PDFNumber.of(textOpacity));
}

/**
 * Restyle a text box: its border shape and the separate opacity of its text, border and fill.
 * The text keeps its place; an oval or circle grows the rectangle around it. Callouts are refused.
 */
export async function styleTextBox(
  bytes: Uint8Array,
  id: string,
  style: TextBoxStyle,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const found = findAnnotation(doc, id);
  if (!found) throw new Error("The selected text box no longer exists.");
  const { annotation } = found;
  if (annotation.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() !== "FreeText")
    throw new Error("Only text boxes have a border shape.");
  if (annotation.has(PDFName.of("CL"))) throw new Error("Callouts keep their rectangular box.");
  const inner = textBoxInnerRect(annotation);
  const currentShape = storedShape(annotation);
  const shape = style.shape ?? currentShape;
  const text =
    annotation.lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)?.decodeText() ?? "";
  if (text.length > MAX_TEXT) throw new Error("The text box's text is too long to redraw.");
  const da = annotation.lookupMaybe(PDFName.of("DA"), PDFString, PDFHexString)?.decodeText() ?? "";
  const { size, color } = parseDefaultAppearance(da);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let lines: PDFHexString[];
  try {
    lines = wrapLines(text, font, size, Math.max(1, inner[2] - inner[0] - 4)).map((line) =>
      font.encodeText(line),
    );
  } catch {
    throw new Error(
      "The text uses characters Helvetica cannot show, so its border cannot be redrawn.",
    );
  }
  const bs = annotation.lookupMaybe(PDFName.of("BS"), PDFDict);
  const width = Math.min(
    12,
    Math.max(0, bs?.lookupMaybe(PDFName.of("W"), PDFNumber)?.asNumber() ?? 1),
  );
  const background = numbers(annotation.lookupMaybe(PDFName.of("C"), PDFArray));
  const fillColor =
    background.length === 3 && background.every(Number.isFinite) ? background : null;
  const opacity = unit(annotation.lookupMaybe(PDFName.of("CA"), PDFNumber)?.asNumber(), 1);
  const stored = (key: string) => annotation.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber();
  const textOpacity = unit(style.textOpacity ?? stored(TEXT_OPACITY), opacity);
  const borderOpacity = unit(style.borderOpacity ?? stored(STROKE_OPACITY), opacity);
  const fillOpacity = unit(style.fillOpacity ?? stored(FILL_OPACITY), opacity);

  const bounds = shapeBounds(inner, shape, width);
  const context = doc.context;
  const operators = textBoxOperators(inner, bounds, shape, width, fillColor, {
    color,
    size,
    lines,
  });
  const state = (alpha: number) => context.obj({ Type: "ExtGState", CA: alpha, ca: alpha });
  const appearance = context.register(
    context.formXObject(operators, {
      BBox: bounds,
      Matrix: [1, 0, 0, 1, 0, 0],
      Resources: {
        Font: { Helv: font.ref },
        ExtGState: {
          GSFill: state(fillOpacity),
          GSBorder: state(borderOpacity),
          GSText: state(textOpacity),
        },
      },
      [GENERATED_APPEARANCE]: true,
    }),
  );
  storeTextBoxStyle(annotation, context, style, shape, inner, bounds, textOpacity);
  annotation.set(PDFName.of("AP"), context.obj({ N: appearance }));
  annotation.set(PDFName.of("M"), PDFString.of(toPdfDate()));
  return doc.save();
}

// Review annotations beyond rectangles, ovals and lines: polygons, connected lines, clouds,
// callouts, insert and replace proposals, and file attachments. Each is a standard annotation
// with its own appearance stream, so other readers show the same marks.

import {
  PDFDict,
  PDFDocument,
  PDFName,
  beginText,
  endText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  stroke,
  setTextMatrix,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";
import { MAX_ATTACHMENT_SIZE_BYTES, toPdfDate, type TextMarkupQuad } from "../document-commands.ts";
import { cloudRadius, generateAppearance } from "./annotation-appearance.ts";
import {
  APPEARANCE_FONT_NAMES,
  annotationAuthor,
  embedAppearanceFonts,
  encodeStandardText,
  normalAppearance,
} from "./appearance.ts";
import { visibleBox } from "./page-box.ts";
import { pdfText } from "./text-string.ts";

type Point = [number, number];
type Color = [number, number, number];

interface CommonInput {
  page: number;
  color?: Color;
  width?: number;
  opacity?: number;
  author?: string;
}

const MAX_VERTICES = 500;
const MAX_TEXT = 10_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function targetPage(doc: PDFDocument, page: number) {
  if (!Number.isInteger(page) || page < 1 || page > doc.getPageCount())
    throw new Error("The comment page is outside the document.");
  return doc.getPage(page - 1);
}

/** Points kept inside the visible page; invalid points are rejected. */
function onPage(page: PDFPage, points: Point[]): Point[] {
  const box = visibleBox(page);
  if (!points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))
    throw new Error("The comment geometry is invalid.");
  return points.map(([x, y]) => [
    clamp(x, box.x, box.x + box.width),
    clamp(y, box.y, box.y + box.height),
  ]);
}

function bounds(points: Point[], margin: number): [number, number, number, number] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [
    Math.min(...xs) - margin,
    Math.min(...ys) - margin,
    Math.max(...xs) + margin,
    Math.max(...ys) + margin,
  ];
}

function baseEntries(page: PDFPage, input: CommonInput, subtype: string) {
  const date = pdfText(toPdfDate());
  return {
    Type: "Annot",
    Subtype: subtype,
    C: (input.color ?? [0.8, 0.1, 0.1]).map((value) => clamp(value, 0, 1)),
    CA: clamp(input.opacity ?? 1, 0, 1),
    F: 4,
    P: page.ref,
    M: date,
    CreationDate: date,
    NM: pdfText(`navpdf-annotation-${crypto.randomUUID()}`),
    T: pdfText(annotationAuthor(input.author)),
  };
}

/** Registers the annotation, gives it a generated appearance and adds it to the page. */
function place(doc: PDFDocument, page: PDFPage, entries: Record<string, unknown>): PDFRef {
  const annotation = doc.context.obj(entries as never) as unknown as PDFDict;
  const appearance = generateAppearance(doc, annotation);
  if (appearance) annotation.set(PDFName.of("AP"), normalAppearance(doc, appearance));
  const ref = doc.context.register(annotation);
  page.node.addAnnot(ref);
  return ref;
}

export interface PolyShapeInput extends CommonInput {
  kind: "Polygon" | "PolyLine";
  vertices: Point[];
}

export async function addPolyShape(bytes: Uint8Array, input: PolyShapeInput) {
  const doc = await PDFDocument.load(bytes);
  const page = targetPage(doc, input.page);
  const minimum = input.kind === "Polygon" ? 3 : 2;
  if (input.vertices.length < minimum)
    throw new Error(`Mark at least ${minimum} points for this shape.`);
  if (input.vertices.length > MAX_VERTICES) throw new Error("The shape has too many points.");
  const vertices = onPage(page, input.vertices);
  const width = clamp(input.width ?? 2, 0.5, 20);
  place(doc, page, {
    ...baseEntries(page, input, input.kind),
    Rect: bounds(vertices, width + 2),
    Vertices: vertices.flat(),
    BS: { W: width, S: "S" },
    Contents: pdfText(""),
  });
  return doc.save();
}

export interface CloudInput extends CommonInput {
  start: Point;
  end: Point;
}

/** A cloud drawn by dragging a rectangle: a four-sided polygon with a cloudy border. */
export async function addCloud(bytes: Uint8Array, input: CloudInput) {
  const doc = await PDFDocument.load(bytes);
  const page = targetPage(doc, input.page);
  const [start, end] = onPage(page, [input.start, input.end]);
  if (Math.abs(end[0] - start[0]) < 4 || Math.abs(end[1] - start[1]) < 4)
    throw new Error("Drag a larger area for the cloud.");
  const width = clamp(input.width ?? 1.5, 0.5, 20);
  const vertices: Point[] = [
    [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
    [Math.max(start[0], end[0]), Math.min(start[1], end[1])],
    [Math.max(start[0], end[0]), Math.max(start[1], end[1])],
    [Math.min(start[0], end[0]), Math.max(start[1], end[1])],
  ];
  place(doc, page, {
    ...baseEntries(page, input, "Polygon"),
    Rect: bounds(vertices, cloudRadius(1) + width + 2),
    Vertices: vertices.flat(),
    BS: { W: width, S: "S" },
    BE: { S: "C", I: 1 },
    IT: PDFName.of("PolygonCloud"),
    Contents: pdfText(""),
  });
  return doc.save();
}

export interface CalloutInput extends CommonInput {
  /** Where the leader line points. */
  tip: Point;
  /** Lower-left corner of the text box. */
  box: Point;
  text: string;
  boxWidth?: number;
}

/** Splits text into lines that fit `width` at `size`, honouring explicit line breaks. */
function wrapText(measure: (text: string) => number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A text box with a leader line ending in an arrow at the point being discussed. */
export async function addCallout(bytes: Uint8Array, input: CalloutInput) {
  const text = input.text.trim();
  if (!text) throw new Error("Type the callout text first.");
  if (text.length > MAX_TEXT) throw new Error("The callout text is too long.");
  const doc = await PDFDocument.load(bytes);
  const page = targetPage(doc, input.page);
  const fonts = await embedAppearanceFonts(doc);
  const size = 10;
  const padding = 4;
  const visible = visibleBox(page);
  const boxWidth = clamp(input.boxWidth ?? 160, 40, visible.width);
  const lines = wrapText(
    (value) => fonts.regular.widthOfTextAtSize(value, size),
    text,
    boxWidth - padding * 2,
  );
  const encoded = lines.map((line) => encodeStandardText(fonts.regular, line));
  const boxHeight = lines.length * size * 1.2 + padding * 2;
  const [tip, corner] = onPage(page, [input.tip, input.box]);
  const box: [number, number, number, number] = [
    clamp(corner[0], visible.x, visible.x + visible.width - boxWidth),
    clamp(corner[1], visible.y, visible.y + visible.height - boxHeight),
    0,
    0,
  ];
  box[2] = box[0] + boxWidth;
  box[3] = box[1] + boxHeight;
  // The leader leaves from the middle of the box side facing the tip, with a short knee.
  const leftSide = tip[0] < (box[0] + box[2]) / 2;
  const end: Point = [leftSide ? box[0] : box[2], (box[1] + box[3]) / 2];
  const knee: Point = [end[0] + (leftSide ? -12 : 12), end[1]];
  const color = (input.color ?? [0.8, 0.1, 0.1]).map((value) => clamp(value, 0, 1)) as Color;
  const rect = bounds([tip, knee, end, [box[0], box[1]], [box[2], box[3]]], 8);
  const angle = Math.atan2(tip[1] - knee[1], tip[0] - knee[0]);
  const wing = (offset: number): Point => [
    tip[0] - 8 * Math.cos(angle + offset),
    tip[1] - 8 * Math.sin(angle + offset),
  ];
  const operators: PDFOperator[] = [
    pushGraphicsState(),
    setLineWidth(1),
    setStrokingRgbColor(...color),
    setFillingRgbColor(1, 1, 1),
    rectangle(box[0], box[1], boxWidth, boxHeight),
    fill(),
    rectangle(box[0], box[1], boxWidth, boxHeight),
    stroke(),
    moveTo(...tip),
    lineTo(...knee),
    lineTo(...end),
    stroke(),
    moveTo(...wing(Math.PI / 6)),
    lineTo(...tip),
    lineTo(...wing(-Math.PI / 6)),
    stroke(),
    setFillingRgbColor(0, 0, 0),
    beginText(),
    setFontAndSize(APPEARANCE_FONT_NAMES.regular, size),
    ...encoded.flatMap((line, index) => [
      setTextMatrix(1, 0, 0, 1, box[0] + padding, box[3] - padding - size * (index + 1) * 1.2 + 2),
      showText(line),
    ]),
    endText(),
    popGraphicsState(),
  ];
  const appearance = doc.context.register(
    doc.context.formXObject(operators, {
      BBox: rect,
      Matrix: [1, 0, 0, 1, 0, 0],
      Resources: { Font: { [APPEARANCE_FONT_NAMES.regular]: fonts.regular.ref } },
    }),
  );
  const annotation = doc.context.obj({
    ...baseEntries(page, input, "FreeText"),
    IT: PDFName.of("FreeTextCallout"),
    Rect: rect,
    CL: [...tip, ...knee, ...end],
    LE: PDFName.of("OpenArrow"),
    RD: [box[0] - rect[0], box[1] - rect[1], rect[2] - box[2], rect[3] - box[3]],
    DA: pdfText(`/${APPEARANCE_FONT_NAMES.regular} ${size} Tf 0 g`),
    Contents: pdfText(text),
    BS: { W: 1, S: "S" },
    AP: normalAppearance(doc, appearance),
  } as never);
  page.node.addAnnot(doc.context.register(annotation));
  return doc.save();
}

export interface TextEditInput extends CommonInput {
  kind: "insert" | "replace";
  quads: TextMarkupQuad[];
  /** The proposed new text. */
  text: string;
  /** The selected text, kept on a replacement's strikeout. */
  selected?: string;
}

/**
 * An insertion caret after the selection, or for a replacement a strikeout over the selection
 * grouped with a caret carrying the new text, as review tools exchange text edits.
 */
export async function addTextEditProposal(bytes: Uint8Array, input: TextEditInput) {
  const text = input.text;
  if (input.kind === "insert" && !text.trim()) throw new Error("Type the text to insert.");
  if (text.length > MAX_TEXT) throw new Error("The proposed text is too long.");
  const doc = await PDFDocument.load(bytes);
  const page = targetPage(doc, input.page);
  const quads = input.quads.filter(
    (quad) =>
      [quad.x1, quad.y1, quad.x2, quad.y2].every(Number.isFinite) &&
      quad.x2 > quad.x1 &&
      quad.y2 > quad.y1,
  );
  if (!quads.length) throw new Error("Select text on the page first.");
  const last = quads.at(-1)!;
  const height = last.y2 - last.y1;
  const caretWidth = Math.max(6, height * 0.6);
  const [tipLeft, tipRight] = onPage(page, [
    [last.x2 - caretWidth / 2, last.y1 - height * 0.25],
    [last.x2 + caretWidth / 2, last.y1 + height * 0.45],
  ]);
  const caretRef = place(doc, page, {
    ...baseEntries(page, input, "Caret"),
    Rect: [tipLeft[0], tipLeft[1], tipRight[0], tipRight[1]],
    RD: [0, 0, 0, 0],
    Sy: PDFName.of("None"),
    Subj: pdfText(input.kind === "insert" ? "Inserted Text" : "Replace Text"),
    Contents: pdfText(text),
  });
  if (input.kind === "replace") {
    place(doc, page, {
      ...baseEntries(page, input, "StrikeOut"),
      Rect: [
        Math.min(...quads.map((quad) => quad.x1)),
        Math.min(...quads.map((quad) => quad.y1)),
        Math.max(...quads.map((quad) => quad.x2)),
        Math.max(...quads.map((quad) => quad.y2)),
      ],
      QuadPoints: quads.flatMap((quad) => [
        quad.x1,
        quad.y2,
        quad.x2,
        quad.y2,
        quad.x1,
        quad.y1,
        quad.x2,
        quad.y1,
      ]),
      IRT: caretRef,
      RT: PDFName.of("Group"),
      Subj: pdfText("Cross-Out"),
      Contents: pdfText(input.selected ?? ""),
    });
  }
  return doc.save();
}

export interface FileCommentInput extends CommonInput {
  /** Lower-left corner of the icon in PDF user space. */
  at: Point;
  fileName: string;
  data: Uint8Array;
  mimeType?: string;
  description?: string;
}

/** `value`, or `fallback` when it is missing or empty. */
function nonEmpty(value: string | undefined, fallback: string) {
  if (value) return value;
  return fallback;
}

/** Embeds a file in a paperclip comment. The file is stored only; it is never opened here. */
export async function addFileAttachmentComment(bytes: Uint8Array, input: FileCommentInput) {
  if (input.data.length > MAX_ATTACHMENT_SIZE_BYTES)
    throw new Error("Attachment exceeds maximum allowed size of 50 MB.");
  const name = nonEmpty(input.fileName.split(/[\\/]/).pop()?.trim(), "attachment");
  const doc = await PDFDocument.load(bytes);
  const page = targetPage(doc, input.page);
  const [corner] = onPage(page, [input.at]);
  const box = visibleBox(page);
  const x = clamp(corner[0], box.x, box.x + box.width - 20);
  const y = clamp(corner[1], box.y, box.y + box.height - 20);
  const modified = pdfText(toPdfDate());
  const file = doc.context.flateStream(input.data, {
    Type: "EmbeddedFile",
    ...(input.mimeType && /^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType)
      ? { Subtype: PDFName.of(input.mimeType) }
      : {}),
    Params: { Size: input.data.length, ModDate: modified },
  });
  const spec = doc.context.obj({
    Type: "Filespec",
    F: pdfText(name),
    UF: pdfText(name),
    EF: { F: doc.context.register(file) },
    ...(input.description ? { Desc: pdfText(input.description) } : {}),
  });
  place(doc, page, {
    ...baseEntries(page, { ...input, color: input.color ?? [0.95, 0.8, 0.3] }, "FileAttachment"),
    Rect: [x, y, x + 20, y + 20],
    FS: doc.context.register(spec),
    Name: PDFName.of("Paperclip"),
    Contents: pdfText(nonEmpty(input.description, name)),
  });
  return doc.save();
}

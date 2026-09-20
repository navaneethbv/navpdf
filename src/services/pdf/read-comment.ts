import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from "pdf-lib";
import type { Comment } from "../../types/document";
import { annotationIdentifier } from "../document-commands";

interface AnnotationData {
  id: string;
  annotationName?: string;
  subtype?: string;
  contentsObj?: { str: string };
  rect?: number[];
  lineCoordinates?: number[];
  lineEndings?: string[];
  name?: string;
  inReplyTo?: string;
  state?: NonNullable<Comment["reviewState"]>;
  quadPoints?: number[];
  color?: ArrayLike<number>;
  opacity?: number;
  borderStyle?: { width?: number };
}

const supported = new Set([
  "Text",
  "Highlight",
  "Underline",
  "StrikeOut",
  "Square",
  "Circle",
  "Line",
  "Stamp",
]);

function rectangle(values?: number[]): [number, number, number, number] | undefined {
  if (values?.length === 4 && values.every(Number.isFinite))
    return [values[0], values[1], values[2], values[3]];
}

function quadBounds(values: number[] = []): number[][] | undefined {
  const bounds: number[][] = [];
  for (let k = 0; k + 7 < values.length; k += 8) {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = values.slice(k, k + 8);
    const xs = [x1, x2, x3, x4];
    const ys = [y1, y2, y3, y4];
    bounds.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return bounds.length ? bounds : undefined;
}

function numberArray(dict: PDFDict, key: string): number[] | undefined {
  const value = dict.lookupMaybe(PDFName.of(key), PDFArray);
  return value?.asArray().map((item) => (item as PDFNumber).asNumber());
}

function storedGeometry(annotations: PDFArray | undefined, id: string) {
  if (!annotations) return {};
  for (let i = 0; i < annotations.size(); i++) {
    const dict = annotations.lookup(i, PDFDict);
    const name = dict.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText();
    if (name !== id && annotationIdentifier(annotations.get(i)) !== id && id !== `annot_${i}`)
      continue;
    const rawEndings = dict.lookupMaybe(PDFName.of("LE"), PDFArray);
    const endings: [string, string] | undefined =
      rawEndings?.size() === 2
        ? [
            rawEndings.lookupMaybe(0, PDFName)?.decodeText() ?? "None",
            rawEndings.lookupMaybe(1, PDFName)?.decodeText() ?? "None",
          ]
        : undefined;
    return {
      line: rectangle(numberArray(dict, "L")),
      quads: quadBounds(numberArray(dict, "QuadPoints")),
      endings,
    };
  }
  return {};
}

function applyAppearance(comment: Comment, data: AnnotationData) {
  if (data.color?.length === 3)
    comment.color = [data.color[0] / 255, data.color[1] / 255, data.color[2] / 255];
  if (data.opacity !== undefined && Number.isFinite(data.opacity)) comment.opacity = data.opacity;
  const width = data.borderStyle?.width;
  if (width !== undefined && Number.isFinite(width)) comment.width = width;
  if (data.subtype === "Stamp") comment.stampName = data.name;
  if (data.inReplyTo) comment.replyTo = data.inReplyTo;
  if (data.state && ["Accepted", "Rejected", "Cancelled", "Completed"].includes(data.state))
    comment.reviewState = data.state;
}

/** Merge PDF.js display data with saved geometry using decoded annotation identifiers. */
export function readComment(raw: unknown, page: number, annotations?: PDFArray): Comment | null {
  const data = raw as AnnotationData;
  if (!data.subtype || !supported.has(data.subtype)) return null;
  const id = data.annotationName || data.id;
  const stored = storedGeometry(annotations, id);
  const fallbackEndings: [string, string] | undefined =
    data.lineEndings?.length === 2 ? [data.lineEndings[0], data.lineEndings[1]] : undefined;
  const lineEndings = stored.endings ?? fallbackEndings;
  const arrow = lineEndings?.some((value) => value.toLowerCase().includes("arrow"));
  const type = arrow ? "Arrow" : data.subtype;
  const comment: Comment = {
    id,
    page,
    type,
    text: data.contentsObj?.str || `${type} annotation`,
    rect: rectangle(data.rect),
    line: stored.line ?? rectangle(data.lineCoordinates),
    lineEndings,
    quads: stored.quads ?? quadBounds(data.quadPoints),
  };
  applyAppearance(comment, data);
  return comment;
}

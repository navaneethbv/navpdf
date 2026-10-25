// Watermarks and backgrounds drawn from an image or a page of another PDF. The picture is
// embedded once, then drawn on each page, upright as the page is displayed, centred on its
// visible area, in front of or behind the page's content.

import {
  PDFArray,
  PDFDocument,
  type PDFEmbeddedPage,
  PDFImage,
  type PDFOperator,
  type PDFPage,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  setGraphicsState,
} from "pdf-lib";
import { appendTaggedStream } from "./content-streams.ts";
import { visibleBox } from "./page-box.ts";

export interface DecorationImage {
  /** PNG or JPEG image bytes, or a PDF whose page `pageNumber` is used. */
  bytes: Uint8Array;
  type: "png" | "jpg" | "pdf";
  /** 1-based page of a PDF source. */
  pageNumber?: number;
  /** Width as a fraction of the displayed page width, from 0.05 to 1. */
  scale: number;
  opacity: number;
  /** Counterclockwise degrees, as the page is displayed. */
  rotation: number;
  /** Draw before the page's own content instead of over it. */
  behind: boolean;
}

export const DECORATION_TAG = "NavPDF_Decoration";
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The image type of a file from its signature, or null when it is not PNG, JPEG or PDF. */
export function decorationSourceType(bytes: Uint8Array): DecorationImage["type"] | null {
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpg";
  if (starts([0x25, 0x50, 0x44, 0x46])) return "pdf";
  return null;
}

/** Embeds the picture once for every page that draws it. */
export async function embedDecorationImage(
  doc: PDFDocument,
  image: DecorationImage,
): Promise<PDFImage | PDFEmbeddedPage> {
  if (image.bytes.length > MAX_SOURCE_BYTES)
    throw new Error("Watermark and background files are limited to 50 MB.");
  if (image.type === "png") return doc.embedPng(image.bytes);
  if (image.type === "jpg") return doc.embedJpg(image.bytes);
  const source = await PDFDocument.load(image.bytes).catch(() => {
    throw new Error("The PDF for the watermark could not be read; it may be password protected.");
  });
  const index = (image.pageNumber ?? 1) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= source.getPageCount())
    throw new Error(`The PDF for the watermark has ${source.getPageCount()} page(s).`);
  const [page] = await doc.embedPdf(source, [index]);
  return page;
}

/** Puts a tagged content stream first, so it draws behind the page's content. */
function prependTaggedStream(doc: PDFDocument, page: PDFPage, operators: PDFOperator[]) {
  const ref = appendTaggedStream(doc, page, DECORATION_TAG, operators);
  const contents = page.node.Contents();
  if (contents instanceof PDFArray && contents.size() > 1) {
    contents.remove(contents.size() - 1);
    contents.insert(0, ref);
  }
}

/** The matrix placing a picture of `width` by `height` units at its spot on a page. */
export function decorationMatrix(
  page: { x: number; y: number; width: number; height: number; rotation: number },
  picture: { width: number; height: number },
  image: Pick<DecorationImage, "scale" | "rotation">,
): [number, number, number, number, number, number] {
  const quarterTurn = page.rotation === 90 || page.rotation === 270;
  const visualWidth = quarterTurn ? page.height : page.width;
  const width = visualWidth * clamp(image.scale, 0.05, 1);
  const factor = width / picture.width;
  // The page's own /Rotate turns it clockwise on screen; turning the picture back keeps it upright.
  const angle = ((image.rotation + page.rotation) * Math.PI) / 180;
  const cos = Math.cos(angle) * factor;
  const sin = Math.sin(angle) * factor;
  const centreX = page.x + page.width / 2;
  const centreY = page.y + page.height / 2;
  // Rotate and scale about the picture's centre, then move that centre to the page's centre.
  const halfWidth = picture.width / 2;
  const halfHeight = picture.height / 2;
  return [
    cos,
    sin,
    -sin,
    cos,
    centreX - (cos * halfWidth - sin * halfHeight),
    centreY - (sin * halfWidth + cos * halfHeight),
  ];
}

/** Draws an embedded watermark or background picture on one page. */
export function drawDecorationImage(
  doc: PDFDocument,
  page: PDFPage,
  embedded: PDFImage | PDFEmbeddedPage,
  image: DecorationImage,
  key: string,
) {
  const box = visibleBox(page);
  // An image XObject fills the unit square; a page XObject keeps its own size in points.
  const isImage = embedded instanceof PDFImage;
  const picture = { width: embedded.width, height: embedded.height };
  const unit = isImage ? { width: 1, height: 1 } : picture;
  const [a, b, c, d, e, f] = decorationMatrix(box, picture, image);
  const sx = picture.width / unit.width;
  const sy = picture.height / unit.height;
  const name = page.node.newXObject(key, embedded.ref);
  const opacity = clamp(image.opacity, 0.05, 1);
  const state = page.node.newExtGState(
    `${key}GS`,
    doc.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity }),
  );
  const operators = [
    pushGraphicsState(),
    setGraphicsState(state),
    concatTransformationMatrix(a, b, c, d, e, f),
    concatTransformationMatrix(sx, 0, 0, sy, 0, 0),
    drawObject(name),
    popGraphicsState(),
  ];
  if (image.behind) prependTaggedStream(doc, page, operators);
  else appendTaggedStream(doc, page, DECORATION_TAG, operators);
}

// Page rendering for OCR, shared by the single-document panel and multi-file OCR. Optional
// preprocessing changes only the image sent for recognition; the PDF page is never altered.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OcrPageResult } from "../../types/operations";
import {
  detectTurn,
  estimateSkew,
  grayOf,
  inverseMap,
  mapOcrResult,
  turnGray,
  type PointMap,
  type QuarterTurn,
} from "./page-geometry";

export interface OcrPreprocessing {
  grayscale: boolean;
  contrast: boolean;
  threshold: boolean;
  despeckle: boolean;
  /** Turn a page scanned sideways or upside down so its text is upright. */
  rotation?: boolean;
  /** Straighten a page scanned up to 5 degrees askew. */
  deskew?: boolean;
}

export const NO_PREPROCESSING: OcrPreprocessing = {
  grayscale: false,
  contrast: false,
  threshold: false,
  despeckle: false,
  rotation: false,
  deskew: false,
};

export const PREPROCESSING_LABELS: Record<keyof OcrPreprocessing, string> = {
  grayscale: "Convert to grayscale",
  contrast: "Stretch contrast",
  threshold: "Black and white (removes light backgrounds)",
  despeckle: "Remove specks (with black and white)",
  rotation: "Detect pages scanned sideways or upside down",
  deskew: "Straighten pages scanned askew (up to 5 degrees)",
};

export function pageWithinOcrLimit(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    Number.isFinite(width * height) &&
    width <= 8192 &&
    height <= 8192 &&
    width * height <= 16_000_000
  );
}

const luminance = (pixels: Uint8ClampedArray, index: number) =>
  0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];

/** Otsu's threshold over a 256-bin luminance histogram. */
export function otsuThreshold(histogram: number[], total: number) {
  let sum = 0;
  for (let level = 0; level < 256; level++) sum += level * histogram[level];
  let background = 0;
  let backgroundSum = 0;
  let best = 0;
  let threshold = 127;
  for (let level = 0; level < 256; level++) {
    background += histogram[level];
    if (!background) continue;
    const foreground = total - background;
    if (!foreground) break;
    backgroundSum += level * histogram[level];
    const meanBack = backgroundSum / background;
    const meanFore = (sum - backgroundSum) / foreground;
    const between = background * foreground * (meanBack - meanFore) ** 2;
    if (between > best) {
      best = between;
      threshold = level;
    }
  }
  return threshold;
}

const histogramOf = (values: Uint8ClampedArray) => {
  const histogram = Array.from({ length: 256 }, () => 0);
  for (const value of values) histogram[value]++;
  return histogram;
};

/** Stretches values between the 1st and 99th percentiles, so stray pixels do not set the range. */
function stretchContrast(gray: Uint8ClampedArray) {
  const histogram = histogramOf(gray);
  const cut = gray.length * 0.01;
  let low = 0;
  let high = 255;
  const count = (level: number) => histogram.at(level) ?? 0;
  for (let seen = count(low); low < 255 && seen <= cut; seen += count(low)) low++;
  for (let seen = count(high); high > 0 && seen <= cut; seen += count(high)) high--;
  if (high <= low) return;
  for (let pixel = 0; pixel < gray.length; pixel++)
    gray[pixel] = ((gray[pixel] - low) * 255) / (high - low);
}

function binarize(gray: Uint8ClampedArray) {
  const level = otsuThreshold(histogramOf(gray), gray.length);
  for (let pixel = 0; pixel < gray.length; pixel++) gray[pixel] = gray[pixel] > level ? 255 : 0;
}

/** Applies the chosen preprocessing to RGBA pixels in place. */
export function preprocessPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: OcrPreprocessing,
) {
  if (!options.grayscale && !options.contrast && !options.threshold) return pixels;
  const gray = new Uint8ClampedArray(width * height);
  for (let pixel = 0; pixel < gray.length; pixel++) gray[pixel] = luminance(pixels, pixel * 4);
  if (options.contrast) stretchContrast(gray);
  if (options.threshold) {
    binarize(gray);
    if (options.despeckle) despeckle(gray, width, height);
  }
  for (let pixel = 0; pixel < gray.length; pixel++)
    pixels.fill(gray.at(pixel) ?? 0, pixel * 4, pixel * 4 + 3);
  return pixels;
}

/** Whether the black pixel at (x, y) has a black 8-neighbour. */
function hasBlackNeighbour(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++)
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++)
      if ((nx !== x || ny !== y) && source[ny * width + nx] === 0) return true;
  return false;
}

/** Whitens black pixels with no black 8-neighbour, the isolated noise left after scanning. */
export function despeckle(binary: Uint8ClampedArray, width: number, height: number) {
  const source = Uint8ClampedArray.from(binary);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (source[y * width + x] === 0 && !hasBlackNeighbour(source, width, height, x, y))
        binary[y * width + x] = 255;
}

/** An image prepared for recognition and how to map its word boxes back onto the page. */
export interface PreparedPage {
  bytes: Uint8Array;
  /** Size of the image sent for recognition. */
  prepared: { width: number; height: number };
  /** Size of the page as rendered, which word boxes are mapped back to. */
  rendered: { width: number; height: number };
  /** Null when the image was not turned or straightened. */
  map: PointMap | null;
  turn: QuarterTurn;
  skew: number;
}

function encodePng(canvas: HTMLCanvasElement) {
  const encoded = canvas.toDataURL("image/png").split(",")[1];
  if (!encoded) throw new Error("Unable to encode the OCR page.");
  return Uint8Array.from(atob(encoded), (char) => char.codePointAt(0) ?? 0);
}

/** Draws `source` turned clockwise by a quarter turn and then rotated by -`skew` degrees. */
function transformCanvas(source: HTMLCanvasElement, turn: QuarterTurn, skew: number) {
  const swap = turn === 90 || turn === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the OCR page.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  // Straightening turns the page by the skew about its centre, after the quarter turn.
  context.translate(cx, cy);
  context.rotate((skew * Math.PI) / 180);
  context.translate(-cx, -cy);
  if (turn === 90) context.translate(source.height, 0);
  else if (turn === 180) context.translate(source.width, source.height);
  else if (turn === 270) context.translate(0, source.width);
  context.rotate((turn * Math.PI) / 180);
  context.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Renders a page at twice its size for recognition: optionally turned upright and straightened,
 * then with the chosen pixel cleanup. Recognised boxes map back with `map`.
 */
export async function preparePageImage(
  sourcePdf: Pick<PDFDocumentProxy, "getPage">,
  pageNumber: number,
  ensureCurrent: () => void,
  preprocessing: OcrPreprocessing = NO_PREPROCESSING,
): Promise<PreparedPage> {
  const page = await sourcePdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2, rotation: 0 });
  if (!pageWithinOcrLimit(viewport.width, viewport.height)) {
    throw new Error("This page exceeds the OCR image size limit.");
  }
  let canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const rendered = { width: canvas.width, height: canvas.height };
  const canvases = [canvas];
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to render the OCR page.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    ensureCurrent();
    let turn: QuarterTurn = 0;
    let skew = 0;
    if (preprocessing.rotation || preprocessing.deskew) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let gray = grayOf(pixels, canvas.width, canvas.height);
      if (preprocessing.rotation) {
        turn = detectTurn(gray);
        gray = turnGray(gray, turn);
      }
      if (preprocessing.deskew) skew = estimateSkew(gray);
      if (turn || skew) {
        canvas = transformCanvas(canvas, turn, skew);
        canvases.push(canvas);
      }
    }
    const cleanup = { ...preprocessing, rotation: false, deskew: false };
    if (Object.values(cleanup).some(Boolean)) {
      const target = canvas.getContext("2d");
      if (!target) throw new Error("Unable to prepare the OCR page.");
      const image = target.getImageData(0, 0, canvas.width, canvas.height);
      preprocessPixels(image.data, canvas.width, canvas.height, cleanup);
      target.putImageData(image, 0, 0);
    }
    return {
      bytes: encodePng(canvas),
      prepared: { width: canvas.width, height: canvas.height },
      rendered,
      map: turn || skew ? inverseMap(rendered.width, rendered.height, turn, skew) : null,
      turn,
      skew,
    };
  } finally {
    for (const item of canvases) {
      item.width = 0;
      item.height = 0;
    }
  }
}

/** Renders a page at twice its size as PNG for recognition, with optional preprocessing. */
export async function pageImage(
  sourcePdf: Pick<PDFDocumentProxy, "getPage">,
  pageNumber: number,
  ensureCurrent: () => void,
  preprocessing: OcrPreprocessing = NO_PREPROCESSING,
): Promise<Uint8Array> {
  return (await preparePageImage(sourcePdf, pageNumber, ensureCurrent, preprocessing)).bytes;
}

/** Maps a recognition result from a prepared image back onto the page as rendered. */
export function resultOnPage(result: OcrPageResult, prepared: PreparedPage): OcrPageResult {
  return prepared.map
    ? mapOcrResult(result, prepared.map, prepared.prepared, prepared.rendered)
    : result;
}

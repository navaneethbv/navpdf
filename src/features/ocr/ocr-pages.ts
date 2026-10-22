// Page rendering for OCR, shared by the single-document panel and multi-file OCR. Optional
// preprocessing changes only the image sent for recognition; the PDF page is never altered.

import type { PDFDocumentProxy } from "pdfjs-dist";

export interface OcrPreprocessing {
  grayscale: boolean;
  contrast: boolean;
  threshold: boolean;
  despeckle: boolean;
}

export const NO_PREPROCESSING: OcrPreprocessing = {
  grayscale: false,
  contrast: false,
  threshold: false,
  despeckle: false,
};

export const PREPROCESSING_LABELS: Record<keyof OcrPreprocessing, string> = {
  grayscale: "Convert to grayscale",
  contrast: "Stretch contrast",
  threshold: "Black and white (removes light backgrounds)",
  despeckle: "Remove specks (with black and white)",
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
  for (let seen = histogram[low]; low < 255 && seen <= cut; seen += histogram[low]) low++;
  for (let seen = histogram[high]; high > 0 && seen <= cut; seen += histogram[high]) high--;
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
    pixels.fill(gray[pixel], pixel * 4, pixel * 4 + 3);
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

/** Renders a page at twice its size as PNG for recognition, with optional preprocessing. */
export async function pageImage(
  sourcePdf: Pick<PDFDocumentProxy, "getPage">,
  pageNumber: number,
  ensureCurrent: () => void,
  preprocessing: OcrPreprocessing = NO_PREPROCESSING,
): Promise<Uint8Array> {
  const page = await sourcePdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2, rotation: 0 });
  if (!pageWithinOcrLimit(viewport.width, viewport.height)) {
    throw new Error("This page exceeds the OCR image size limit.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to render the OCR page.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    ensureCurrent();
    if (Object.values(preprocessing).some(Boolean)) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      preprocessPixels(image.data, canvas.width, canvas.height, preprocessing);
      context.putImageData(image, 0, 0);
    }
    const encoded = canvas.toDataURL("image/png").split(",")[1];
    if (!encoded) throw new Error("Unable to encode the OCR page.");
    return Uint8Array.from(atob(encoded), (char) => char.codePointAt(0) ?? 0);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

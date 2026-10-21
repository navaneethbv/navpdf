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

/** Applies the chosen preprocessing to RGBA pixels in place. */
export function preprocessPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: OcrPreprocessing,
) {
  const count = width * height;
  if (!options.grayscale && !options.contrast && !options.threshold) return pixels;
  const gray = new Uint8ClampedArray(count);
  const histogram = new Array<number>(256).fill(0);
  for (let pixel = 0; pixel < count; pixel++) {
    gray[pixel] = luminance(pixels, pixel * 4);
    histogram[gray[pixel]]++;
  }
  if (options.contrast) {
    // Stretch between the 1st and 99th percentiles so a stray pixel does not set the range.
    const cut = count * 0.01;
    let low = 0;
    let high = 255;
    for (let seen = 0; low < 255 && seen + histogram[low] <= cut; low++) seen += histogram[low];
    for (let seen = 0; high > 0 && seen + histogram[high] <= cut; high--) seen += histogram[high];
    if (high > low)
      for (let pixel = 0; pixel < count; pixel++)
        gray[pixel] = ((gray[pixel] - low) * 255) / (high - low);
  }
  if (options.threshold) {
    const stretched = new Array<number>(256).fill(0);
    for (const value of gray) stretched[value]++;
    const level = otsuThreshold(stretched, count);
    for (let pixel = 0; pixel < count; pixel++) gray[pixel] = gray[pixel] > level ? 255 : 0;
    if (options.despeckle) despeckle(gray, width, height);
  }
  for (let pixel = 0; pixel < count; pixel++) {
    const index = pixel * 4;
    pixels[index] = gray[pixel];
    pixels[index + 1] = gray[pixel];
    pixels[index + 2] = gray[pixel];
  }
  return pixels;
}

/** Whitens black pixels with no black 8-neighbour, the isolated noise left after scanning. */
export function despeckle(binary: Uint8ClampedArray, width: number, height: number) {
  const source = binary.slice();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (source[y * width + x] !== 0) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height)
            if (source[ny * width + nx] === 0) neighbours++;
        }
      if (neighbours === 0) binary[y * width + x] = 255;
    }
}

/** Renders a page at twice its size as PNG for recognition, with optional preprocessing. */
export async function pageImage(
  sourcePdf: Pick<PDFDocumentProxy, "getPage">,
  pageNumber: number,
  ensureCurrent: () => void,
  preprocessing: OcrPreprocessing = NO_PREPROCESSING,
): Promise<Uint8Array> {
  const page = await sourcePdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2.0, rotation: 0 });
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

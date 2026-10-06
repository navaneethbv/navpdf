// Extracts the raster images embedded in PDF pages at their stored resolution, as decoded by
// PDF.js. Image masks and vector drawings are not images and are skipped.

import { OPS } from "pdfjs-dist";
import { encodePng } from "./raster.ts";

/** PDF.js ImageKind values. */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

export interface DecodedImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
  ref?: string | null;
}

interface ImagePage {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get(id: string, callback: (value: unknown) => void): void };
  commonObjs: { get(id: string, callback: (value: unknown) => void): void };
}

export interface ExtractedImage {
  page: number;
  index: number;
  width: number;
  height: number;
  png: Uint8Array;
}

const OBJECT_TIMEOUT_MS = 10_000;

function resolveObject(page: ImagePage, id: string): Promise<DecodedImage> {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("An image could not be decoded.")),
      OBJECT_TIMEOUT_MS,
    );
    store.get(id, (value) => {
      clearTimeout(timer);
      resolve(value as DecodedImage);
    });
  });
}

/** Expands 1-bit rows, where a set bit is white, to RGB. */
function expandMonochrome(image: DecodedImage, data: Uint8Array | Uint8ClampedArray) {
  const rowBytes = Math.ceil(image.width / 8);
  const rgb = new Uint8Array(image.width * image.height * 3);
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
    rgb.fill(bit ? 255 : 0, pixel * 3, pixel * 3 + 3);
  }
  return rgb;
}

/** Pixels of an ImageBitmap through a canvas, for engines that decode images to bitmaps. */
function bitmapPixels(bitmap: ImageBitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("An image could not be read.");
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  canvas.width = 0;
  canvas.height = 0;
  return data;
}

export async function imageToPng(image: DecodedImage): Promise<Uint8Array> {
  if (image.bitmap) return encodePng(bitmapPixels(image.bitmap), image.width, image.height, 4);
  const data = image.data;
  if (!data) throw new Error("An image has no pixel data.");
  if (image.kind === RGBA_32BPP) return encodePng(data, image.width, image.height, 4);
  if (image.kind === RGB_24BPP) return encodePng(data, image.width, image.height, 3);
  if (image.kind === GRAYSCALE_1BPP)
    return encodePng(expandMonochrome(image, data), image.width, image.height, 3);
  throw new Error("An image uses an unsupported pixel format.");
}

/**
 * The distinct images drawn on a page. Images already exported from earlier pages, identified
 * by their PDF object, are skipped through `seen`.
 */
export async function pageImages(
  page: ImagePage,
  pageNumber: number,
  seen: Set<string>,
  minimumSize: number,
): Promise<ExtractedImage[]> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const results: ExtractedImage[] = [];
  for (const [index, operation] of fnArray.entries()) {
    const args = argsArray[index];
    const inline = operation === OPS.paintInlineImageXObject;
    if (operation !== OPS.paintImageXObject && !inline) continue;
    const image = inline ? (args[0] as DecodedImage) : await resolveObject(page, String(args[0]));
    const identity = image.ref ?? (inline ? null : `${pageNumber}:${String(args[0])}`);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    if (image.width < minimumSize || image.height < minimumSize) continue;
    results.push({
      page: pageNumber,
      index: results.length + 1,
      width: image.width,
      height: image.height,
      png: await imageToPng(image),
    });
  }
  return results;
}

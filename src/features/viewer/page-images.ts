// Finds the raster image under a point on a page and encodes it as PNG at its own resolution.

import { ImageKind, OPS, type PDFPageProxy } from "pdfjs-dist";
import { imageAt, pageImages } from "./view-geometry";

/** A decoded image as PDF.js delivers it to the display layer. */
export interface DecodedImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

const MAX_IMAGE_PIXELS = 40_000_000;

/** RGBA pixels for PDF.js grayscale-1-bit, RGB and RGBA image data. */
export function rgbaPixels(image: DecodedImage): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, kind, data } = image;
  if (!data) throw new Error("The image has no pixel data.");
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (kind === ImageKind.RGBA_32BPP) {
    pixels.set(data.subarray(0, pixels.length));
    return pixels;
  }
  if (kind === ImageKind.RGB_24BPP) {
    for (let index = 0, source = 0; index < pixels.length; index += 4, source += 3) {
      pixels[index] = data[source];
      pixels[index + 1] = data[source + 1];
      pixels[index + 2] = data[source + 2];
      pixels[index + 3] = 255;
    }
    return pixels;
  }
  if (kind === ImageKind.GRAYSCALE_1BPP) {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const offset = (y * width + x) * 4;
        // PDF.js stores 1-bit images with set bits as white.
        pixels.fill(bit ? 255 : 0, offset, offset + 3);
        pixels[offset + 3] = 255;
      }
    return pixels;
  }
  throw new Error("This image format cannot be copied.");
}

async function encodePng(image: DecodedImage) {
  if (image.width * image.height > MAX_IMAGE_PIXELS)
    throw new Error("The image is too large to copy.");
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be prepared.");
    if (image.bitmap) context.drawImage(image.bitmap, 0, 0);
    else context.putImageData(new ImageData(rgbaPixels(image), image.width, image.height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The image could not be encoded.");
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The topmost image at a point in PDF user space as PNG, or null when there is none. */
export async function imagePngAt(page: PDFPageProxy, x: number, y: number) {
  const list = await page.getOperatorList();
  const found = imageAt(pageImages(list.fnArray, list.argsArray, OPS), x, y);
  if (!found) return null;
  const objects = found.id.startsWith("g_") ? page.commonObjs : page.objs;
  return encodePng(await decodedImage(objects, found.id));
}

/** Waits for PDF.js to deliver a decoded image, which can follow its operator list. */
export function decodedImage(
  objects: { get(id: string, callback: (data: unknown) => void): unknown },
  id: string,
  timeout = 10_000,
) {
  return new Promise<DecodedImage>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The image is not available to copy.")),
      timeout,
    );
    objects.get(id, (data) => {
      clearTimeout(timer);
      resolve(data as DecodedImage);
    });
  });
}

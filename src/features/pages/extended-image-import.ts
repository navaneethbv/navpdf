import { invoke } from "@tauri-apps/api/core";
import { native } from "../../services/native";

export const isExtendedImage = (file: File) =>
  /\.(heic|heif|tiff?|jp2|j2k|jpf|jpx)$/i.test(file.name) ||
  ["image/heic", "image/heif", "image/tiff", "image/jp2", "image/jpx"].includes(file.type);

/** Formats the web view decodes itself; animated images contribute their first frame. */
export const isBrowserImage = (file: File) =>
  /\.(gif|bmp|webp)$/i.test(file.name) ||
  ["image/gif", "image/bmp", "image/webp"].includes(file.type);

const MAX_BROWSER_PIXELS = 32 * 1024 * 1024;

/** Decodes an image with the web view and re-encodes it as PNG. */
export async function browserImageToPng(file: File): Promise<File> {
  if (file.size > 25 * 1024 * 1024) throw new Error("Image exceeds the 25 MB import limit.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("The image could not be decoded.");
  });
  try {
    const { width, height } = bitmap;
    if (width > 16384 || height > 16384 || width * height > MAX_BROWSER_PIXELS)
      throw new Error("Images must be at most 32 megapixels and 16,384 pixels per edge.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("The image could not be converted.");
    return new File([blob], file.name.replace(/\.[^.]+$/, ".png"), { type: "image/png" });
  } finally {
    bitmap.close();
  }
}

export function decodeImageFrames(buffer: ArrayBuffer, name: string): File[] {
  if (buffer.byteLength < 4 || buffer.byteLength > 100 * 1024 * 1024)
    throw new Error("Invalid converted image data.");
  const view = new DataView(buffer),
    count = view.getUint32(0);
  if (!count || count > 100) throw new Error("Invalid image page count.");
  let offset = 4;
  const files: File[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 4 > buffer.byteLength) throw new Error("Truncated image collection.");
    const size = view.getUint32(offset);
    offset += 4;
    if (size < 8 || size > 25 * 1024 * 1024 || offset + size > buffer.byteLength)
      throw new Error("Invalid converted image size.");
    const bytes = new Uint8Array(buffer, offset, size);
    if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71)
      throw new Error("Converted image is not PNG.");
    const pageSuffix = count > 1 ? `-page-${index + 1}` : "";
    files.push(
      new File([bytes], `${name.replace(/\.[^.]+$/, "")}${pageSuffix}.png`, { type: "image/png" }),
    );
    offset += size;
  }
  if (offset !== buffer.byteLength) throw new Error("Unexpected trailing image data.");
  return files;
}

export async function expandImageInput(
  file: File,
  decodeInBrowser: (file: File) => Promise<File> = browserImageToPng,
): Promise<File[]> {
  if (isBrowserImage(file)) return [await decodeInBrowser(file)];
  if (!isExtendedImage(file)) return [file];
  if (!native) throw new Error("HEIC, TIFF and JPEG 2000 import requires the native macOS app.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Image exceeds the 25 MB import limit.");
  const result = await invoke<ArrayBuffer>("import_image_frames", await file.arrayBuffer());
  return decodeImageFrames(result, file.name);
}

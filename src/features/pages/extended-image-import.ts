import { invoke } from "@tauri-apps/api/core";
import { native } from "../../services/native";

export const isExtendedImage = (file: File) =>
  /\.(heic|heif|tiff?)$/i.test(file.name) ||
  ["image/heic", "image/heif", "image/tiff"].includes(file.type);

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

export async function expandImageInput(file: File): Promise<File[]> {
  if (!isExtendedImage(file)) return [file];
  if (!native) throw new Error("HEIC and TIFF import requires the native macOS app.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Image exceeds the 25 MB import limit.");
  const result = await invoke<ArrayBuffer>("import_image_frames", await file.arrayBuffer());
  return decodeImageFrames(result, file.name);
}

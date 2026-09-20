import { PDFDocument } from "pdf-lib";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 32 * 1024 * 1024;
const JPEG_DIMENSION_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

type ImageHeader = {
  format: "png" | "jpeg";
  width: number;
  height: number;
};

function validatedHeader(format: ImageHeader["format"], width: number, height: number) {
  if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_PIXELS)
    throw new Error("Images must be at most 32 megapixels and 16,384 pixels per edge.");
  return { format, width, height } satisfies ImageHeader;
}

function readPngHeader(bytes: Uint8Array, view: DataView): ImageHeader | null {
  if (
    bytes.length < 24 ||
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(12) !== 0x49484452
  )
    return null;
  return validatedHeader("png", view.getUint32(16), view.getUint32(20));
}

type JpegMarker = {
  marker: number;
  offset: number;
};

type JpegSegment = {
  marker: number;
  length: number;
  offset: number;
};

function readJpegMarker(bytes: Uint8Array, offset: number): JpegMarker | null {
  if (bytes.at(offset) !== 0xff) return null;
  while (bytes.at(offset) === 0xff) offset++;
  const marker = bytes.at(offset);
  return marker === undefined ? null : { marker, offset: offset + 1 };
}

function readJpegSegment(
  bytes: Uint8Array,
  view: DataView,
  marker: JpegMarker,
): JpegSegment | null {
  if (marker.marker === 0xda || marker.marker === 0xd9) return null;
  if (marker.marker === 0x01 || (marker.marker >= 0xd0 && marker.marker <= 0xd7))
    return { marker: marker.marker, length: 0, offset: marker.offset };
  if (marker.offset + 2 > bytes.length) return null;
  const length = view.getUint16(marker.offset);
  if (length < 2 || marker.offset + length > bytes.length) return null;
  return { marker: marker.marker, length, offset: marker.offset };
}

function readJpegHeader(bytes: Uint8Array, view: DataView): ImageHeader | null {
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = readJpegMarker(bytes, offset);
    if (!marker) return null;
    const segment = readJpegSegment(bytes, view, marker);
    if (!segment) return null;
    if (JPEG_DIMENSION_MARKERS.has(segment.marker) && segment.length >= 8)
      return validatedHeader(
        "jpeg",
        view.getUint16(segment.offset + 5),
        view.getUint16(segment.offset + 3),
      );
    offset = segment.offset + segment.length;
  }
  return null;
}

/** Inspect the encoded header before the PDF image decoder allocates pixel buffers. */
export function imageHeader(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readPngHeader(bytes, view) ?? readJpegHeader(bytes, view);
  if (header) return header;
  throw new Error("Choose a valid PNG or JPEG image, or a PDF document.");
}

export function isImageFile(file: Pick<File, "name" | "type">): boolean {
  return /^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

export async function imageFileToPdf(file: File): Promise<Uint8Array> {
  if (file.size > MAX_BYTES) throw new Error("Each image must be 25 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { format, width, height } = imageHeader(bytes);
  const document = await PDFDocument.create();
  const image = format === "png" ? await document.embedPng(bytes) : await document.embedJpg(bytes);
  const scale = Math.min(0.75, 792 / Math.max(width, height));
  const page = document.addPage([width * scale, height * scale]);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return document.save();
}

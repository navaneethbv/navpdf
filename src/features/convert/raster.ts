// TIFF, PostScript and EPS writers for rendered page images. Pages are rasterized, so text
// and vector drawings are not editable or resolution independent in the output.

export interface RgbaPage {
  width: number;
  height: number;
  /** Canvas pixels, four bytes per pixel. */
  rgba: Uint8ClampedArray;
  dpi: number;
}

export interface JpegPage {
  /** Encoded baseline JPEG bytes of the rendered page. */
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  /** Page size in PostScript points. */
  width: number;
  height: number;
}

class ByteWriter {
  private buffer = new Uint8Array(1024);
  length = 0;

  private reserve(extra: number) {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  byte(value: number) {
    this.reserve(1);
    this.buffer[this.length++] = value;
  }

  bytes(values: Uint8Array) {
    this.reserve(values.length);
    this.buffer.set(values, this.length);
    this.length += values.length;
  }

  result() {
    return this.buffer.slice(0, this.length);
  }
}

/** Apple PackBits run-length encoding of one row, as TIFF compression 32773 requires. */
export function packBits(row: Uint8Array, out = new ByteWriter()) {
  let index = 0;
  while (index < row.length) {
    let run = 1;
    while (run < 128 && index + run < row.length && row[index + run] === row[index]) run++;
    if (run >= 3) {
      out.byte(257 - run);
      out.byte(row[index]);
      index += run;
      continue;
    }
    const start = index;
    while (index < row.length && index - start < 128) {
      if (index + 2 < row.length && row[index] === row[index + 1] && row[index] === row[index + 2])
        break;
      index++;
    }
    out.byte(index - start - 1);
    out.bytes(row.subarray(start, index));
  }
  return out;
}

const ROWS_PER_STRIP = 64;

/** A page already reduced to PackBits strips, so its raw pixels can be released. */
export interface TiffPage {
  width: number;
  height: number;
  dpi: number;
  strips: Uint8Array[];
  byteLength: number;
}

export function compressTiffPage(page: RgbaPage): TiffPage {
  const strips: Uint8Array[] = [];
  const row = new Uint8Array(page.width * 3);
  for (let top = 0; top < page.height; top += ROWS_PER_STRIP) {
    const strip = new ByteWriter();
    for (let y = top; y < Math.min(page.height, top + ROWS_PER_STRIP); y++) {
      const offset = y * page.width * 4;
      for (let x = 0; x < page.width; x++) {
        // Composite onto white so transparent canvas pixels do not turn black.
        const alpha = page.rgba[offset + x * 4 + 3] / 255;
        for (let channel = 0; channel < 3; channel++) {
          const value = page.rgba[offset + x * 4 + channel];
          row[x * 3 + channel] = Math.round(value * alpha + 255 * (1 - alpha));
        }
      }
      packBits(row, strip);
    }
    strips.push(strip.result());
  }
  return {
    width: page.width,
    height: page.height,
    dpi: page.dpi,
    strips,
    byteLength: strips.reduce((sum, strip) => sum + strip.length, 0),
  };
}

/**
 * A baseline little-endian RGB TIFF with one image file directory per page, PackBits
 * compression and the export resolution recorded in the file.
 */
export function buildTiff(pages: (RgbaPage | TiffPage)[]) {
  if (!pages.length) throw new Error("No pages to export.");
  const out = new ByteWriter();
  const u16 = (value: number) => {
    out.byte(value & 0xff);
    out.byte((value >>> 8) & 0xff);
  };
  const u32 = (value: number) => {
    u16(value & 0xffff);
    u16((value >>> 16) & 0xffff);
  };
  const patches: { at: number; value: number }[] = [];
  const placeholder = () => {
    const at = out.length;
    u32(0);
    return at;
  };
  out.bytes(new Uint8Array([0x49, 0x49, 42, 0]));
  let nextDirectory = placeholder();
  const software = new TextEncoder().encode("NavPDF\0");

  pages.forEach((input, pageIndex) => {
    const page = "strips" in input ? input : compressTiffPage(input);
    const { strips } = page;
    const stripOffsets: number[] = [];
    for (const strip of strips) {
      stripOffsets.push(out.length);
      out.bytes(strip);
    }
    if (out.length % 2) out.byte(0);
    const extra = (bytes: () => void) => {
      const at = out.length;
      bytes();
      if (out.length % 2) out.byte(0);
      return at;
    };
    const bitsAt = extra(() => [8, 8, 8].forEach(u16));
    const offsetsAt = extra(() => stripOffsets.forEach(u32));
    const countsAt = extra(() => strips.forEach((strip) => u32(strip.length)));
    const resolutionAt = extra(() => {
      u32(Math.round(page.dpi));
      u32(1);
    });
    const softwareAt = extra(() => out.bytes(software));

    patches.push({ at: nextDirectory, value: out.length });
    const SHORT = 3;
    const LONG = 4;
    const RATIONAL = 5;
    const ASCII = 2;
    const many = strips.length > 1;
    const entries: [number, number, number, number][] = [
      [254, LONG, 1, 2],
      [256, LONG, 1, page.width],
      [257, LONG, 1, page.height],
      [258, SHORT, 3, bitsAt],
      [259, SHORT, 1, 32773],
      [262, SHORT, 1, 2],
      [273, LONG, strips.length, many ? offsetsAt : stripOffsets[0]],
      [277, SHORT, 1, 3],
      [278, LONG, 1, ROWS_PER_STRIP],
      [279, LONG, strips.length, many ? countsAt : strips[0].length],
      [282, RATIONAL, 1, resolutionAt],
      [283, RATIONAL, 1, resolutionAt],
      [284, SHORT, 1, 1],
      [296, SHORT, 1, 2],
      [297, SHORT, 2, pageIndex | (pages.length << 16)],
      [305, ASCII, software.length, softwareAt],
    ];
    u16(entries.length);
    for (const [tag, type, count, value] of entries) {
      u16(tag);
      u16(type);
      u32(count);
      if (type === SHORT && count === 1) {
        u16(value);
        u16(0);
      } else {
        u32(value);
      }
    }
    nextDirectory = placeholder();
  });

  const bytes = out.result();
  const view = new DataView(bytes.buffer);
  for (const patch of patches) view.setUint32(patch.at, patch.value, true);
  return bytes;
}

/** Adobe ASCII85 encoding terminated by `~>`, wrapped for PostScript line limits. */
export function ascii85(bytes: Uint8Array) {
  const chunks: string[] = [];
  let line = "";
  // ASCII85Decode skips white space; a leading space keeps `%` lines from reading as comments.
  const push = (text: string) => chunks.push(text.startsWith("%") ? ` ${text}` : text);
  const emit = (text: string) => {
    line += text;
    if (line.length >= 75) {
      push(line);
      line = "";
    }
  };
  for (let index = 0; index < bytes.length; index += 4) {
    const remaining = Math.min(4, bytes.length - index);
    let value = 0;
    for (let offset = 0; offset < 4; offset++)
      value = value * 256 + (offset < remaining ? bytes[index + offset] : 0);
    if (value === 0 && remaining === 4) {
      emit("z");
      continue;
    }
    const digits = new Array<string>(5);
    for (let digit = 4; digit >= 0; digit--) {
      digits[digit] = String.fromCodePoint(33 + (value % 85));
      value = Math.floor(value / 85);
    }
    emit(digits.slice(0, remaining + 1).join(""));
  }
  if (line) push(line);
  return `${chunks.join("\n")}~>`;
}

function imageOperator(page: JpegPage) {
  const { pixelWidth: w, pixelHeight: h } = page;
  return [
    "gsave",
    `${page.width} ${page.height} scale`,
    "/DeviceRGB setcolorspace",
    `<< /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /Decode [0 1 0 1 0 1]`,
    `   /ImageMatrix [${w} 0 0 -${h} 0 ${h}]`,
    "   /DataSource currentfile /ASCII85Decode filter /DCTDecode filter >> image",
    ascii85(page.jpeg),
    "grestore",
  ].join("\n");
}

const points = (value: number) => Math.round(value * 1000) / 1000;

/** Language level 2 PostScript with one DSC page per rendered PDF page. */
export function buildPostScript(pages: JpegPage[], title: string) {
  if (!pages.length) throw new Error("No pages to export.");
  const sized = pages.map((page) => ({
    ...page,
    width: points(page.width),
    height: points(page.height),
  }));
  const maxWidth = Math.ceil(Math.max(...sized.map((page) => page.width)));
  const maxHeight = Math.ceil(Math.max(...sized.map((page) => page.height)));
  const body = sized
    .map((page, index) =>
      [
        `%%Page: ${index + 1} ${index + 1}`,
        `%%PageBoundingBox: 0 0 ${Math.ceil(page.width)} ${Math.ceil(page.height)}`,
        "%%BeginPageSetup",
        `<< /PageSize [${page.width} ${page.height}] >> setpagedevice`,
        "%%EndPageSetup",
        imageOperator(page),
        "showpage",
      ].join("\n"),
    )
    .join("\n");
  return [
    "%!PS-Adobe-3.0",
    `%%Title: ${dscText(title)}`,
    "%%Creator: NavPDF",
    "%%LanguageLevel: 2",
    `%%Pages: ${sized.length}`,
    `%%BoundingBox: 0 0 ${maxWidth} ${maxHeight}`,
    "%%DocumentData: Clean7Bit",
    "%%EndComments",
    body,
    "%%Trailer",
    "%%EOF",
    "",
  ].join("\n");
}

/** A single-page Encapsulated PostScript (EPSF-3.0) file without a preview image. */
export function buildEps(page: JpegPage, title: string) {
  const sized = { ...page, width: points(page.width), height: points(page.height) };
  return [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%Title: ${dscText(title)}`,
    "%%Creator: NavPDF",
    "%%LanguageLevel: 2",
    "%%Pages: 1",
    `%%BoundingBox: 0 0 ${Math.ceil(sized.width)} ${Math.ceil(sized.height)}`,
    `%%HiResBoundingBox: 0 0 ${sized.width} ${sized.height}`,
    "%%DocumentData: Clean7Bit",
    "%%EndComments",
    "%%Page: 1 1",
    imageOperator(sized),
    "showpage",
    "%%Trailer",
    "%%EOF",
    "",
  ].join("\n");
}

/** DSC comment values must be printable 7-bit ASCII on a single line. */
function dscText(text: string) {
  return (
    Array.from(text)
      .map((char) => (/^[\x20-\x7e]$/.test(char) ? char : "?"))
      .join("")
      .slice(0, 200) || "Untitled"
  );
}

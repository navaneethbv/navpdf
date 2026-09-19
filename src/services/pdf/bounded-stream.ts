import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream } from "pdf-lib";

// pdf-lib 1.17 exposes decoding but no output limit. Keep this instance-local
// adapter at one boundary and test its allocation contract for every filter.
interface BoundedDecoder {
  buffer: Uint8Array;
  bufferLength: number;
  ensureBuffer: (length: number) => Uint8Array;
  decode: () => Uint8Array;
  readBlock: () => void;
  getCode?: (...args: unknown[]) => number;
}

function boundedDecoder(stream: PDFRawStream, maxBytes: number, checkTime: () => void): BoundedDecoder {
    const decoder = decodePDFRawStream(stream) as unknown as BoundedDecoder;
    if (
      !(decoder.buffer instanceof Uint8Array) ||
      typeof decoder.ensureBuffer !== "function" ||
      typeof decoder.decode !== "function"
    ) {
      throw new TypeError("The PDF stream decoder cannot enforce a size limit.");
    }
    // LZW and ASCII filters reserve ahead of their actual output. This fixed
    // allowance preserves exact-boundary files without unbounded buffer growth.
    const allocationLimit = maxBytes + 4096;
    decoder.ensureBuffer = (length) => {
      checkTime();
      if (!Number.isSafeInteger(length) || length < 0 || length > allocationLimit)
        throw new Error("PDF stream exceeds the allowed decoded size.");
      if (length <= decoder.buffer.length) return decoder.buffer;
      const buffer = new Uint8Array(
        Math.min(allocationLimit, Math.max(length, decoder.buffer.length * 2, 512)),
      );
      buffer.set(decoder.buffer);
      decoder.buffer = buffer;
      return buffer;
    };
    const readBlock = decoder.readBlock.bind(decoder);
    decoder.readBlock = () => {
      checkTime();
      readBlock();
      if (decoder.bufferLength > maxBytes) throw new Error("PDF stream exceeds the allowed decoded size.");
    };
    // A malformed Flate block can loop without producing output or requesting a
    // larger buffer. Its code reader must share the work deadline as well.
    if (decoder.getCode) {
      const getCode = decoder.getCode.bind(decoder);
      decoder.getCode = (...args) => {
        checkTime();
        return getCode(...args);
      };
    }
  return decoder;
}

function extractFilters(stream: PDFRawStream): PDFName[] {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFArray) {
    return Array.from({ length: filter.size() }, (_, i) => filter.lookup(i, PDFName));
  }
  if (filter instanceof PDFName) {
    return [filter];
  }
  if (filter) {
    throw new Error("Invalid PDF stream filter.");
  }
  return [];
}

export function decodeBoundedStream(stream: PDFRawStream, maxBytes: number): Uint8Array {
  const limitError = () => new Error("PDF stream exceeds the allowed decoded size.");
  if (stream.contents.length > maxBytes) throw limitError();
  const filters = extractFilters(stream);
  if (filters.length > 8) throw new Error("PDF stream has too many filters.");
  const params = stream.dict.lookup(PDFName.of("DecodeParms"));
  let bytes = stream.contents;
  const deadline = performance.now() + 2000;
  let operations = 0;
  const checkTime = () => {
    if (++operations % 1024 === 0 && performance.now() > deadline) {
      throw new Error("PDF stream decoding exceeded its time limit.");
    }
  };
  for (let i = 0; i < filters.length; i++) {
    const dict = stream.dict.clone();
    dict.set(PDFName.of("Filter"), filters.at(i) ?? PDFName.of("Invalid"));
    dict.delete(PDFName.of("DecodeParms"));
    const stageParams = params instanceof PDFArray ? params.lookupMaybe(i, PDFDict) : params;
    if (stageParams) dict.set(PDFName.of("DecodeParms"), stageParams);
    // Decode each stage eagerly from bounded raw bytes. Constructing a chained
    // decoder can otherwise read an unguarded upstream stage in its constructor.
    const decoder = boundedDecoder(PDFRawStream.of(dict, bytes), maxBytes, checkTime);
    bytes = decoder.decode();
    if (bytes.length > maxBytes) throw limitError();
  }
  return bytes;
}

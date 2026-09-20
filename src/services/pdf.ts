import {
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  getDocument,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { readRange } from "./native";
import type { DocumentDescriptor } from "../types/document";
GlobalWorkerOptions.workerSrc = workerUrl;
export const pdfAssets = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
};

// WKWebView has incomplete support for the worker-side canvas paths used by
// PDF.js. Keep rendering on the DOM canvas path so a page cannot remain in
// PDF.js's loading state after the document itself has loaded.
export const nativePdfOptions = {
  disableFontFace: true,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  useWasm: false,
  useSystemFonts: false,
  enableHWA: true,
};
export class LocalRangeTransport extends PDFDataRangeTransport {
  private cancelled = false;
  constructor(
    private readonly descriptor: DocumentDescriptor,
    initial: Uint8Array<ArrayBuffer>,
    private readonly failure: (error: Error) => void,
  ) {
    // Mark a complete initial read as finished. Leaving a small document in
    // the incomplete state makes PDF.js wait for an end-of-stream signal while
    // rendering even though every byte is already available.
    super(descriptor.size, initial, initial.length >= descriptor.size, descriptor.name);
  }
  override requestDataRange(begin: number, end: number) {
    // A coalesced PDF.js range request must receive one contiguous response.
    // Native reads remain bounded even when the library asks for a larger range.
    void (async () => {
      const result = new Uint8Array(end - begin);
      for (let offset = begin; offset < end && !this.cancelled; offset += 1024 * 1024) {
        const bytes = await readRange(
          this.descriptor.id,
          offset,
          Math.min(end, offset + 1024 * 1024),
        );
        result.set(bytes, offset - begin);
      }
      if (!this.cancelled) this.onDataRange(begin, result);
    })().catch((error: unknown) =>
      this.failure(error instanceof Error ? error : new Error("The PDF could not be read.")),
    );
  }
  override abort() {
    this.cancelled = true;
  }
}
export async function loadPdf(
  descriptor: DocumentDescriptor,
  onPassword: (submit: (password: string) => void, reason: number) => void,
  onFailure: (error: Error) => void,
) {
  const initial = await readRange(descriptor.id, 0, Math.min(65536, descriptor.size));
  const source =
    initial.byteLength === descriptor.size
      ? { data: initial }
      : {
          range: new LocalRangeTransport(descriptor, initial, onFailure),
          rangeChunkSize: 65536,
          disableAutoFetch: true,
          disableStream: true,
        };
  const task = getDocument({
    ...pdfAssets,
    ...nativePdfOptions,
    ...source,
    enableXfa: false,
    isEvalSupported: false,
    enableScripting: false,
  } as unknown as Parameters<typeof getDocument>[0]);
  task.onPassword = onPassword;
  return task;
}

/** Load an in-memory revision (e.g. after a local mutation) into PDF.js. */
export function loadPdfFromBytes(bytes: Uint8Array<ArrayBuffer>) {
  return getDocument({
    ...pdfAssets,
    ...nativePdfOptions,
    data: bytes,
    enableXfa: false,
    isEvalSupported: false,
    enableScripting: false,
  } as Parameters<typeof getDocument>[0]);
}

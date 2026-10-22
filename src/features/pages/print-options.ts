// Print preparation: page subsets and order, which annotations print, and an optional raster
// path for grayscale or print-as-image output. Everything runs on a copy of the document.

import { mapInOrder } from "../../utils/async-sequence";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfFromBytes } from "../../services/pdf";

export type PageSubset = "all" | "odd" | "even";
export type PrintContent = "document-markups" | "document" | "document-stamps" | "form-fields";

export const CONTENT_LABELS: Record<PrintContent, string> = {
  "document-markups": "Document and markups",
  document: "Document only",
  "document-stamps": "Document and stamps",
  "form-fields": "Form fields only",
};

/** Filters 0-based page indexes by 1-based page parity and optionally reverses them. */
export function selectPrintPages(pages: number[], subset: PageSubset, reverse: boolean) {
  const kept = pages.filter(
    (index) => subset === "all" || (index + 1) % 2 === (subset === "odd" ? 1 : 0),
  );
  if (kept.length === 0) throw new Error(`The chosen range has no ${subset} pages.`);
  return reverse ? kept.reverse() : kept;
}

const KEEP: Record<PrintContent, (subtype: string) => boolean> = {
  "document-markups": () => true,
  document: (subtype) => subtype === "Widget" || subtype === "Link",
  "document-stamps": (subtype) => subtype === "Widget" || subtype === "Link" || subtype === "Stamp",
  "form-fields": (subtype) => subtype === "Widget",
};

/**
 * Removes the annotations the chosen content excludes. "Form fields only" also replaces each
 * page's content with an empty stream so only field appearances print.
 */
export async function preparePrintContent(bytes: Uint8Array, content: PrintContent) {
  if (content === "document-markups") return bytes;
  const doc = await PDFDocument.load(bytes);
  const keep = KEEP[content];
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray) {
      const kept = annots.asArray().filter((entry) => {
        const annotation = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
        if (!(annotation instanceof PDFDict)) return false;
        const subtype = annotation.lookup(PDFName.of("Subtype"));
        return keep(subtype instanceof PDFName ? subtype.decodeText() : "");
      });
      if (kept.length) page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
      else page.node.delete(PDFName.of("Annots"));
    }
    if (content === "form-fields")
      page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream("")));
  }
  return doc.save();
}

/** Converts RGBA pixels to luminance in place (ITU-R BT.601 weights). */
export function toGrayscale(pixels: Uint8ClampedArray) {
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = Math.round(
      0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2],
    );
    pixels[index] = gray;
    pixels[index + 1] = gray;
    pixels[index + 2] = gray;
  }
  return pixels;
}

export interface RasterPage {
  /** JPEG bytes of the page image. */
  jpeg: Uint8Array;
  /** Page size in points as displayed, after rotation. */
  width: number;
  height: number;
}

const MAX_PRINT_PIXELS = 16 * 1024 * 1024;
const MAX_PRINT_EDGE = 8192;

/** The render scale for a page at `dpi`, reduced to stay inside canvas limits. */
export function printScale(width: number, height: number, dpi: number) {
  let scale = dpi / 72;
  scale = Math.min(scale, MAX_PRINT_EDGE / width, MAX_PRINT_EDGE / height);
  scale = Math.min(scale, Math.sqrt(MAX_PRINT_PIXELS / (width * height)));
  return Math.max(scale, 0.1);
}

async function renderPrintPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  dpi: number,
  grayscale: boolean,
): Promise<RasterPage> {
  const page = await pdf.getPage(pageNumber);
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: printScale(natural.width, natural.height, dpi) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("A print canvas could not be created.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      intent: "print",
      annotationMode: AnnotationMode.ENABLE_STORAGE,
    }).promise;
    if (grayscale) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      toGrayscale(image.data);
      context.putImageData(image, 0, 0);
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) throw new Error("A page image could not be encoded for printing.");
    return {
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width: natural.width,
      height: natural.height,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/** Builds a PDF with one full-page image per page. */
export async function imagesToPdf(pages: RasterPage[]) {
  const doc = await PDFDocument.create();
  const images = await Promise.all(pages.map((page) => doc.embedJpg(page.jpeg)));
  for (const [index, page] of pages.entries())
    doc
      .addPage([page.width, page.height])
      .drawImage(images[index], { x: 0, y: 0, width: page.width, height: page.height });
  return doc.save();
}

/** Renders every page as an image, optionally in grayscale, and rebuilds the PDF from them. */
export async function rasterizeForPrint(
  bytes: Uint8Array,
  options: { dpi: number; grayscale: boolean },
  cancelled: () => boolean = () => false,
  render: typeof renderPrintPage = renderPrintPage,
) {
  const task = loadPdfFromBytes(new Uint8Array(bytes));
  try {
    const pdf = await task.promise;
    const renderPage = (number: number) => {
      if (cancelled()) throw new Error("Printing was cancelled.");
      return render(pdf, number, options.dpi, options.grayscale);
    };
    const numbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
    // Pages render one at a time so only one large canvas exists at once.
    const pages: RasterPage[] = [];
    for await (const page of mapInOrder(numbers, renderPage)) pages.push(page);
    return imagesToPdf(pages);
  } finally {
    await task.destroy();
  }
}

import { resolve } from "node:path";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

type MockWithCalls = { mock?: { calls: unknown[][] } };

export function lastReplacedBytes(mock: MockWithCalls): Uint8Array {
  const call = mock.mock?.calls.at(-1);
  const bytes = call?.[0];
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("replaceWithBytes was not called with document bytes");
  }
  return bytes;
}

export function loadWithPdfLib(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

export async function loadWithPdfJs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    data: new Uint8Array(bytes),
    disableAutoFetch: true,
    disableStream: true,
  }).promise;
}

export async function pageTextItems(pdf: PDFDocumentProxy, pageIndex: number) {
  const page = await pdf.getPage(pageIndex + 1);
  return (await page.getTextContent({ disableNormalization: true })).items;
}

export function annotationsOfPage(doc: PDFDocument, pageIndex: number): PDFDict[] {
  const annots = doc.getPage(pageIndex).node().lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return [];
  return annots
    .asArray()
    .map((entry) => doc.context.lookupMaybe(entry, PDFDict))
    .filter((entry): entry is PDFDict => entry !== undefined);
}

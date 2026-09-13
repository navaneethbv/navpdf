import { PDFDocument, PDFName, degrees } from "pdf-lib";

export async function rotatePages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
  angleDegrees: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const indexSet = new Set(pageIndices.filter((i) => i >= 0 && i < total));
  for (let i = 0; i < total; i++) {
    if (indexSet.has(i)) {
      const page = doc.getPage(i);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + angleDegrees + 360) % 360));
    }
  }
  return doc.save();
}

export async function deletePages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const sorted = [...new Set(pageIndices)]
    .filter((i) => i >= 0 && i < total)
    .sort((a, b) => b - a);

  if (sorted.length >= total) {
    throw new Error("Cannot delete all pages. A PDF must contain at least one page.");
  }

  for (const idx of sorted) {
    doc.removePage(idx);
  }
  return doc.save();
}

/**
 * Reorder pages in place.
 *
 * Rebuilding the document with `copyPages` would silently drop the catalog:
 * outlines, the AcroForm and its fields, and document metadata. Rearranging
 * the existing page tree keeps every catalog-level structure intact, so a
 * reorder is a pure permutation of the pages the document already has.
 */
export async function reorderPages(
  pdfBytes: Uint8Array,
  newOrder: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  if (newOrder.length !== total) {
    throw new Error("Page order length must match document page count.");
  }
  const pages = doc.getPages();
  const reordered = newOrder.map((index) => {
    const page = pages[index];
    if (!page) {
      throw new Error(`Page order refers to a page that does not exist: ${index + 1}.`);
    }
    return page;
  });
  for (let i = total - 1; i >= 0; i--) {
    doc.removePage(i);
  }
  reordered.forEach((page, i) => doc.insertPage(i, page));
  return doc.save();
}

export async function extractPages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const total = srcDoc.getPageCount();
  const valid = pageIndices.filter((i) => i >= 0 && i < total);
  if (valid.length === 0) {
    throw new Error("No valid pages selected for extraction.");
  }
  const newDoc = await PDFDocument.create();
  const copied = await newDoc.copyPages(srcDoc, valid);
  for (const page of copied) {
    newDoc.addPage(page);
  }
  return newDoc.save();
}

export async function insertBlankPage(
  pdfBytes: Uint8Array,
  atIndex: number,
  width = 595.28,
  height = 841.89,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const idx = Math.max(0, Math.min(atIndex, total));
  doc.insertPage(idx, [width, height]);
  return doc.save();
}

export async function insertImagePage(
  pdfBytes: Uint8Array,
  atIndex: number,
  imageBytes: Uint8Array,
  type: "png" | "jpg",
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const image =
    type === "png"
      ? await doc.embedPng(imageBytes)
      : await doc.embedJpg(imageBytes);
  const total = doc.getPageCount();
  const idx = Math.max(0, Math.min(atIndex, total));
  const page = doc.insertPage(idx, [image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
  return doc.save();
}

export async function cropPages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
  cropBox: { x: number; y: number; width: number; height: number },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const total = doc.getPageCount();
  const indexSet = new Set(pageIndices.filter((i) => i >= 0 && i < total));
  for (let i = 0; i < total; i++) {
    if (indexSet.has(i)) {
      const page = doc.getPage(i);
      page.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
    }
  }
  return doc.save();
}

export async function mergeDocuments(
  pdfByteArrays: Uint8Array[],
): Promise<Uint8Array> {
  if (pdfByteArrays.length === 0) {
    throw new Error("At least one document is required to merge.");
  }
  const mergedDoc = await PDFDocument.create();
  for (const bytes of pdfByteArrays) {
    const doc = await PDFDocument.load(bytes);
    const pageIndices = doc.getPageIndices();
    const copied = await mergedDoc.copyPages(doc, pageIndices);
    for (const page of copied) {
      mergedDoc.addPage(page);
    }
  }
  return mergedDoc.save();
}

export async function splitDocument(
  pdfBytes: Uint8Array,
  ranges: number[][],
): Promise<Uint8Array[]> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const total = srcDoc.getPageCount();
  const results: Uint8Array[] = [];
  for (const range of ranges) {
    const valid = range.filter((i) => i >= 0 && i < total);
    if (valid.length > 0) {
      const newDoc = await PDFDocument.create();
      const copied = await newDoc.copyPages(srcDoc, valid);
      for (const page of copied) {
        newDoc.addPage(page);
      }
      results.push(await newDoc.save());
    }
  }
  return results;
}

export async function createBlankDocument(
  pageCount = 1,
  width = 595.28,
  height = 841.89,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([width, height]);
  }
  return doc.save();
}

export async function createDocumentFromImage(
  imageBytes: Uint8Array,
  type: "png" | "jpg",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image =
    type === "png"
      ? await doc.embedPng(imageBytes)
      : await doc.embedJpg(imageBytes);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
  return doc.save();
}

/** Catalog-level structures that a whole-document rebuild cannot carry over. */
export type StructureSummary = {
  pages: number;
  hasOutline: boolean;
  formFields: number;
  title: string;
};

export async function inspectStructure(
  pdfBytes: Uint8Array,
): Promise<StructureSummary> {
  const doc = await PDFDocument.load(pdfBytes);
  let formFields: number;
  try {
    formFields = doc.getForm().getFields().length;
  } catch {
    // A malformed AcroForm is reported as carrying no readable fields.
    formFields = 0;
  }
  return {
    pages: doc.getPageCount(),
    hasOutline: !!doc.catalog.get(PDFName.of("Outlines")),
    formFields,
    title: doc.getTitle() ?? "",
  };
}

/**
 * Describe what extraction, merging, and splitting will drop.
 *
 * These operations compose a genuinely new document, so catalog structures
 * belonging to the source do not carry over. The roadmap requires warning
 * about that rather than dropping it silently. Returns "" when there is
 * nothing to lose.
 */
export async function describeStructureLoss(
  sources: Uint8Array[],
): Promise<string> {
  let outlines = 0;
  let formFields = 0;
  for (const bytes of sources) {
    try {
      const summary = await inspectStructure(bytes);
      if (summary.hasOutline) outlines++;
      formFields += summary.formFields;
    } catch {
      // An unreadable input is reported by the operation itself, not here.
    }
  }
  const lost: string[] = [];
  if (outlines > 0) lost.push("bookmarks (document outline)");
  if (formFields > 0)
    lost.push(`${formFields} interactive form field${formFields === 1 ? "" : "s"}`);
  if (lost.length === 0) return "";
  return `This creates a new document, so ${lost.join(" and ")} will not carry over. The open document is unchanged.`;
}

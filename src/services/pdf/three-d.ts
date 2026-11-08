// 3D models in PDFs: adding a U3D or PRC model as a 3D annotation with a poster, and listing the
// 3D annotations a document has so their models can be saved. NavPDF never runs or renders the
// models, and never adds 3D JavaScript; a 3D-capable reader activates them.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { toPdfDate } from "../document-commands";
import { visibleBox } from "./page-box";
import { pdfText } from "./text-string";
import { decodeBoundedStream } from "./bounded-stream";

/** The largest model added or saved, in bytes. */
export const MAX_MODEL_BYTES = 100 * 1024 * 1024;
const MAX_POSTER_BYTES = 20 * 1024 * 1024;

export type ModelFormat = "U3D" | "PRC";

/** A U3D file starts with "U3D" and a zero byte; a PRC file starts with "PRC". */
export function modelFormat(bytes: Uint8Array): ModelFormat | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x55 &&
    bytes[1] === 0x33 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0
  )
    return "U3D";
  if (bytes.length >= 3 && bytes[0] === 0x50 && bytes[1] === 0x52 && bytes[2] === 0x43)
    return "PRC";
  return null;
}

export interface AddModelInput {
  page: number;
  /** Where the model's box goes on the visible page, in points from its lower-left corner. */
  rect: [number, number, number, number];
  model: Uint8Array;
  /** A PNG or JPEG shown until the model is activated; a labelled frame without one. */
  poster?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  /** Activate when clicked, or when the page opens. */
  activation: "click" | "page-open";
  description?: string;
}

/** Adds a 3D annotation holding a U3D or PRC model. */
export async function add3dModel(bytes: Uint8Array, input: AddModelInput): Promise<Uint8Array> {
  if (!input.model.length || input.model.length > MAX_MODEL_BYTES)
    throw new Error("Choose a 3D model of up to 100 MB.");
  const format = modelFormat(input.model);
  if (!format) throw new Error("Choose a U3D or PRC file; the file's contents are not a 3D model.");
  if (input.poster && input.poster.bytes.length > MAX_POSTER_BYTES)
    throw new Error("Choose a poster picture of up to 20 MB.");
  const doc = await PDFDocument.load(bytes);
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > doc.getPageCount())
    throw new Error("Choose a page in this document.");
  const page = doc.getPage(input.page - 1);
  const box = visibleBox(page);
  const [x1, y1, x2, y2] = input.rect;
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 - x1 < 10 || y2 - y1 < 10)
    throw new Error("The model's box must be at least 10 points each way.");
  const rect = [box.x + x1, box.y + y1, box.x + x2, box.y + y2].map((value, index) =>
    Math.min(
      Math.max(value, index % 2 ? box.y : box.x),
      index % 2 ? box.y + box.height : box.x + box.width,
    ),
  ) as [number, number, number, number];
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  if (width < 10 || height < 10) throw new Error("The model's box must lie on the page.");

  const stream = doc.context.flateStream(input.model, { Type: "3D", Subtype: format });
  const streamRef = doc.context.register(stream);

  // The poster: a picture fitted in the box, or a frame naming the model.
  let operators: string;
  const resources: Record<string, unknown> = {};
  if (input.poster) {
    const image =
      input.poster.type === "png"
        ? await doc.embedPng(input.poster.bytes)
        : await doc.embedJpg(input.poster.bytes);
    const scale = Math.min(width / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const x = rect[0] + (width - w) / 2;
    const y = rect[1] + (height - h) / 2;
    resources.XObject = { Poster: image.ref };
    operators = `q ${w} 0 0 ${h} ${x} ${y} cm /Poster Do Q`;
  } else {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const label = `3D model (${format})`;
    const size = Math.max(6, Math.min(14, width / 14));
    const textWidth = font.widthOfTextAtSize(label, size);
    const gray = rgb(0.45, 0.45, 0.45);
    resources.Font = { F0: font.ref };
    operators = [
      "q",
      `0.95 0.95 0.95 rg ${gray.red} ${gray.green} ${gray.blue} RG 1 w`,
      `${rect[0] + 0.5} ${rect[1] + 0.5} ${width - 1} ${height - 1} re B`,
      `BT /F0 ${size} Tf ${gray.red} ${gray.green} ${gray.blue} rg`,
      `${rect[0] + (width - textWidth) / 2} ${rect[1] + height / 2 - size / 3} Td`,
      `<${Array.from(font.encodeText(label).asBytes(), (b) => b.toString(16).padStart(2, "0")).join("")}> Tj ET`,
      "Q",
    ].join("\n");
  }
  const appearance = doc.context.register(
    doc.context.stream(operators, {
      Type: "XObject",
      Subtype: "Form",
      BBox: rect,
      Resources: resources,
    } as never),
  );
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: "3D",
    Rect: rect,
    P: page.ref,
    F: 4,
    NM: PDFString.of(`navpdf-3d-${crypto.randomUUID()}`),
    M: PDFString.of(toPdfDate()),
    Contents: pdfText(input.description?.trim() || `3D model (${format})`),
    "3DD": streamRef,
    // Explicit activation by a click, or on page open; deactivated when the page closes.
    "3DA": { A: input.activation === "page-open" ? "PO" : "XA", D: "PC", DIS: "U" },
    "3DI": true,
    AP: { N: appearance },
  } as never);
  page.node.addAnnot(doc.context.register(annotation));
  return doc.save();
}

export interface ModelEntry {
  page: number;
  name: string;
  format: ModelFormat | "unknown";
  /** Size of the stored model stream, before decompression. */
  storedBytes: number;
  /** Named views the model offers. */
  views: number;
  /** The model asks a reader to run JavaScript when it starts; NavPDF never runs it. */
  script: boolean;
  description: string;
}

function modelStream(annotation: PDFDict) {
  let value = annotation.lookup(PDFName.of("3DD"));
  // A 3D reference dictionary points at the stream through /3DD again.
  if (value instanceof PDFDict && !(value instanceof PDFStream))
    value = value.lookup(PDFName.of("3DD"));
  return value instanceof PDFRawStream ? value : null;
}

function* modelAnnotations(doc: PDFDocument) {
  for (const [index, page] of doc.getPages().entries()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annotation = annots.lookupMaybe(i, PDFDict);
      if (annotation?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() === "3D") {
        yield { annotation, page: index + 1 };
      }
    }
  }
}

/** The 3D annotations in a document, with what each model holds. */
export async function list3dModels(bytes: Uint8Array): Promise<ModelEntry[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return Array.from(modelAnnotations(doc), ({ annotation, page }, index) => {
    const stream = modelStream(annotation);
    const subtype = stream?.dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
    return {
      page,
      name:
        annotation.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText() ??
        `3D model ${index + 1}`,
      format: subtype === "U3D" || subtype === "PRC" ? subtype : "unknown",
      storedBytes: stream?.contents.length ?? 0,
      views: stream?.dict.lookupMaybe(PDFName.of("VA"), PDFArray)?.size() ?? 0,
      script: !!stream?.dict.has(PDFName.of("OnInstantiate")),
      description:
        annotation.lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)?.decodeText() ?? "",
    };
  });
}

function extractModelStream(annotation: PDFDict) {
  const stream = modelStream(annotation);
  if (!stream) throw new Error("This 3D annotation has no model stream.");
  const bytes = decodeBoundedStream(stream, MAX_MODEL_BYTES);
  const extension = modelFormat(bytes)?.toLowerCase() ?? "bin";
  return { bytes, extension };
}

/** The decompressed model file to save, or null if the selected annotation no longer exists. */
export async function extract3dModel(bytes: Uint8Array, index: number) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let seen = 0;
  for (const { annotation } of modelAnnotations(doc)) {
    if (seen++ === index) return extractModelStream(annotation);
  }
  return null;
}

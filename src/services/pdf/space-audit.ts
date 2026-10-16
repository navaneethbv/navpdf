// Estimates which kinds of content take up space in a PDF. Each indirect object is sized as
// pdf-lib would serialize it, uncompressed object streams included, so the shares describe the
// document's contents rather than exact byte ranges of the original file.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFObject,
} from "pdf-lib";

export const SPACE_CATEGORIES = [
  "Page content",
  "Images",
  "Fonts",
  "Graphics and forms",
  "Comments and fields",
  "Bookmarks and links",
  "Structure tags",
  "Metadata",
  "Attachments",
  "Document structure",
  "Other",
] as const;
export type SpaceCategory = (typeof SPACE_CATEGORIES)[number];

export interface SpaceRow {
  category: SpaceCategory;
  objects: number;
  bytes: number;
}

export interface SpaceAudit {
  fileBytes: number;
  rows: SpaceRow[];
  measuredBytes: number;
}

const name = (dict: PDFDict, key: string) =>
  dict.lookupMaybe(PDFName.of(key), PDFName)?.asString() ?? "";

const refsIn = (value: PDFObject | undefined): PDFRef[] => {
  if (value instanceof PDFRef) return [value];
  if (value instanceof PDFArray)
    return value.asArray().filter((item): item is PDFRef => item instanceof PDFRef);
  return [];
};

/** Appearance streams of an annotation: /N, /R and /D, each direct or keyed by state. */
function appearanceRefs(annotation: PDFDict): PDFRef[] {
  const appearance = annotation.lookupMaybe(PDFName.of("AP"), PDFDict);
  if (!appearance) return [];
  return ["N", "R", "D"].flatMap((key) => {
    const entry = appearance.get(PDFName.of(key));
    if (entry instanceof PDFRef) return [entry];
    if (!(entry instanceof PDFDict)) return [];
    return entry.values().filter((item): item is PDFRef => item instanceof PDFRef);
  });
}

function classify(object: PDFObject, known: Map<string, SpaceCategory>, ref: PDFRef) {
  const assigned = known.get(ref.toString());
  if (assigned) return assigned;
  const candidate = object instanceof PDFStream ? object.dict : object;
  const dict = candidate instanceof PDFDict ? candidate : null;
  if (!dict) return "Other";
  const type = name(dict, "Type");
  const subtype = name(dict, "Subtype");
  if (subtype === "/Image") return "Images";
  if (subtype === "/Form") return "Graphics and forms";
  if (type === "/Font" || type === "/FontDescriptor") return "Fonts";
  if (type === "/Annot") return "Comments and fields";
  if (type === "/StructElem" || type === "/StructTreeRoot" || type === "/MCR" || type === "/OBJR")
    return "Structure tags";
  if (type === "/Metadata") return "Metadata";
  if (type === "/EmbeddedFile" || type === "/Filespec") return "Attachments";
  if (type === "/Outlines" || type === "/Action" || dict.has(PDFName.of("Title")))
    return "Bookmarks and links";
  if (["/XRef", "/ObjStm", "/Pages", "/Page", "/Catalog"].includes(type))
    return "Document structure";
  return "Other";
}

function markFontFiles(doc: PDFDocument, mark: (refs: PDFRef[], category: SpaceCategory) => void) {
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && name(object, "Type") === "/FontDescriptor")
      for (const key of ["FontFile", "FontFile2", "FontFile3"])
        mark(refsIn(object.get(PDFName.of(key))), "Fonts");
  }
}

function knownCategories(doc: PDFDocument) {
  const known = new Map<string, SpaceCategory>();
  const mark = (refs: PDFRef[], category: SpaceCategory) =>
    refs.forEach((ref) => known.set(ref.toString(), category));
  for (const page of doc.getPages()) {
    mark(refsIn(page.node.get(PDFName.of("Contents"))), "Page content");
    for (const ref of refsIn(page.node.get(PDFName.of("Annots")))) {
      const annotation = doc.context.lookup(ref);
      if (!(annotation instanceof PDFDict)) continue;
      const link = name(annotation, "Subtype") === "/Link";
      const category = link ? "Bookmarks and links" : "Comments and fields";
      mark([ref, ...appearanceRefs(annotation)], category);
    }
  }
  markFontFiles(doc, mark);
  const info = doc.context.trailerInfo.Info;
  if (info instanceof PDFRef) known.set(info.toString(), "Metadata");

  return known;
}

export async function auditSpace(bytes: Uint8Array): Promise<SpaceAudit> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const known = knownCategories(doc);

  const totals = new Map<SpaceCategory, SpaceRow>(
    SPACE_CATEGORIES.map((category) => [category, { category, objects: 0, bytes: 0 }]),
  );
  let measuredBytes = 0;
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const size = object.sizeInBytes();
    const row = totals.get(classify(object, known, ref))!;
    row.objects++;
    row.bytes += size;
    measuredBytes += size;
  }
  return {
    fileBytes: bytes.length,
    measuredBytes,
    rows: [...totals.values()].filter((row) => row.objects).sort((a, b) => b.bytes - a.bytes),
  };
}

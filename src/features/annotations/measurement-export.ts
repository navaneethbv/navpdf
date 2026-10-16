// Lists saved measurement annotations (lines, polylines and polygons carrying a /Measure
// scale) for a spreadsheet. Values are the captions recorded in the PDF, so measurements made
// by other applications are listed as they wrote them.

import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { csvField } from "../convert/formats.ts";
import { parsePdfDate } from "../../utils/pdf-date.ts";

export interface MeasurementRow {
  page: number;
  kind: "Distance" | "Perimeter" | "Area";
  value: string;
  scale: string;
  author: string;
  modified: string;
}

const KINDS: Record<string, MeasurementRow["kind"]> = {
  "/Line": "Distance",
  "/PolyLine": "Perimeter",
  "/Polygon": "Area",
};

const text = (dict: PDFDict | undefined, key: string) => {
  const value = dict?.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
};

export async function readMeasurements(bytes: Uint8Array): Promise<MeasurementRow[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const rows: MeasurementRow[] = [];
  doc.getPages().forEach((page, index) => {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annotation = doc.context.lookup(ref);
      if (!(annotation instanceof PDFDict)) continue;
      const kind = KINDS[annotation.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() ?? ""];
      const measure = annotation.lookupMaybe(PDFName.of("Measure"), PDFDict);
      if (!kind || !measure) continue;
      rows.push({
        page: index + 1,
        kind,
        value: text(annotation, "Contents"),
        scale: text(measure, "R"),
        author: text(annotation, "T"),
        modified: parsePdfDate(text(annotation, "M")),
      });
    }
  });
  return rows;
}

/** UTF-8 CSV with a byte order mark; formula-like cells are neutralised by `csvField`. */
export function measurementsCsv(rows: MeasurementRow[]) {
  const lines = [["Page", "Type", "Value", "Scale", "Author", "Modified"]];
  for (const row of rows)
    lines.push([String(row.page), row.kind, row.value, row.scale, row.author, row.modified]);
  return `\uFEFF${lines.map((line) => line.map(csvField).join(",")).join("\r\n")}\r\n`;
}

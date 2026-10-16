// A printable PDF summary of a comparison: totals, then each added, removed or changed page
// with an excerpt of the text that differs. Built-in fonts cover Latin text only, so other
// characters are shown as "?" and the report says so.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { changedText, type ComparedPage, type PageSignature } from "./compare-pdf";

const EXCERPT = 400;
const PAGE: [number, number] = [612, 792];
const MARGIN = 54;

export interface CompareReportInput {
  originalName: string;
  revisedName: string;
  rows: ComparedPage[];
  signatures: [PageSignature[], PageSignature[]];
  created?: Date;
}

/** Text the font can draw, with every other character replaced by "?". */
function drawable(font: PDFFont, text: string) {
  let replaced = false;
  const result = [...text.replaceAll(/\s+/g, " ")]
    .map((char) => {
      try {
        font.encodeText(char);
        return char;
      } catch {
        replaced = true;
        return "?";
      }
    })
    .join("");
  return { text: result, replaced };
}

function excerpt(text: string) {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT ? `${trimmed.slice(0, EXCERPT)}…` : trimmed;
}

function wrap(font: PDFFont, text: string, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
    // Break a single overlong word so it never runs off the page.
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

function reportWriter(doc: PDFDocument, regular: PDFFont) {
  let page: PDFPage = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  let replaced = false;
  const write = (value: string, size = 10, font = regular, color = rgb(0, 0, 0), indent = 0) => {
    const safe = drawable(font, value);
    replaced ||= safe.replaced;
    for (const line of wrap(font, safe.text, size, PAGE[0] - 2 * MARGIN - indent)) {
      if (y < MARGIN + size) {
        page = doc.addPage(PAGE);
        y = PAGE[1] - MARGIN;
      }
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= size * 1.35;
    }
  };
  const gap = (points: number) => (y -= points);

  return { write, gap, hasReplacements: () => replaced };
}

function pageDescription(row: ComparedPage) {
  if (row.status === "added") return `Revision page ${row.after} added`;
  if (row.status === "removed") return `Original page ${row.before} removed`;
  return `Original page ${row.before} changed in revision page ${row.after}`;
}

function pageText(signatures: PageSignature[], page: number | null) {
  return page ? (signatures[page - 1]?.text ?? "") : "";
}

function writeTextChanges(
  before: string,
  after: string,
  writer: ReturnType<typeof reportWriter>,
  regular: PDFFont,
) {
  const { write } = writer;
  const red = rgb(0.7, 0.1, 0.1);
  const green = rgb(0.05, 0.45, 0.15);
  const diff = changedText(before, after);
  if (!diff.before.trim() && !diff.after.trim())
    write("Text is identical; the page looks different.", 10, regular, rgb(0.3, 0.3, 0.3), 12);
  if (diff.before.trim()) write(`Removed: ${excerpt(diff.before)}`, 10, regular, red, 12);
  if (diff.after.trim()) write(`Added: ${excerpt(diff.after)}`, 10, regular, green, 12);
}

function writeChanges(
  input: CompareReportInput,
  writer: ReturnType<typeof reportWriter>,
  regular: PDFFont,
  bold: PDFFont,
) {
  const { write, gap } = writer;
  const red = rgb(0.7, 0.1, 0.1);
  const green = rgb(0.05, 0.45, 0.15);
  for (const row of input.rows) {
    if (row.status === "unchanged") continue;
    write(pageDescription(row), 11, bold);
    const before = pageText(input.signatures[0], row.before);
    const after = pageText(input.signatures[1], row.after);
    if (row.status === "changed") {
      writeTextChanges(before, after, writer, regular);
    } else {
      const text = excerpt(row.status === "added" ? after : before);
      write(text || "No text on this page.", 10, regular, row.status === "added" ? green : red, 12);
    }
    gap(8);
  }
}

export async function compareReportPdf(input: CompareReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle("Comparison report");
  doc.setProducer("NavPDF");
  const writer = reportWriter(doc, regular);
  const { write, gap } = writer;

  const counts = { changed: 0, added: 0, removed: 0, unchanged: 0 };
  for (const row of input.rows) counts[row.status]++;
  write("Comparison report", 18, bold);
  gap(4);
  write(`Original: ${input.originalName}`);
  write(`Revision: ${input.revisedName}`);
  write(
    `Created: ${(input.created ?? new Date()).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  );
  gap(8);
  write(
    `${counts.changed} changed, ${counts.added} added, ${counts.removed} removed and ${counts.unchanged} unchanged pages.`,
    11,
    bold,
  );
  gap(10);

  writeChanges(input, writer, regular, bold);
  if (!counts.changed && !counts.added && !counts.removed)
    write("The documents have the same text and appearance on every page.");
  if (writer.hasReplacements()) {
    gap(8);
    write(
      'Characters the report font cannot show are printed as "?".',
      9,
      regular,
      rgb(0.3, 0.3, 0.3),
    );
  }
  return doc.save();
}

// Plain text to PDF with the built-in Latin fonts. Lines wrap at word boundaries, long words
// break by character, and a form feed starts a new page.

import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { validateStandardFontCoverage } from "../../services/document-commands";

export interface TextPdfOptions {
  width: number;
  height: number;
  fontSize: number;
  monospace: boolean;
}

const MARGIN = 54;
const MAX_TEXT_CHARS = 5_000_000;
const MAX_PAGES = 2000;

/** Breaks one paragraph into lines that fit `maxWidth`. */
export function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number) {
  // Trailing spaces never print, so they do not count toward the width.
  const fits = (value: string) => font.widthOfTextAtSize(value.trimEnd(), size) <= maxWidth;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/(?<= )/)) {
    if (fits(line + word)) {
      line += word;
      continue;
    }
    if (line) lines.push(line.trimEnd());
    // A word wider than the line is split by character.
    let rest = word;
    while (!fits(rest)) {
      let cut = 1;
      while (cut < rest.length && fits(rest.slice(0, cut + 1))) cut++;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  lines.push(line.trimEnd());
  return lines;
}

export async function textToPdf(text: string, options: TextPdfOptions) {
  if (!text.trim()) throw new Error("There is no text to convert.");
  if (text.length > MAX_TEXT_CHARS) throw new Error("Text is limited to 5 million characters.");
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ");
  const coverage = validateStandardFontCoverage(normalized.replaceAll("\f", ""));
  if (!coverage.valid)
    throw new Error(
      `The built-in fonts cannot show: ${coverage.unsupportedChars.slice(0, 10).join(" ")}. Use Latin text, or print the text to PDF from another app.`,
    );
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(
    options.monospace ? StandardFonts.Courier : StandardFonts.Helvetica,
  );
  const leading = options.fontSize * 1.25;
  const maxWidth = options.width - 2 * MARGIN;
  const linesPerPage = Math.max(1, Math.floor((options.height - 2 * MARGIN) / leading));
  for (const block of normalized.split("\f")) {
    const lines = block
      .split("\n")
      .flatMap((paragraph) => wrapLine(paragraph, font, options.fontSize, maxWidth));
    for (let start = 0; start < lines.length; start += linesPerPage) {
      if (doc.getPageCount() >= MAX_PAGES)
        throw new Error("The text would need more than 2,000 pages.");
      const page = doc.addPage([options.width, options.height]);
      lines.slice(start, start + linesPerPage).forEach((line, index) => {
        if (line)
          page.drawText(line, {
            x: MARGIN,
            y: options.height - MARGIN - options.fontSize - index * leading,
            size: options.fontSize,
            font,
          });
      });
    }
  }
  return doc.save();
}

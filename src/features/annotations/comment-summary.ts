// A comment summary lists every review annotation with its page, author, date, text, replies and
// review status, for sharing outside a PDF reader. It reads the saved PDF, not the viewer state.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";
import { previewLabels, readPageLabels } from "../../services/pdf/page-labels.ts";
import { csvField } from "../convert/formats.ts";
import { escapeXml } from "../convert/ooxml.ts";

export interface CommentEntry {
  id: string;
  page: number;
  pageLabel: string;
  type: string;
  author: string;
  /** ISO 8601 date and time, or empty when the PDF does not record a valid one. */
  modified: string;
  text: string;
  status: string;
  replies: CommentEntry[];
}

export type CommentSort = "page" | "author" | "date";

const TYPE_NAMES: Record<string, string> = {
  Text: "Note",
  FreeText: "Text box",
  Highlight: "Highlight",
  Underline: "Underline",
  StrikeOut: "Strikethrough",
  Squiggly: "Squiggly underline",
  Square: "Rectangle",
  Circle: "Oval",
  Line: "Line",
  Polygon: "Polygon",
  PolyLine: "Polyline",
  Ink: "Drawing",
  Stamp: "Stamp",
  Caret: "Insert text",
  FileAttachment: "Attachment",
  Sound: "Sound",
};

function text(dict: PDFDict, key: string) {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

function nameOf(dict: PDFDict, key: string) {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFName ? value.decodeText() : "";
}

/** Parses a PDF date string (D:YYYYMMDDHHmmSSOHH'mm') into ISO 8601, or "" when invalid. */
export function parsePdfDate(value: string): string {
  const match =
    /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?$/.exec(
      value.trim(),
    );
  if (!match) return "";
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00"] = match;
  const sign = match[7];
  const offset =
    !sign || sign.toUpperCase() === "Z" ? "Z" : `${sign}${match[8] ?? "00"}:${match[9] ?? "00"}`;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

interface Raw {
  ref: string;
  entry: CommentEntry;
  inReplyTo: string;
  reviewState: string;
}

function readAnnotation(dict: PDFDict, ref: string, page: number, label: string): Raw | null {
  const subtype = nameOf(dict, "Subtype");
  if (!(subtype in TYPE_NAMES)) return null;
  const parent = dict.get(PDFName.of("IRT"));
  const stateModel = text(dict, "StateModel") || nameOf(dict, "StateModel");
  const state = text(dict, "State") || nameOf(dict, "State");
  return {
    ref,
    inReplyTo: parent instanceof PDFRef ? parent.toString() : "",
    reviewState: stateModel === "Review" ? state : "",
    entry: {
      id: text(dict, "NM") || ref,
      page,
      pageLabel: label,
      type: TYPE_NAMES[subtype],
      author: text(dict, "T"),
      modified: parsePdfDate(text(dict, "M") || text(dict, "CreationDate")),
      text: text(dict, "Contents"),
      status: "",
      replies: [],
    },
  };
}

function compareBy(sort: CommentSort) {
  return (a: CommentEntry, b: CommentEntry) => {
    if (sort === "author") return a.author.localeCompare(b.author) || a.page - b.page;
    if (sort === "date") return a.modified.localeCompare(b.modified) || a.page - b.page;
    return a.page - b.page;
  };
}

/** Threads replies under their comments; review states become the comment's status. */
export function collectComments(doc: PDFDocument, sort: CommentSort = "page"): CommentEntry[] {
  const labels = previewLabels(readPageLabels(doc), doc.getPageCount());
  const all: Raw[] = [];
  for (const [index, page] of doc.getPages().entries()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (const ref of annots.asArray()) {
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict)) continue;
      const raw = readAnnotation(dict, ref.toString(), index + 1, labels[index]);
      if (raw) all.push(raw);
    }
  }
  const byRef = new Map(all.map((raw) => [raw.ref, raw]));
  const roots: CommentEntry[] = [];
  for (const raw of all) {
    const parent = byRef.get(raw.inReplyTo);
    if (parent && raw.reviewState) parent.entry.status = raw.reviewState;
    else if (parent) parent.entry.replies.push(raw.entry);
    else roots.push(raw.entry);
  }
  return roots.sort(compareBy(sort));
}

function displayDate(iso: string) {
  return iso ? iso.slice(0, 16).replace("T", " ") : "";
}

const escapeHtml = (value: string) => escapeXml(value).replaceAll("'", "&#39;");

function htmlEntry(entry: CommentEntry, reply: boolean): string {
  const meta = [
    reply ? "Reply" : entry.type,
    entry.author && `by ${entry.author}`,
    displayDate(entry.modified),
    entry.status && `Status: ${entry.status}`,
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const body = entry.text ? `<p>${escapeHtml(entry.text).replaceAll("\n", "<br>")}</p>` : "";
  const replies = entry.replies.map((item) => htmlEntry(item, true)).join("");
  const nested = replies ? `<div class="replies">${replies}</div>` : "";
  return `<article><p class="meta">${meta}</p>${body}${nested}</article>`;
}

/** A self-contained, printable HTML report grouped by page. */
export function commentSummaryHtml(entries: CommentEntry[], title: string): string {
  const sections: string[] = [];
  let currentPage = 0;
  for (const entry of entries) {
    if (entry.page !== currentPage) {
      currentPage = entry.page;
      sections.push(`<h2>Page ${escapeHtml(entry.pageLabel)}</h2>`);
    }
    sections.push(htmlEntry(entry, false));
  }
  const count = entries.length;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="generator" content="NavPDF">
<title>Comments: ${escapeHtml(title)}</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
h2 { font-size: 1.05rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; margin-top: 1.5rem; }
article { margin: 0.75rem 0; break-inside: avoid; }
.meta { color: #555; font-size: 0.85rem; margin: 0; }
.replies { margin-left: 1.25rem; border-left: 2px solid #ddd; padding-left: 0.75rem; }
p { margin: 0.25rem 0; }
</style>
</head>
<body>
<h1>Comments: ${escapeHtml(title)}</h1>
<p class="meta">${count} comment${count === 1 ? "" : "s"}</p>
${sections.join("\n")}
</body>
</html>
`;
}

/** UTF-8 CSV with one row per comment or reply; replies name the comment they answer. */
export function commentSummaryCsv(entries: CommentEntry[]): string {
  const header = ["Page", "Type", "Author", "Modified", "Status", "In reply to", "Text"];
  const rows: string[][] = [];
  const add = (entry: CommentEntry, parent?: CommentEntry) => {
    rows.push([
      entry.pageLabel,
      parent ? "Reply" : entry.type,
      entry.author,
      entry.modified,
      entry.status,
      parent?.id ?? "",
      entry.text,
    ]);
    for (const reply of entry.replies) add(reply, entry);
  };
  for (const entry of entries) add(entry);
  const lines = [header, ...rows].map((row) => row.map((cell) => csvField(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function readCommentSummary(pdfBytes: Uint8Array, sort: CommentSort) {
  return collectComments(await PDFDocument.load(pdfBytes), sort);
}

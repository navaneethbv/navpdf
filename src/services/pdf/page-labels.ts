// Page labels give pages displayed numbers such as i, ii, 1, 2 or A-1 without reordering them.
// They are stored as a number tree in the catalog's /PageLabels entry (ISO 32000 section 12.4.2).

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import { pdfText } from "./text-string.ts";

export type LabelStyle =
  "decimal" | "roman-upper" | "roman-lower" | "letters-upper" | "letters-lower" | "none";

export interface PageLabelRange {
  /** First page of the range, counting from 1. */
  startPage: number;
  style: LabelStyle;
  prefix: string;
  /** Number shown on the first page of the range, at least 1. */
  firstNumber: number;
}

const STYLE_NAMES: Record<Exclude<LabelStyle, "none">, string> = {
  decimal: "D",
  "roman-upper": "R",
  "roman-lower": "r",
  "letters-upper": "A",
  "letters-lower": "a",
};

const STYLES_BY_NAME = new Map(
  Object.entries(STYLE_NAMES).map(([style, name]) => [name, style as LabelStyle]),
);

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function roman(value: number) {
  let remaining = value;
  let result = "";
  for (const [amount, symbol] of ROMAN) {
    const count = Math.floor(remaining / amount);
    result += symbol.repeat(count);
    remaining -= count * amount;
  }
  return result;
}

/** A to Z, then AA to ZZ, then AAA: the letter repeats once per pass through the alphabet. */
function letters(value: number) {
  const letter = String.fromCodePoint(65 + ((value - 1) % 26));
  return letter.repeat(Math.floor((value - 1) / 26) + 1);
}

function numberLabel(style: LabelStyle, value: number) {
  switch (style) {
    case "decimal":
      return String(value);
    case "roman-upper":
      return roman(value);
    case "roman-lower":
      return roman(value).toLowerCase();
    case "letters-upper":
      return letters(value);
    case "letters-lower":
      return letters(value).toLowerCase();
    default:
      return "";
  }
}

/** The label each page shows under the given ranges, as PDF readers compute it. */
export function previewLabels(ranges: PageLabelRange[], pageCount: number): string[] {
  const sorted = [...ranges].sort((a, b) => a.startPage - b.startPage);
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    const range = sorted.filter((candidate) => candidate.startPage <= page).at(-1);
    if (!range) return String(page);
    return `${range.prefix}${numberLabel(range.style, range.firstNumber + page - range.startPage)}`;
  });
}

/** Checks ranges against the document and returns them ordered by start page. */
export function validateRanges(ranges: PageLabelRange[], pageCount: number): PageLabelRange[] {
  const sorted = [...ranges].sort((a, b) => a.startPage - b.startPage);
  if (sorted.length && sorted[0].startPage !== 1)
    throw new Error("The first label range must start on page 1.");
  const starts = new Set<number>();
  for (const range of sorted) {
    if (!Number.isInteger(range.startPage) || range.startPage < 1 || range.startPage > pageCount)
      throw new Error(`Label ranges must start between page 1 and page ${pageCount}.`);
    if (starts.has(range.startPage))
      throw new Error(`Two label ranges start on page ${range.startPage}.`);
    starts.add(range.startPage);
    if (!Number.isInteger(range.firstNumber) || range.firstNumber < 1 || range.firstNumber > 1e6)
      throw new Error("Label numbering must start at a whole number from 1 to 1,000,000.");
    if (range.prefix.length > 40) throw new Error("Label prefixes are limited to 40 characters.");
    if (range.style === "none" && !range.prefix)
      throw new Error(`The range starting on page ${range.startPage} needs a prefix or a style.`);
  }
  return sorted;
}

function textValue(value: unknown) {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

function rangeFrom(startIndex: number, dict: PDFDict): PageLabelRange {
  const style = dict.get(PDFName.of("S"));
  const first = dict.get(PDFName.of("St"));
  return {
    startPage: startIndex + 1,
    style:
      (style instanceof PDFName ? STYLES_BY_NAME.get(style.decodeText()) : undefined) ?? "none",
    prefix: textValue(dict.lookup(PDFName.of("P"))),
    firstNumber: first instanceof PDFNumber ? Math.max(1, first.asNumber()) : 1,
  };
}

/** Collects number-tree leaves, following /Kids for trees written by other applications. */
function collect(node: PDFDict, ranges: PageLabelRange[], depth: number) {
  if (depth > 32) return;
  const nums = node.lookup(PDFName.of("Nums"));
  if (nums instanceof PDFArray) {
    for (let index = 0; index + 1 < nums.size(); index += 2) {
      const key = nums.lookup(index);
      const value = nums.lookup(index + 1);
      if (key instanceof PDFNumber && value instanceof PDFDict)
        ranges.push(rangeFrom(key.asNumber(), value));
    }
  }
  const kids = node.lookup(PDFName.of("Kids"));
  if (kids instanceof PDFArray)
    for (let index = 0; index < kids.size(); index++) {
      const kid = kids.lookup(index);
      if (kid instanceof PDFDict) collect(kid, ranges, depth + 1);
    }
}

/** The document's label ranges, or an empty list when pages use plain numbers. */
export function readPageLabels(doc: PDFDocument): PageLabelRange[] {
  const tree = doc.catalog.lookup(PDFName.of("PageLabels"));
  const ranges: PageLabelRange[] = [];
  if (tree instanceof PDFDict) collect(tree, ranges, 0);
  return ranges
    .filter((range) => range.startPage <= doc.getPageCount())
    .sort((a, b) => a.startPage - b.startPage);
}

export async function readPageLabelsFromBytes(pdfBytes: Uint8Array) {
  const doc = await PDFDocument.load(pdfBytes);
  return { ranges: readPageLabels(doc), pageCount: doc.getPageCount() };
}

/** Replaces the document's page labels; an empty list restores plain page numbers. */
export async function setPageLabels(
  pdfBytes: Uint8Array,
  ranges: PageLabelRange[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const sorted = validateRanges(ranges, doc.getPageCount());
  if (!sorted.length) {
    doc.catalog.delete(PDFName.of("PageLabels"));
    return doc.save();
  }
  const nums = sorted.flatMap((range) => [
    range.startPage - 1,
    doc.context.obj({
      ...(range.style === "none" ? {} : { S: PDFName.of(STYLE_NAMES[range.style]) }),
      ...(range.prefix ? { P: pdfText(range.prefix) } : {}),
      ...(range.firstNumber === 1 ? {} : { St: range.firstNumber }),
    }),
  ]);
  doc.catalog.set(PDFName.of("PageLabels"), doc.context.obj({ Nums: nums }));
  return doc.save();
}

// Suggestions for form preparation read from the text layer: blank lines drawn with
// underscores and box characters become field candidates, and the text beside or above a field
// suggests its name. These are proposals for review; nothing is created or renamed until the
// user applies them.

import { PDFDocument } from "pdf-lib";
import { uniqueName } from "../../utils/unique-name";
import { mapInOrder } from "../../utils/async-sequence";
import { allPageNumbers, pagesInOrder } from "../../utils/pdf-pages";
import type { FormFieldDefinition } from "../../services/document-commands";

export interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface TextSource {
  numPages: number;
  getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
}

export interface FieldCandidate {
  page: number;
  kind: "text" | "checkbox";
  /** [x1, y1, x2, y2] in PDF user space. */
  rect: [number, number, number, number];
  name: string;
}

const BOXES = /[☐□▢❑]/u;
const BLANK = /_{5,}/g;
const MAX_CANDIDATES = 1000;

const isItem = (item: unknown): item is TextItem =>
  typeof (item as TextItem)?.str === "string" &&
  Array.isArray((item as TextItem).transform) &&
  typeof (item as TextItem).width === "number";

/** Only unrotated, horizontal text is used; rotated runs give unreliable positions. */
const horizontal = (item: TextItem) =>
  Math.abs(item.transform[1]) < 0.01 && Math.abs(item.transform[2]) < 0.01 && item.transform[0] > 0;

/** Drops trailing colons, asterisks, question marks, full stops and spaces. */
function withoutTrailingPunctuation(text: string) {
  let end = text.length;
  while (end > 0 && ":*?. \t\n\r".includes(text[end - 1])) end--;
  return text.slice(0, end);
}

/** A readable field name from label text: trailing punctuation and extra spaces removed. */
export function nameFromLabel(label: string) {
  const cleaned = withoutTrailingPunctuation(label.replaceAll(/[_☐□▢❑]+/gu, " "))
    .replaceAll(".", " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 40).trim();
}

function unique(name: string, used: Set<string>, fallback: string) {
  const base = name || fallback;
  return uniqueName((copy) => (copy === 1 ? base : `${base} ${copy}`), used);
}

/** Characters' horizontal positions estimated from the item's width. */
function charX(item: TextItem, index: number) {
  return item.transform[4] + (item.width / Math.max(1, item.str.length)) * index;
}

function labelBefore(items: TextItem[], item: TextItem, x: number) {
  const y = item.transform[5];
  const size = Math.abs(item.transform[3]) || item.height || 10;
  const left = items
    .filter(
      (other) =>
        horizontal(other) &&
        Math.abs(other.transform[5] - y) < size * 0.5 &&
        other.transform[4] + other.width <= x + 1 &&
        x - (other.transform[4] + other.width) < 200 &&
        other.str.trim(),
    )
    .sort((a, b) => b.transform[4] - a.transform[4])[0];
  return left?.str ?? "";
}

export function pageCandidates(
  page: number,
  items: TextItem[],
  used: Set<string>,
): FieldCandidate[] {
  const result: FieldCandidate[] = [];
  const usable = items.filter(horizontal);
  for (const item of usable) {
    const size = Math.abs(item.transform[3]) || item.height || 10;
    const baseline = item.transform[5];
    for (const match of item.str.matchAll(BLANK)) {
      const x1 = charX(item, match.index);
      const x2 = charX(item, match.index + match[0].length);
      const label = item.str.slice(0, match.index).trim() || labelBefore(usable, item, x1);
      result.push({
        page,
        kind: "text",
        rect: [x1, baseline - size * 0.15, x2, baseline + size * 1.05],
        name: unique(nameFromLabel(label), used, `Text field ${used.size + 1}`),
      });
    }
    for (const [index, char] of [...item.str].entries()) {
      if (!BOXES.test(char)) continue;
      const x1 = charX(item, index);
      const label = item.str.slice(index + 1).split(/[☐□▢❑]/u)[0];
      result.push({
        page,
        kind: "checkbox",
        rect: [x1, baseline - size * 0.1, x1 + size * 0.9, baseline + size * 0.8],
        name: unique(nameFromLabel(label), used, `Check box ${used.size + 1}`),
      });
    }
  }
  return result;
}

/** Field candidates on every page, skipping places already covered by a field. */
export async function detectFieldCandidates(
  source: TextSource,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<FieldCandidate[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const existing = existingWidgetRects(doc);
  const used = new Set(
    doc
      .getForm()
      .getFields()
      .map((field) => field.getName().toLowerCase()),
  );
  const result: FieldCandidate[] = [];
  for await (const [page, proxy] of pagesInOrder(source, allPageNumbers(source.numPages))) {
    if (signal?.aborted) throw new DOMException("Detection cancelled.", "AbortError");
    const content = await proxy.getTextContent();
    for (const candidate of pageCandidates(page, content.items.filter(isItem), used)) {
      const covered = existing.some(
        (widget) => widget.page === page && overlaps(widget.rect, candidate.rect),
      );
      if (!covered) result.push(candidate);
      if (result.length > MAX_CANDIDATES)
        throw new Error(`More than ${MAX_CANDIDATES.toLocaleString()} possible fields were found.`);
    }
  }
  return result;
}

const overlaps = (a: number[], b: number[]) =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function existingWidgetRects(doc: PDFDocument) {
  const pages = new Map(doc.getPages().map((page, index) => [page.ref.toString(), index + 1]));
  return doc
    .getForm()
    .getFields()
    .flatMap((field) =>
      field.acroField.getWidgets().map((widget) => {
        const r = widget.getRectangle();
        return {
          field: field.getName(),
          page: pages.get(widget.P()?.toString() ?? "") ?? 0,
          rect: [r.x, r.y, r.x + r.width, r.y + r.height],
        };
      }),
    );
}

export function candidateDefinitions(candidates: FieldCandidate[]): FormFieldDefinition[] {
  return candidates.map(({ page, kind, rect, name }) => ({
    type: kind,
    name,
    page,
    x: rect[0],
    y: rect[1],
    width: rect[2] - rect[0],
    height: rect[3] - rect[1],
  }));
}

export interface NameSuggestion {
  field: string;
  suggested: string;
}

/** The nearest text to the left of a widget on its line, or else just above it. */
function nearbyLabel(items: TextItem[], rect: number[]) {
  const [x1, y1, x2, y2] = rect;
  const middle = (y1 + y2) / 2;
  const left = items
    .filter((item) => {
      const size = Math.abs(item.transform[3]) || 10;
      const right = item.transform[4] + item.width;
      return (
        right <= x1 + 2 &&
        x1 - right < 150 &&
        Math.abs(item.transform[5] + size * 0.35 - middle) < Math.max(size, y2 - y1) * 0.6 &&
        item.str.trim() !== ""
      );
    })
    .sort((a, b) => b.transform[4] + b.width - (a.transform[4] + a.width))[0];
  const above = items
    .filter(
      (item) =>
        item.transform[5] > y2 &&
        item.transform[5] - y2 < 24 &&
        item.transform[4] < x2 &&
        item.transform[4] + item.width > x1 - 2 &&
        item.str.trim() !== "",
    )
    .sort((a, b) => a.transform[5] - b.transform[5])[0];
  return (left ?? above)?.str ?? "";
}

/** Labels to the left of, or just above, each field's first widget, as name suggestions. */
export async function suggestFieldNames(source: TextSource, bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const widgets = existingWidgetRects(doc).filter(
    (widget, index, all) =>
      widget.page > 0 && all.findIndex((w) => w.field === widget.field) === index,
  );
  const used = new Set(
    doc
      .getForm()
      .getFields()
      .map((field) => field.getName().toLowerCase()),
  );
  const byPage = new Map<number, TextItem[]>();
  const pageItems = async (page: number) => {
    const content = await source.getPage(page).then((proxy) => proxy.getTextContent());
    return [page, content.items.filter(isItem).filter(horizontal)] as const;
  };
  const pages = new Set(widgets.map((widget) => widget.page));
  for await (const [page, items] of mapInOrder(pages, pageItems)) byPage.set(page, items);
  const suggestions: NameSuggestion[] = [];
  for (const widget of widgets) {
    const label = nameFromLabel(nearbyLabel(byPage.get(widget.page) ?? [], widget.rect));
    if (!label || label.toLowerCase() === widget.field.toLowerCase()) continue;
    used.delete(widget.field.toLowerCase());
    suggestions.push({ field: widget.field, suggested: unique(label, used, widget.field) });
  }
  return suggestions;
}

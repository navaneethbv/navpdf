// Bookmarks proposed from visually prominent lines in the text layer. Lines set noticeably
// larger than the body text become headings, and the largest sizes become the top levels.
// This is a typographic heuristic for review before saving, not a reading of document tags.

import type { EditableBookmark } from "../../services/pdf/bookmarks";
import { allPageNumbers, pagesInOrder } from "../../utils/pdf-pages";

export const MAX_HEADINGS = 2000;
const HEADING_RATIO = 1.15;
const MAX_TITLE = 200;

export interface HeadingCandidate {
  page: number;
  title: string;
  /** Font size in points, rounded to a half point. */
  size: number;
  /** PDF user-space top of the line, or null on rotated pages where a fit view is used. */
  top: number | null;
  level: number;
}

interface TextItem {
  str: string;
  transform: number[];
}

interface HeadingSource {
  numPages: number;
  getPage(page: number): Promise<{
    rotate: number;
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

interface Line {
  page: number;
  text: string;
  size: number;
  baseline: number;
  /** Baseline of the first line, kept when wrapped lines are joined. */
  firstBaseline: number;
  rotated: boolean;
}

const isTextItem = (item: unknown): item is TextItem =>
  typeof (item as Partial<TextItem>)?.str === "string" &&
  Array.isArray((item as Partial<TextItem>).transform);

const roundSize = (value: number) => Math.round(value * 2) / 2;

/** Joins horizontal text items that share a baseline and size into lines. */
function pageLines(page: number, items: TextItem[], rotated: boolean): Line[] {
  const lines: Line[] = [];
  for (const item of items) {
    const [a, b, c, d, , f] = item.transform;
    // Skip vertical or rotated runs; their baselines do not describe reading lines.
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue;
    const size = roundSize(Math.abs(d) || Math.hypot(c, d));
    if (!size) continue;
    const last = lines.at(-1);
    if (last && last.size === size && Math.abs(last.baseline - f) <= size * 0.2) {
      last.text += item.str;
    } else if (item.str.trim()) {
      lines.push({ page, text: item.str, size, baseline: f, firstBaseline: f, rotated });
    }
  }
  return lines.map((line) => ({ ...line, text: line.text.replaceAll(/\s+/g, " ").trim() }));
}

/** The size carrying the most characters is taken as the body text size. */
function bodySize(lines: Line[]) {
  const weight = new Map<number, number>();
  for (const line of lines) weight.set(line.size, (weight.get(line.size) ?? 0) + line.text.length);
  let best = 0;
  let most = -1;
  for (const [size, count] of weight)
    if (count > most || (count === most && size < best)) [best, most] = [size, count];
  return best;
}

const looksLikeHeading = (text: string) =>
  text.length >= 2 && text.length <= MAX_TITLE && /\p{L}/u.test(text);

/**
 * Proposes headings from the text layer of every page, nested up to `maxLevels` deep.
 * Consecutive heading lines of the same size are joined as one wrapped heading.
 */
export async function detectHeadings(
  source: HeadingSource,
  maxLevels: number,
  options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {},
): Promise<HeadingCandidate[]> {
  if (!Number.isInteger(maxLevels) || maxLevels < 1 || maxLevels > 6)
    throw new Error("Choose one to six heading levels.");
  const lines: Line[] = [];
  for await (const [page, proxy] of pagesInOrder(source, allPageNumbers(source.numPages))) {
    if (options.signal?.aborted) throw new DOMException("Detection cancelled.", "AbortError");
    const content = await proxy.getTextContent();
    lines.push(...pageLines(page, content.items.filter(isTextItem), proxy.rotate % 360 !== 0));
    options.onProgress?.(page, source.numPages);
  }
  const body = bodySize(lines);
  if (!body) return [];
  const merged: Line[] = [];
  for (const line of lines) {
    if (line.size < body * HEADING_RATIO) continue;
    const last = merged.at(-1);
    if (
      last &&
      last.page === line.page &&
      last.size === line.size &&
      last.baseline - line.baseline > 0 &&
      last.baseline - line.baseline <= line.size * 1.6
    ) {
      last.text = `${last.text} ${line.text}`;
      last.baseline = line.baseline;
      continue;
    }
    merged.push({ ...line });
  }
  const headings = merged.filter((line) => looksLikeHeading(line.text));
  const sizes = [...new Set(headings.map((line) => line.size))].sort((a, b) => b - a);
  const levels = new Map(sizes.slice(0, maxLevels).map((size, index) => [size, index + 1]));
  const result: HeadingCandidate[] = [];
  for (const line of headings) {
    const level = levels.get(line.size);
    if (!level) continue;
    if (result.length >= MAX_HEADINGS)
      throw new Error(`More than ${MAX_HEADINGS.toLocaleString()} headings were found.`);
    result.push({
      page: line.page,
      title: line.text,
      size: line.size,
      top: line.rotated ? null : Math.round((line.firstBaseline + line.size * 1.2) * 100) / 100,
      level,
    });
  }
  return result;
}

/** Nests headings so each one sits under the closest earlier heading of a higher level. */
export function headingBookmarks(headings: HeadingCandidate[]): EditableBookmark[] {
  const roots: EditableBookmark[] = [];
  const stack: { level: number; node: EditableBookmark }[] = [];
  headings.forEach((heading, index) => {
    const node: EditableBookmark = {
      id: `heading-${index}`,
      title: heading.title,
      page: heading.page - 1,
      view: heading.top === null ? ["Fit"] : ["XYZ", null, heading.top, null],
      children: [],
    };
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
    (stack.at(-1)?.node.children ?? roots).push(node);
    stack.push({ level: heading.level, node });
  });
  return roots;
}

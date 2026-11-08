// Bookmarks from text styles, for documents whose headings are not tagged: every line set in a
// chosen style (font, size, bold and italic) becomes a bookmark of the level that style was
// given, nested under the nearest earlier bookmark of a higher level.

import type { EditableBookmark } from "../../services/pdf/bookmarks";
import {
  displayFontName,
  nearestStandardStyle,
  resolveFont,
  type FontDescription,
} from "../../services/pdf/text-styles";
import { allPageNumbers, pagesInOrder } from "../../utils/pdf-pages";

export const MAX_STYLE_LEVELS = 4;
export const MAX_STYLE_BOOKMARKS = 5000;
const MAX_LINES = 200_000;
const MAX_TITLE = 200;
const SAMPLE_LENGTH = 40;

/** A text style found in the document, with how many lines use it. */
export interface DocumentTextStyle {
  key: string;
  fontName: string;
  /** Size in points as shown, rounded to a half point. */
  size: number;
  bold: boolean;
  italic: boolean;
  lines: number;
  sample: string;
}

/** A line of text in one style, in reading order. */
export interface StyledLine {
  page: number;
  key: string;
  text: string;
  /** Top of the line in PDF user space, or null on turned pages where a fit view is used. */
  top: number | null;
  baseline: number;
  size: number;
}

interface TextItem {
  str: string;
  transform: number[];
  fontName?: string;
}

interface StylePage {
  rotate: number;
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  commonObjs: { get(id: string, callback: (data: unknown) => void): void };
}

interface StyleSource {
  numPages: number;
  getPage(page: number): Promise<StylePage>;
}

const isTextItem = (item: unknown): item is TextItem =>
  typeof (item as Partial<TextItem>)?.str === "string" &&
  Array.isArray((item as Partial<TextItem>).transform);

const roundSize = (value: number) => Math.round(value * 2) / 2;

/** The style key and label of a font at a size. */
function styleOf(font: FontDescription | null, fallback: string, size: number) {
  const nearest = nearestStandardStyle(font ?? {});
  const fontName = displayFontName(font?.name) || fallback;
  return {
    key: [fontName, size, nearest.bold, nearest.italic].join("|"),
    fontName,
    bold: nearest.bold,
    italic: nearest.italic,
  };
}

function horizontalText(items: unknown[]) {
  return items.filter(isTextItem).flatMap(({ str, transform, fontName }) => {
    const [a, b, c, d, , baseline] = transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) return [];
    const size = roundSize(Math.abs(d) || Math.hypot(c, d));
    return size ? [{ text: str, baseline, size, fontId: fontName ?? "" }] : [];
  });
}

async function collectPageLines(
  page: number,
  proxy: StylePage,
  styles: Map<string, DocumentTextStyle>,
  lines: StyledLine[],
) {
  // Reading the operator list loads the page's fonts so their names can be resolved.
  await proxy.getOperatorList();
  const items = horizontalText((await proxy.getTextContent()).items);
  const ids = new Set(items.map((item) => item.fontId).filter(Boolean));
  const fonts = new Map(
    await Promise.all([...ids].map(async (id) => [id, await resolveFont(proxy, id)] as const)),
  );
  const rotated = proxy.rotate % 360 !== 0;
  let last: StyledLine | undefined;
  for (const { text, baseline, size, fontId } of items) {
    const style = styleOf(fonts.get(fontId) ?? null, fontId || "Unnamed font", size);
    if (last?.key === style.key && Math.abs(last.baseline - baseline) <= size * 0.2) {
      last.text += text;
      continue;
    }
    if (!text.trim()) continue;
    if (lines.length >= MAX_LINES) throw new Error("The document has too many lines to read.");
    last = {
      page,
      key: style.key,
      text,
      top: rotated ? null : Math.round((baseline + size * 1.2) * 100) / 100,
      baseline,
      size,
    };
    lines.push(last);
    const entry = styles.get(style.key);
    if (entry) entry.lines++;
    else styles.set(style.key, { ...style, size, lines: 1, sample: "" });
  }
}

/**
 * Lists the document's text styles, largest first, and its lines in each style. Fonts are read
 * from each page's operator list, so this reads every page once.
 */
export async function scanTextStyles(
  source: StyleSource,
  options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {},
): Promise<{ styles: DocumentTextStyle[]; lines: StyledLine[] }> {
  const styles = new Map<string, DocumentTextStyle>();
  const lines: StyledLine[] = [];
  for await (const [page, proxy] of pagesInOrder(source, allPageNumbers(source.numPages))) {
    if (options.signal?.aborted) throw new DOMException("Reading cancelled.", "AbortError");
    await collectPageLines(page, proxy, styles, lines);
    options.onProgress?.(page, source.numPages);
  }
  for (const line of lines) {
    line.text = line.text.replaceAll(/\s+/g, " ").trim();
    const style = styles.get(line.key)!;
    if (style.sample.length < SAMPLE_LENGTH)
      style.sample = `${style.sample} ${line.text}`.trim().slice(0, SAMPLE_LENGTH);
  }
  const sorted = [...styles.values()].sort(
    (a, b) => b.size - a.size || Number(b.bold) - Number(a.bold) || b.lines - a.lines,
  );
  return { styles: sorted, lines };
}

/**
 * Bookmarks from the lines in the chosen styles; `levels[0]` is the style of level 1. Lines in a
 * style that follow each other closely on a page are one wrapped heading.
 */
export function styleBookmarks(lines: StyledLine[], levels: string[]): EditableBookmark[] {
  if (levels.length > MAX_STYLE_LEVELS * 2 + 1) throw new Error("Choose at most nine levels.");
  const levelOf = new Map(levels.map((key, index) => [key, index + 1]));
  if (levelOf.size !== levels.length) throw new Error("Choose a different style for each level.");
  const roots: EditableBookmark[] = [];
  const stack: { level: number; node: EditableBookmark; line: StyledLine }[] = [];
  let count = 0;
  for (const line of lines) {
    const level = levelOf.get(line.key);
    if (!level || !/\p{L}|\p{N}/u.test(line.text)) continue;
    const previous = stack.at(-1);
    if (
      previous?.line.key === line.key &&
      previous.line.page === line.page &&
      previous.line.baseline - line.baseline > 0 &&
      previous.line.baseline - line.baseline <= line.size * 1.6 &&
      previous.node.children.length === 0
    ) {
      previous.node.title = `${previous.node.title} ${line.text}`.slice(0, MAX_TITLE);
      previous.line = line;
      continue;
    }
    if (++count > MAX_STYLE_BOOKMARKS)
      throw new Error(`More than ${MAX_STYLE_BOOKMARKS.toLocaleString()} lines use these styles.`);
    const node: EditableBookmark = {
      id: `style-${count}`,
      title: line.text.slice(0, MAX_TITLE),
      page: line.page - 1,
      view: line.top === null ? ["Fit"] : ["XYZ", null, line.top, null],
      children: [],
    };
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    (stack.at(-1)?.node.children ?? roots).push(node);
    stack.push({ level, node, line });
  }
  return roots;
}

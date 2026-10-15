import { mapInOrder } from "../../utils/async-sequence";
import { csvField } from "../convert/formats";

export interface InsightsSource {
  numPages: number;
  getPage(page: number): Promise<{
    rotate: number;
    getViewport(options: { scale: number }): { width: number; height: number };
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

export interface PageInsight {
  page: number;
  words: number | null;
  characters: number | null;
  textStatus: "text" | "textless" | "unavailable";
  width: number | null;
  height: number | null;
  rotation: number | null;
  orientation: "Portrait" | "Landscape" | "Square" | null;
}

export interface DocumentInsights {
  pages: PageInsight[];
  words: number;
  characters: number;
  textlessPages: number[];
  failedPages: number[];
}

export interface InspectionOptions {
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (completed: number, total: number) => void;
}

function checkCancellation(options: InspectionOptions) {
  if (options.signal?.aborted || options.isCancelled?.()) {
    throw new DOMException("Inspection cancelled.", "AbortError");
  }
}

/** Count text-layer tokens only. Never retain page text in the resulting report. */
function countText(items: unknown[]) {
  let words = 0;
  let characters = 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string")
      continue;
    let inWord = false;
    for (const character of item.str) {
      if (/\s/u.test(character)) {
        inWord = false;
      } else {
        characters++;
        if (!inWord) words++;
        inWord = true;
      }
    }
  }
  return { words, characters };
}

async function inspectPage(
  pdf: InsightsSource,
  index: number,
  options: InspectionOptions,
): Promise<PageInsight> {
  checkCancellation(options);
  const entry: PageInsight = {
    page: index + 1,
    words: null,
    characters: null,
    textStatus: "unavailable",
    width: null,
    height: null,
    rotation: null,
    orientation: null,
  };
  try {
    const page = await pdf.getPage(entry.page);
    checkCancellation(options);
    const { width, height } = page.getViewport({ scale: 1 });
    if (
      ![width, height].every((value) => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(page.rotate)
    ) {
      throw new Error("Invalid page dimensions.");
    }
    entry.width = width;
    entry.height = height;
    entry.rotation = ((page.rotate % 360) + 360) % 360;
    if (width === height) entry.orientation = "Square";
    else entry.orientation = width > height ? "Landscape" : "Portrait";
    const content = await page.getTextContent();
    checkCancellation(options);
    const counts = countText(content.items);
    entry.words = counts.words;
    entry.characters = counts.characters;
    entry.textStatus = counts.characters > 0 ? "text" : "textless";
  } catch {
    checkCancellation(options);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return entry;
}

/** Inspect a validated zero-based selection sequentially, yielding to the UI after each page. */
export async function inspectDocument(
  pdf: InsightsSource,
  pageIndices: readonly number[],
  options: InspectionOptions = {},
): Promise<DocumentInsights> {
  if (
    pageIndices.length === 0 ||
    new Set(pageIndices).size !== pageIndices.length ||
    pageIndices.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= pdf.numPages)
  ) {
    throw new Error("Invalid page selection.");
  }
  const result: DocumentInsights = {
    pages: [],
    words: 0,
    characters: 0,
    textlessPages: [],
    failedPages: [],
  };
  for await (const entry of mapInOrder(pageIndices, (index) => inspectPage(pdf, index, options))) {
    result.words += entry.words ?? 0;
    result.characters += entry.characters ?? 0;
    if (entry.textStatus === "textless") result.textlessPages.push(entry.page);
    if (entry.textStatus === "unavailable") result.failedPages.push(entry.page);
    result.pages.push(entry);
    options.onProgress?.(result.pages.length, pageIndices.length);
  }
  checkCancellation(options);
  return result;
}

export const TEXT_STATUS_LABELS = {
  text: "Text present",
  textless: "Textless",
  unavailable: "Unavailable",
} as const;

export function insightsCsv(insights: DocumentInsights): string {
  const header = [
    "Page",
    "Words",
    "Characters (excluding whitespace)",
    "Text layer",
    "Width (pt)",
    "Height (pt)",
    "Rotation (degrees)",
    "Orientation",
  ];
  const rows = insights.pages.map((page) => [
    page.page,
    page.words,
    page.characters,
    TEXT_STATUS_LABELS[page.textStatus],
    page.width,
    page.height,
    page.rotation,
    page.orientation,
  ]);
  return (
    "\ufeff" +
    [header, ...rows]
      .map((row) => row.map((value) => csvField(value === null ? "" : String(value))).join(","))
      .join("\r\n") +
    "\r\n"
  );
}

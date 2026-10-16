import { allPageNumbers, pagesInOrder } from "../../utils/pdf-pages";
import { rangeRects, type TextItemLike } from "../redact/redaction-marks";
import { findUrls, MAX_NEW_LINKS, type FoundUrl } from "../../services/pdf/link-tools";

interface TextSource {
  numPages: number;
  getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
}

const isTextItem = (item: unknown): item is TextItemLike =>
  typeof (item as Partial<TextItemLike>)?.str === "string" &&
  Array.isArray((item as Partial<TextItemLike>).transform) &&
  typeof (item as Partial<TextItemLike>).width === "number";

function checkLinkLimit(count: number) {
  if (count > MAX_NEW_LINKS)
    throw new Error(`More than ${MAX_NEW_LINKS.toLocaleString()} web addresses were found.`);
}

/**
 * Web addresses written in the text layer, with estimated rectangles. Addresses split across
 * separate text items or lines are not joined, and scanned pages need OCR first.
 */
export async function findUrlLinks(source: TextSource, signal?: AbortSignal): Promise<FoundUrl[]> {
  const result: FoundUrl[] = [];
  for await (const [page, proxy] of pagesInOrder(source, allPageNumbers(source.numPages))) {
    if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    const content = await proxy.getTextContent();
    for (const item of content.items.filter(isTextItem)) {
      for (const match of findUrls(item.str)) {
        const [rect] = rangeRects([item], () => [[match.start, match.end]]);
        if (rect) result.push({ page, rect, url: match.url });
        checkLinkLimit(result.length);
      }
    }
  }
  return result;
}

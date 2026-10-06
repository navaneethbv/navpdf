// The PDF.js page surface the export dialogs use, and text-layer reading shared between them.

import { layoutPage, type PageLayout, type TextItem } from "./ooxml";

export interface PageProxy {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
    promise: Promise<void>;
  };
}

/** PDF.js also yields marked-content entries without text geometry; those are skipped. */
export function isTextItem(item: unknown): item is TextItem {
  const candidate = item as Partial<TextItem>;
  return (
    typeof candidate?.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number"
  );
}

/** Reads a page's text layer into reading-order lines, cells and paragraphs. */
export async function readPageLayout(page: PageProxy, number: number): Promise<PageLayout> {
  const { width, height } = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return layoutPage(
    number,
    content.items.filter((item): item is TextItem => isTextItem(item)),
    width,
    height,
  );
}

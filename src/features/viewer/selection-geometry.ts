import type { TextMarkupQuad } from "../../services/document-commands";

export interface SelectionViewport {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): [number, number];
}

export interface SelectedTextGeometry {
  page: number;
  quads: TextMarkupQuad[];
  text: string;
}

const intersection = (
  a: DOMRect,
  b: DOMRect,
): { left: number; top: number; right: number; bottom: number } | null => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right - left > 1 && bottom - top > 1
    ? { left, top, right, bottom }
    : null;
};

/**
 * Convert the browser's current text selection into PDF-point quads.
 * Page DOM bounds are used only for scale conversion, while the PDF.js
 * viewport handles rotation and the PDF coordinate origin.
 */
export async function readTextSelectionGeometry(
  root: HTMLElement,
  resolveViewport: (page: number) => Promise<SelectionViewport>,
): Promise<SelectedTextGeometry[]> {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return [];
  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects());
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>(".page[data-page-number]"),
  );
  const byPage = new Map<number, TextMarkupQuad[]>();
  for (const rect of rects.slice(0, 1000)) {
    for (const page of pages) {
      const pageNumber = Number(page.dataset.pageNumber);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
      const clipped = intersection(rect, page.getBoundingClientRect());
      if (!clipped) continue;
      const viewport = await resolveViewport(pageNumber);
      const pageRect = page.getBoundingClientRect();
      const scaleX = viewport.width / pageRect.width;
      const scaleY = viewport.height / pageRect.height;
      const topLeft = viewport.convertToPdfPoint(
        (clipped.left - pageRect.left) * scaleX,
        (clipped.top - pageRect.top) * scaleY,
      );
      const bottomRight = viewport.convertToPdfPoint(
        (clipped.right - pageRect.left) * scaleX,
        (clipped.bottom - pageRect.top) * scaleY,
      );
      const quad: TextMarkupQuad = {
        x1: Math.min(topLeft[0], bottomRight[0]),
        y1: Math.min(topLeft[1], bottomRight[1]),
        x2: Math.max(topLeft[0], bottomRight[0]),
        y2: Math.max(topLeft[1], bottomRight[1]),
      };
      const pageQuads = byPage.get(pageNumber) ?? [];
      pageQuads.push(quad);
      byPage.set(pageNumber, pageQuads);
      break;
    }
  }
  const text = range.toString().trim();
  return [...byPage.entries()].map(([page, quads]) => ({
    page,
    quads,
    text,
  }));
}

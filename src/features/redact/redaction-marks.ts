import type { PageViewport } from "pdfjs-dist";
import type { PdfRect, RedactionRegion } from "../../types/engine";

export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}

/** Measures text in any consistent unit; only width ratios within one text item are used. */
export type MeasureText = (text: string, item: TextItemLike) => number;

interface TextSource {
  numPages: number;
  getPage(page: number): Promise<{
    getTextContent(): Promise<{
      items: unknown[];
      styles?: Record<string, { fontFamily?: string }>;
    }>;
  }>;
}

export interface ViewerLike {
  getPageView(index: number):
    | {
        div: HTMLElement;
        viewport: Pick<PageViewport, "convertToViewportPoint" | "convertToPdfPoint">;
      }
    | undefined;
}

export interface PageBox {
  page: number;
  rect: PdfRect;
  className: string;
}

/** Draws boxes inside rendered page elements and returns a function that removes them. */
export function placePageBoxes(viewer: ViewerLike | null | undefined, boxes: PageBox[]) {
  const elements: HTMLElement[] = [];
  for (const box of boxes) {
    const view = viewer?.getPageView(box.page - 1);
    if (!view?.div) continue;
    // Page rotations are multiples of 90 degrees, so two opposite corners bound the box.
    const [x0, y0] = view.viewport.convertToViewportPoint(box.rect[0], box.rect[1]);
    const [x1, y1] = view.viewport.convertToViewportPoint(box.rect[2], box.rect[3]);
    const element = document.createElement("div");
    element.className = box.className;
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, {
      left: `${Math.min(x0, x1)}px`,
      top: `${Math.min(y0, y1)}px`,
      width: `${Math.abs(x1 - x0)}px`,
      height: `${Math.abs(y1 - y0)}px`,
    });
    view.div.appendChild(element);
    elements.push(element);
  }
  return () => elements.forEach((element) => element.remove());
}

/** Converts two points in a page element's CSS pixels to a PDF user-space rectangle. */
export function viewportToPdfRect(
  viewer: ViewerLike | null | undefined,
  page: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): PdfRect | null {
  const view = viewer?.getPageView(page - 1);
  if (!view) return null;
  const [ax, ay] = view.viewport.convertToPdfPoint(a.x, a.y);
  const [bx, by] = view.viewport.convertToPdfPoint(b.x, b.y);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** Share of one average character added before and after a match. */
const CHARACTER_PADDING = 0.35;

function isTextItem(item: unknown): item is TextItemLike {
  const candidate = item as Partial<TextItemLike>;
  return (
    typeof candidate?.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number"
  );
}

/**
 * PDF user-space rectangles for each case-insensitive occurrence of `term` inside text
 * items. Character positions are proportional estimates, so each rectangle is padded;
 * the native audit still blocks redaction if any occurrence survives elsewhere.
 */
export function termRects(items: TextItemLike[], term: string, measure?: MeasureText): PdfRect[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const rects: PdfRect[] = [];
  for (const item of items) {
    const text = item.str.toLowerCase();
    const length = item.str.length;
    if (!length || item.width <= 0) continue;
    const [a, b, c, d, e, f] = item.transform;
    const scale = Math.hypot(a, b) || 1;
    const [ux, uy] = [a / scale, b / scale];
    const height = Math.hypot(c, d) || item.height || 10;
    const advance = item.width / length;
    // Measured prefixes place proportional glyphs; lowercasing that changes length cannot be mapped.
    const whole = measure && text.length === length ? measure(item.str, item) : 0;
    const offset = (count: number) =>
      whole > 0 ? (measure!(item.str.slice(0, count), item) / whole) * item.width : count * advance;
    for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) {
      const start = offset(index) - CHARACTER_PADDING * advance;
      const end = offset(index + needle.length) + CHARACTER_PADDING * advance;
      // Up is perpendicular to the baseline direction, so rotated text is covered too.
      const [vx, vy] = [-uy, ux];
      const corners = [
        [start, -0.3 * height],
        [end, -0.3 * height],
        [start, 1.1 * height],
        [end, 1.1 * height],
      ].map(([along, up]) => [e + ux * along + vx * up, f + uy * along + vy * up]);
      const xs = corners.map((point) => point[0]);
      const ys = corners.map((point) => point[1]);
      rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  return rects;
}

/** Canvas text measurement in each item's substituted font family, when a 2D canvas exists. */
function canvasMeasure(styles: Record<string, { fontFamily?: string }> = {}): MeasureText | undefined {
  const context = createMeasuringContext();
  if (!context || typeof context.measureText !== "function") return undefined;
  return (text, item) => {
    context.font = `100px ${styles[item.fontName ?? ""]?.fontFamily || "sans-serif"}`;
    return context.measureText(text).width;
  };
}

function createMeasuringContext(): CanvasRenderingContext2D | null {
  try {
    return typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  } catch {
    // Test DOMs without canvas support fall back to average character widths.
    return null;
  }
}

export async function findTermMarks(
  pdf: TextSource,
  term: string,
  signal?: AbortSignal,
): Promise<RedactionRegion[]> {
  const marks: RedactionRegion[] = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    if (signal?.aborted) break;
    const content = await (await pdf.getPage(page)).getTextContent();
    const measure = canvasMeasure(content.styles);
    for (const rect of termRects(content.items.filter(isTextItem), term, measure)) {
      marks.push({ page, rect });
    }
  }
  return marks;
}

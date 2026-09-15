export interface ViewportLike {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): [number, number];
  convertToViewportPoint(x: number, y: number): [number, number];
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomPoint {
  x: number;
  y: number;
}

/**
 * Convert DOM client coordinates (e.g. from mouse/pointer events)
 * to PDF points using the page element's bounding rect and PDF.js viewport.
 */
export function convertToPdfCoords(
  clientX: number,
  clientY: number,
  pageElement: HTMLElement,
  viewport: ViewportLike,
): [number, number] {
  const rect = pageElement.getBoundingClientRect();
  const scaleX = viewport.width / rect.width;
  const scaleY = viewport.height / rect.height;
  const vpX = (clientX - rect.left) * scaleX;
  const vpY = (clientY - rect.top) * scaleY;
  const [pdfX, pdfY] = viewport.convertToPdfPoint(vpX, vpY);
  return [pdfX, pdfY];
}

/**
 * Convert PDF points back to DOM pixel coordinates relative to the page element.
 */
export function convertToDomCoords(
  pdfX: number,
  pdfY: number,
  pageElement: HTMLElement,
  viewport: ViewportLike,
): DomPoint {
  const [vpX, vpY] = viewport.convertToViewportPoint(pdfX, pdfY);
  const rect = pageElement.getBoundingClientRect();
  const domX = (vpX / viewport.width) * rect.width;
  const domY = (vpY / viewport.height) * rect.height;
  return { x: domX, y: domY };
}

/**
 * Nudge a point by a given step (1pt or 10pt with shift) in PDF point coordinates.
 */
export function nudgePoint(
  x: number,
  y: number,
  direction: "left" | "right" | "up" | "down",
  step = 1,
): [number, number] {
  switch (direction) {
    case "left":
      return [x - step, y];
    case "right":
      return [x + step, y];
    case "up":
      return [x, y + step];
    case "down":
      return [x, y - step];
  }
}

/**
 * Clamp a rectangle so it stays fully inside the visible page boundaries.
 */
export function clampRectToPage(rect: PdfRect, pageWidth: number, pageHeight: number): PdfRect {
  const width = Math.min(Math.max(1, rect.width), pageWidth);
  const height = Math.min(Math.max(1, rect.height), pageHeight);
  const x = Math.min(Math.max(0, rect.x), pageWidth - width);
  const y = Math.min(Math.max(0, rect.y), pageHeight - height);
  return { x, y, width, height };
}

/**
 * Calculate scaled dimensions preserving aspect ratio within bounding limits.
 */
export function calculateAspectPreservedDimensions(
  origWidth: number,
  origHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (origWidth <= 0 || origHeight <= 0) {
    return { width: Math.max(1, maxWidth), height: Math.max(1, maxHeight) };
  }
  const scale = Math.min(maxWidth / origWidth, maxHeight / origHeight, 1);
  return {
    width: Math.round(origWidth * scale * 100) / 100,
    height: Math.round(origHeight * scale * 100) / 100,
  };
}

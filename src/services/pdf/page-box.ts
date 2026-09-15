import type { PDFPage } from "pdf-lib";

export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface UserSpaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes the visible bounding box of a page by intersecting its MediaBox and CropBox,
 * and normalizing the page rotation to 0, 90, 180, or 270 degrees clockwise.
 */
export function visibleBox(page: PDFPage): PageBox {
  const mb = page.getMediaBox();
  const cb = page.getCropBox();

  const x0 = Math.max(mb.x, cb.x);
  const y0 = Math.max(mb.y, cb.y);
  const x1 = Math.min(mb.x + mb.width, cb.x + cb.width);
  const y1 = Math.min(mb.y + mb.height, cb.y + cb.height);

  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const angle = page.getRotation().angle;
  const rotation = (((angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;

  return { x: x0, y: y0, width, height, rotation };
}

/**
 * Clamps a user-space rectangle [x1, y1, x2, y2] so that it remains within the given box.
 * Returns [minX, minY, maxX, maxY].
 */
export function clampRectToBox(
  rect: [number, number, number, number],
  box: { x: number; y: number; width: number; height: number },
): [number, number, number, number] {
  const [x1, y1, x2, y2] = rect;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const clampedMinX = Math.max(box.x, Math.min(box.x + box.width, minX));
  const clampedMaxX = Math.max(box.x, Math.min(box.x + box.width, maxX));
  const clampedMinY = Math.max(box.y, Math.min(box.y + box.height, minY));
  const clampedMaxY = Math.max(box.y, Math.min(box.y + box.height, maxY));

  return [clampedMinX, clampedMinY, clampedMaxX, clampedMaxY];
}

/**
 * Maps a rectangle expressed in displayed (visual) coordinates with origin at top-left
 * into PDF user-space coordinates, correctly accounting for rotation and offset page boxes.
 */
export function fromTopLeftVisual(
  page: PDFPage,
  xVisual: number,
  yVisual: number,
  w: number,
  h: number,
): UserSpaceRect {
  const box = visibleBox(page);
  const visualWidth = box.rotation === 90 || box.rotation === 270 ? box.height : box.width;
  const visualHeight = box.rotation === 90 || box.rotation === 270 ? box.width : box.height;

  const clampedW = Math.min(Math.max(0, w), visualWidth);
  const clampedH = Math.min(Math.max(0, h), visualHeight);
  const clampedX = Math.max(0, Math.min(visualWidth - clampedW, xVisual));
  const clampedY = Math.max(0, Math.min(visualHeight - clampedH, yVisual));

  switch (box.rotation) {
    case 0:
      return {
        x: box.x + clampedX,
        y: box.y + box.height - clampedY - clampedH,
        width: clampedW,
        height: clampedH,
      };
    case 90:
      return {
        x: box.x + clampedY,
        y: box.y + clampedX,
        width: clampedH,
        height: clampedW,
      };
    case 180:
      return {
        x: box.x + box.width - clampedX - clampedW,
        y: box.y + clampedY,
        width: clampedW,
        height: clampedH,
      };
    case 270:
      return {
        x: box.x + box.width - clampedY - clampedH,
        y: box.y + box.height - clampedX - clampedW,
        width: clampedH,
        height: clampedW,
      };
  }
}

// Pure geometry for viewer tools: inked page bounds for Fit Visible, rectangular column
// selection, page size labels and finding the image under a point.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The bounding box of pixels that are not near-white in RGBA `pixels`, or null for a blank
 * page. Transparent pixels count as blank.
 */
export function inkedBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 245,
): Box | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const inked =
        pixels[offset + 3] > 0 &&
        (pixels[offset] < threshold ||
          pixels[offset + 1] < threshold ||
          pixels[offset + 2] < threshold);
      if (!inked) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

export interface TextSpan {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Text inside a rectangle, line by line. A character counts when the centre of its share of the
 * span's width falls inside the rectangle, so spans that cross the rectangle are cut, assuming
 * evenly wide characters.
 */
export function columnText(spans: TextSpan[], rect: Box) {
  const pieces = spans.flatMap((span) => {
    const middle = span.top + span.height / 2;
    if (middle < rect.top || middle > rect.bottom || !span.text) return [];
    const characters = [...span.text];
    const step = span.width / characters.length;
    const kept = characters
      .filter((_, index) => {
        const centre = span.left + (index + 0.5) * step;
        return centre >= rect.left && centre <= rect.right;
      })
      .join("");
    return kept.trim() ? [{ text: kept, left: span.left, middle, height: span.height }] : [];
  });
  pieces.sort((a, b) => a.middle - b.middle || a.left - b.left);
  const lines: (typeof pieces)[] = [];
  for (const piece of pieces) {
    const line = lines.at(-1);
    const first = line?.[0];
    if (line && first && Math.abs(piece.middle - first.middle) < Math.max(first.height, 1) / 2)
      line.push(piece);
    else lines.push([piece]);
  }
  for (const line of lines) line.sort((a, b) => a.left - b.left);
  return lines.map((line) => line.map((piece) => piece.text.trim()).join(" ")).join("\n");
}

const inches = (points: number) => Number((points / 72).toFixed(2));
const millimetres = (points: number) => Number(((points / 72) * 25.4).toFixed(1));

/** "8.5 × 11 in (215.9 × 279.4 mm)" for a page's displayed size after /Rotate and /UserUnit. */
export function pageSizeLabel(view: number[], rotate: number, userUnit = 1) {
  const [x1, y1, x2, y2] = view;
  let width = Math.abs(x2 - x1) * userUnit;
  let height = Math.abs(y2 - y1) * userUnit;
  if (Math.abs(rotate) % 180 === 90) [width, height] = [height, width];
  return `${inches(width)} × ${inches(height)} in (${millimetres(width)} × ${millimetres(height)} mm)`;
}

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The bounds in page space of the unit square under `matrix`. */
function unitSquareBounds(matrix: Matrix): Box {
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([x, y]) => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ]);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** The PDF.js operator codes this module reads. */
export interface ImageOps {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
}

export interface PageImage {
  /** PDF.js object id of the decoded image. */
  id: string;
  /** Bounds in PDF user space; `top` is the lower y value. */
  bounds: Box;
}

/** Every image XObject drawn by an operator list, in painting order, with its page bounds. */
export function pageImages(fnArray: number[], argsArray: unknown[][], ops: ImageOps) {
  const images: PageImage[] = [];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (const [index, fn] of fnArray.entries()) {
    const args = argsArray[index] ?? [];
    if (fn === ops.save || fn === ops.paintFormXObjectBegin) {
      stack.push(matrix);
      const form = args[0];
      if (fn === ops.paintFormXObjectBegin && Array.isArray(form) && form.length === 6)
        matrix = multiply(matrix, form as Matrix);
    } else if (fn === ops.restore || fn === ops.paintFormXObjectEnd) {
      matrix = stack.pop() ?? matrix;
    } else if (fn === ops.transform) {
      matrix = multiply(matrix, args as Matrix);
    } else if (fn === ops.paintImageXObject && typeof args[0] === "string") {
      images.push({ id: args[0], bounds: unitSquareBounds(matrix) });
    }
  }
  return images;
}

/** The topmost image containing a point in PDF user space. */
export function imageAt(images: PageImage[], x: number, y: number) {
  return [...images]
    .reverse()
    .find(
      ({ bounds }) =>
        x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom,
    );
}

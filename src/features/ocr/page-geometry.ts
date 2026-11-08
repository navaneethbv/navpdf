// Straightening and turning a scanned page's image before recognition. Both work on a small
// grayscale copy, are conservative (a blank, tiny or ambiguous page is left as it is), and come
// with the exact transform that maps recognised word boxes back onto the page as rendered.

import type { OcrLine, OcrPageResult, OcrWord } from "../../types/operations";

/** The largest skew corrected, in degrees. */
export const MAX_SKEW = 5;
const MIN_SIDE = 64;
const MIN_INK = 0.002;
const ANALYSIS_SIDE = 1000;

export type QuarterTurn = 0 | 90 | 180 | 270;

/** A grayscale copy for analysis: 0 is black, 255 white. */
export interface Gray {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Luminance of RGBA pixels, downscaled so the longer side is at most `maxSide`. */
export function grayOf(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  maxSide = ANALYSIS_SIDE,
): Gray {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const i = (sy * width + sx) * 4;
      pixels[y * w + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  return { width: w, height: h, pixels };
}

function inkOf(gray: Gray) {
  const ink = new Uint8Array(gray.pixels.length);
  let count = 0;
  for (let i = 0; i < ink.length; i++)
    if (gray.pixels[i] < 128) {
      ink[i] = 1;
      count++;
    }
  return { ink, count };
}

/** Sharpness of the horizontal ink profile after shearing rows by `slope` (pixels per pixel). */
function profileScore(ink: Uint8Array, width: number, height: number, slope: number) {
  const offset = Math.ceil(Math.abs(slope) * width) + 1;
  const rows = new Float64Array(height + 2 * offset);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (ink[y * width + x]) rows[Math.round(y - x * slope) + offset]++;
  let score = 0;
  for (let i = 1; i < rows.length; i++) score += (rows[i] - rows[i - 1]) ** 2;
  return score;
}

/**
 * The page's skew in degrees: positive when text lines rise to the right on screen. Zero when
 * the page is blank, too small, skewed less than 0.1 degrees or without a clear best angle.
 */
export function estimateSkew(gray: Gray): number {
  if (gray.width < MIN_SIDE || gray.height < MIN_SIDE) return 0;
  const { ink, count } = inkOf(gray);
  if (count < gray.pixels.length * MIN_INK) return 0;
  const score = (degrees: number) =>
    profileScore(ink, gray.width, gray.height, -Math.tan((degrees * Math.PI) / 180));
  let best = 0;
  let bestScore = score(0);
  const level = bestScore;
  for (let degrees = -MAX_SKEW; degrees <= MAX_SKEW + 1e-9; degrees += 0.5) {
    const value = score(degrees);
    if (value > bestScore) [best, bestScore] = [degrees, value];
  }
  for (let degrees = best - 0.4; degrees <= best + 0.4 + 1e-9; degrees += 0.1) {
    const value = score(degrees);
    if (value > bestScore) [best, bestScore] = [degrees, value];
  }
  // A winner barely better than leaving the page alone is noise, not skew.
  if (Math.abs(best) < 0.1 || bestScore < level * 1.05) return 0;
  return Math.round(best * 10) / 10;
}

/** A copy turned clockwise by a quarter turn. */
export function turnGray(gray: Gray, turn: QuarterTurn): Gray {
  if (turn === 0) return gray;
  const swap = turn !== 180;
  const width = swap ? gray.height : gray.width;
  const height = swap ? gray.width : gray.height;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < gray.height; y++)
    for (let x = 0; x < gray.width; x++) {
      const [tx, ty] =
        turn === 90
          ? [gray.height - 1 - y, x]
          : turn === 180
            ? [gray.width - 1 - x, gray.height - 1 - y]
            : [y, gray.width - 1 - x];
      pixels[ty * width + tx] = gray.pixels[y * gray.width + x];
    }
  return { width, height, pixels };
}

/** Coefficient of variation of a profile after a moving average over `window` entries. */
function contrast(values: Float64Array, window: number) {
  const smoothed = new Float64Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    smoothed[i] = sum / Math.min(i + 1, window);
  }
  const mean = smoothed.reduce((total, value) => total + value, 0) / Math.max(1, smoothed.length);
  if (!mean) return 0;
  const variance =
    smoothed.reduce((total, value) => total + (value - mean) ** 2, 0) / smoothed.length;
  return Math.sqrt(variance) / mean;
}

/**
 * How much more the ink is banded into rows than into columns, within the inked area. Smoothing
 * over about 1% of the page hides the gaps between letters but keeps those between lines.
 */
function banding(ink: Uint8Array, width: number, height: number) {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (ink[y * width + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left || bottom < top) return 1;
  const rows = new Float64Array(bottom - top + 1);
  const columns = new Float64Array(right - left + 1);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++)
      if (ink[y * width + x]) {
        rows[y - top]++;
        columns[x - left]++;
      }
  const window = Math.max(2, Math.round(Math.max(width, height) / 100));
  return contrast(rows, window) / Math.max(1e-9, contrast(columns, window));
}

/**
 * How upright lines of text read, from -1 to 1: Latin text has a longer tail of ink above each
 * line's middle (capitals and ascenders) than below it (fewer descenders), so the third moment
 * of each line's ink about its middle is negative when upright and positive upside down.
 */
function uprightness(ink: Uint8Array, width: number, height: number) {
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y] += ink[y * width + x];
  let peak = 0;
  for (const value of rows) peak = Math.max(peak, value);
  const busy = peak * 0.05;
  let weighted = 0;
  let total = 0;
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const inLine = y < height && rows[y] > busy;
    if (inLine && start < 0) start = y;
    if (inLine || start < 0) continue;
    let mass = 0;
    let moment = 0;
    for (let row = start; row < y; row++) {
      mass += rows[row];
      moment += rows[row] * row;
    }
    const middle = moment / Math.max(1, mass);
    let second = 0;
    let third = 0;
    for (let row = start; row < y; row++) {
      const distance = row - middle;
      second += rows[row] * distance ** 2;
      third += rows[row] * distance ** 3;
    }
    if (mass > 0 && second > 0) {
      const skewness = third / mass / (second / mass) ** 1.5;
      weighted += -skewness * mass;
      total += mass;
    }
    start = -1;
  }
  return total ? Math.max(-1, Math.min(1, weighted / total)) : 0;
}

/** The evidence for a turn: row-to-column banding and how upright each candidate reads. */
export function turnSignals(gray: Gray) {
  const { ink } = inkOf(gray);
  const ratio = banding(ink, gray.width, gray.height);
  const upright = ([0, 90, 180, 270] as QuarterTurn[]).map((turn) => {
    const turned = turnGray(gray, turn);
    return uprightness(inkOf(turned).ink, turned.width, turned.height);
  });
  return { ratio, upright };
}

/**
 * The quarter turn, clockwise, that makes the page's text upright, or 0 when the page is blank,
 * too small or no turn is clearly better.
 */
export function detectTurn(gray: Gray): QuarterTurn {
  if (gray.width < MIN_SIDE / 2 || gray.height < MIN_SIDE / 2) return 0;
  const { count } = inkOf(gray);
  if (count < gray.pixels.length * MIN_INK) return 0;
  const { ratio, upright } = turnSignals(gray);
  // Lines run across the page (0 or 180) or down it (90 or 270); otherwise it is unclear.
  let candidates: [QuarterTurn, QuarterTurn];
  if (ratio > 1.5) candidates = [0, 180];
  else if (ratio < 1 / 1.5) candidates = [90, 270];
  else return 0;
  const [first, second] = candidates.map((turn) => upright[turn / 90]);
  if (Math.abs(first - second) < 0.04) return 0;
  return first > second ? candidates[0] : candidates[1];
}

/** Maps a point in the prepared image back to the image as rendered, both in pixels. */
export type PointMap = (x: number, y: number) => [number, number];

/**
 * The map from an image turned clockwise by `turn` and then rotated by `skew` degrees about its
 * centre (to straighten it) back to the original image of `width` by `height` pixels.
 */
export function inverseMap(
  width: number,
  height: number,
  turn: QuarterTurn,
  skew: number,
): PointMap {
  const swap = turn === 90 || turn === 270;
  const turnedWidth = swap ? height : width;
  const turnedHeight = swap ? width : height;
  const radians = (skew * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = turnedWidth / 2;
  const cy = turnedHeight / 2;
  return (x, y) => {
    // Undo the straightening: the image was rotated by -skew, so rotate by +skew.
    const dx = x - cx;
    const dy = y - cy;
    const tx = cx + dx * cos + dy * sin;
    const ty = cy - dx * sin + dy * cos;
    // Undo the quarter turn.
    if (turn === 90) return [ty, height - tx];
    if (turn === 180) return [width - tx, height - ty];
    if (turn === 270) return [width - ty, tx];
    return [tx, ty];
  };
}

/** A normalized [x, y, width, height] box mapped back, as the bounds of its four corners. */
export function mapBox(
  box: [number, number, number, number],
  map: PointMap,
  from: { width: number; height: number },
  to: { width: number; height: number },
): [number, number, number, number] {
  const [x, y, w, h] = box;
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ].map(([u, v]) => map(u * from.width, v * from.height));
  const xs = corners.map((corner) => corner[0] / to.width);
  const ys = corners.map((corner) => corner[1] / to.height);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const left = clamp(Math.min(...xs));
  const top = clamp(Math.min(...ys));
  return [left, top, clamp(Math.max(...xs)) - left, clamp(Math.max(...ys)) - top];
}

/** A recognition result with every line and word box mapped back onto the rendered page. */
export function mapOcrResult(
  result: OcrPageResult,
  map: PointMap,
  from: { width: number; height: number },
  to: { width: number; height: number },
): OcrPageResult {
  const word = (item: OcrWord): OcrWord => ({ ...item, bbox: mapBox(item.bbox, map, from, to) });
  const line = (item: OcrLine): OcrLine => ({
    ...item,
    bbox: mapBox(item.bbox, map, from, to),
    words: item.words.map(word),
  });
  return { ...result, lines: result.lines.map(line) };
}

import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextFontFace } from "../document-commands";

/** The closest of the 12 standard PDF text fonts; they need no embedded font data. */
export interface StandardTextStyle {
  face: TextFontFace;
  bold: boolean;
  italic: boolean;
}

/** One distinct run style found on a page, with the nearest standard font for new text. */
export interface PageTextStyle extends StandardTextStyle {
  /** The document's font name without a subset prefix, for display only. */
  fontName: string;
  /** Rendered size in points, including text and graphics scaling. */
  size: number;
  /** Fill color as `#rrggbb`. */
  color: string;
  sample: string;
  characters: number;
}

export interface FontDescription {
  name?: string | null;
  fallbackName?: string | null;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
}

interface PageLike {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  commonObjs: { get(id: string, callback: (data: unknown) => void): void };
}

const MONO = /mono|courier|consol|menlo|inconsolata|typewriter|fixedsys|\bcode\b/i;
const SERIF =
  /times|georgia|garamond|cambria|palatino|antiqua|minion|baskerville|caslon|bodoni|century|didot|charter|constantia|tiempos|merriweather|lora|playfair|serif/i;
const BOLD = /bold|black|heavy|semibold|demi|[-,]bd\b/i;
const ITALIC = /italic|oblique|slanted|[-,]it\b/i;
const MAX_STYLES = 12;
const SAMPLE_LENGTH = 40;
const INVISIBLE_TEXT = 3;

/** Removes the six-letter subset tag PDF producers put before embedded font names. */
export function displayFontName(name: string | null | undefined): string {
  return (name ?? "").replace(/^[A-Z]{6}\+/, "").trim();
}

function nearestFace(name: string, fallbackName: string | null | undefined): TextFontFace {
  if (MONO.test(name) || fallbackName === "monospace") return "mono";
  if (/sans/i.test(name)) return "sans";
  if (SERIF.test(name) || fallbackName === "serif") return "serif";
  return "sans";
}

/** Maps a document font to the closest standard font by name and descriptor hints. */
export function nearestStandardStyle(font: FontDescription): StandardTextStyle {
  const name = displayFontName(font.name);
  return {
    face: nearestFace(name, font.fallbackName),
    bold: Boolean(font.bold || font.black) || BOLD.test(name),
    italic: Boolean(font.italic) || ITALIC.test(name),
  };
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof (value as ArrayLike<number>).length !== "number") return null;
  const values = Array.from(value as ArrayLike<number>);
  return values.length >= 6 && values.every(Number.isFinite)
    ? (values.slice(0, 6) as Matrix)
    : null;
}

interface GraphicsState {
  ctm: Matrix;
  fill: string;
  font: string;
  fontSize: number;
  renderMode: number;
}

function glyphText(glyphs: unknown): string {
  if (!Array.isArray(glyphs)) return "";
  return glyphs
    .map((glyph) =>
      glyph && typeof glyph === "object" && "unicode" in glyph && typeof glyph.unicode === "string"
        ? glyph.unicode
        : "",
    )
    .join("");
}

function resolveFont(page: PageLike, id: string): Promise<FontDescription | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, 2000);
    try {
      page.commonObjs.get(id, (data) => {
        clearTimeout(timer);
        resolve(data && typeof data === "object" ? (data as FontDescription) : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

interface Run {
  font: string;
  size: number;
  color: string;
  text: string;
}

interface WalkState {
  graphics: GraphicsState;
  stack: GraphicsState[];
  textMatrix: Matrix;
  runs: Run[];
}

/** Applies graphics-state operators; returns false for operators it does not handle. */
function applyGraphicsOperator(walk: WalkState, fn: number, args: unknown[]): boolean {
  const state = walk.graphics;
  switch (fn) {
    case OPS.save:
      walk.stack.push({ ...state });
      return true;
    case OPS.paintFormXObjectBegin: {
      walk.stack.push({ ...state });
      const form = asMatrix(args[0]);
      if (form) state.ctm = multiply(form, state.ctm);
      return true;
    }
    case OPS.restore:
    case OPS.paintFormXObjectEnd:
      walk.graphics = walk.stack.pop() ?? state;
      return true;
    case OPS.transform: {
      const matrix = asMatrix(args);
      if (matrix) state.ctm = multiply(matrix, state.ctm);
      return true;
    }
    case OPS.setFillRGBColor:
      if (typeof args[0] === "string") state.fill = args[0];
      return true;
    case OPS.setFont:
      state.font = typeof args[0] === "string" ? args[0] : "";
      state.fontSize = Math.abs(Number(args[1]) || 0);
      return true;
    case OPS.setTextRenderingMode:
      state.renderMode = Number(args[0]) || 0;
      return true;
    default:
      return false;
  }
}

// OPS is read when called, not at import, so modules that mock PDF.js can still load this one.
function isShowText(fn: number) {
  return (
    fn === OPS.showText ||
    fn === OPS.showSpacedText ||
    fn === OPS.nextLineShowText ||
    fn === OPS.nextLineSetSpacingShowText
  );
}

/** Records a visible run with its size after text and graphics scaling. */
function recordRun(walk: WalkState, glyphs: unknown) {
  const state = walk.graphics;
  if (state.renderMode === INVISIBLE_TEXT || !state.font) return;
  const text = glyphText(glyphs);
  if (!text.trim()) return;
  const combined = multiply(walk.textMatrix, state.ctm);
  const size = Math.round(state.fontSize * Math.hypot(combined[2], combined[3]) * 2) / 2;
  if (size > 0) walk.runs.push({ font: state.font, size, color: state.fill, text });
}

function applyTextOperator(walk: WalkState, fn: number, args: unknown[]) {
  if (fn === OPS.beginText) walk.textMatrix = IDENTITY;
  else if (fn === OPS.setTextMatrix)
    walk.textMatrix = asMatrix(args) ?? asMatrix(args[0]) ?? walk.textMatrix;
  else if (isShowText(fn)) recordRun(walk, args.at(-1));
}

/** Walks the page's operators and records each visible text run's font, size and fill color. */
function collectRuns(fnArray: number[], argsArray: unknown[][]): Run[] {
  const walk: WalkState = {
    graphics: { ctm: IDENTITY, fill: "#000000", font: "", fontSize: 0, renderMode: 0 },
    stack: [],
    textMatrix: IDENTITY,
    runs: [],
  };
  for (const [index, fn] of fnArray.entries()) {
    const args = argsArray[index] ?? [];
    if (!applyGraphicsOperator(walk, fn, args)) applyTextOperator(walk, fn, args);
  }
  return walk.runs;
}

/** Lists the distinct text styles on a page, most used first. */
export async function readPageTextStyles(page: PageLike): Promise<PageTextStyle[]> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const runs = collectRuns(fnArray, argsArray);
  const ids = [...new Set(runs.map((run) => run.font))];
  const resolved = await Promise.all(ids.map((id) => resolveFont(page, id)));
  const fonts = new Map(ids.map((id, index) => [id, resolved[index]]));
  const styles = new Map<string, PageTextStyle>();
  for (const run of runs) {
    const font = fonts.get(run.font) ?? {};
    const nearest = nearestStandardStyle(font);
    const fontName = displayFontName(font.name) || "Unnamed font";
    const key = [fontName, run.size, run.color, nearest.bold, nearest.italic].join("|");
    const existing = styles.get(key);
    const text = run.text.replaceAll(/\s+/g, " ");
    if (existing) {
      existing.characters += text.length;
      if (existing.sample.length < SAMPLE_LENGTH) existing.sample = `${existing.sample} ${text}`;
    } else {
      styles.set(key, {
        ...nearest,
        fontName,
        size: run.size,
        color: run.color,
        sample: text,
        characters: text.length,
      });
    }
  }
  return [...styles.values()]
    .map((style) => ({ ...style, sample: style.sample.trim().slice(0, SAMPLE_LENGTH) }))
    .sort((a, b) => b.characters - a.characters)
    .slice(0, MAX_STYLES);
}

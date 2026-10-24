// Page boxes for print production (trim, bleed and art) and full-screen page transitions.
// Box margins are given for the page as displayed, then mapped to unrotated user space, so a
// "top" margin trims the edge the reader sees at the top of a rotated page.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFPage,
  type PDFPageLeaf,
} from "pdf-lib";
import { visibleBox } from "./page-box.ts";

export const PRINT_BOXES = ["TrimBox", "BleedBox", "ArtBox"] as const;
export type PrintBox = (typeof PRINT_BOXES)[number];

/** Inset from the media box in points, for the page as displayed. */
export interface BoxMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageBoxInfo {
  page: number;
  media: number[];
  crop: number[];
  trim: number[] | null;
  bleed: number[] | null;
  art: number[] | null;
}

const rect = (box: { x: number; y: number; width: number; height: number }) =>
  [box.x, box.y, box.x + box.width, box.y + box.height].map(
    (value) => Math.round(value * 100) / 100,
  );

function explicitBox(page: PDFPage, name: PrintBox) {
  const value = page.node.lookup(PDFName.of(name));
  if (!(value instanceof PDFArray) || value.size() !== 4) return null;
  const numbers = value
    .asArray()
    .map((item) => (item instanceof PDFNumber ? item.asNumber() : Number.NaN));
  return numbers.every(Number.isFinite) ? numbers.map((n) => Math.round(n * 100) / 100) : null;
}

export async function readPageBoxes(bytes: Uint8Array): Promise<PageBoxInfo[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page, index) => ({
    page: index + 1,
    media: rect(page.getMediaBox()),
    crop: rect(page.getCropBox()),
    trim: explicitBox(page, "TrimBox"),
    bleed: explicitBox(page, "BleedBox"),
    art: explicitBox(page, "ArtBox"),
  }));
}

/** Displayed margins expressed as unrotated [left, bottom, right, top] insets. */
export function userSpaceInsets(margins: BoxMargins, rotation: 0 | 90 | 180 | 270) {
  const { top, right, bottom, left } = margins;
  switch (rotation) {
    case 90:
      return { left: top, bottom: left, right: bottom, top: right };
    case 180:
      return { left: right, bottom: top, right: left, top: bottom };
    case 270:
      return { left: bottom, bottom: right, right: top, top: left };
    default:
      return { left, bottom, right, top };
  }
}

/** Sets, or with `margins` null removes, one print box on the chosen zero-based pages. */
export async function setPrintBox(
  bytes: Uint8Array,
  pages: number[],
  box: PrintBox,
  margins: BoxMargins | null,
): Promise<Uint8Array> {
  if (!PRINT_BOXES.includes(box)) throw new Error("Choose the trim, bleed or art box.");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const targets = [...new Set(pages)].filter((index) => index >= 0 && index < doc.getPageCount());
  if (!targets.length) throw new Error("Choose at least one page.");
  if (margins && !Object.values(margins).every((value) => Number.isFinite(value) && value >= 0))
    throw new Error("Margins must be zero or more points.");
  for (const index of targets) {
    const page = doc.getPage(index);
    if (!margins) {
      page.node.delete(PDFName.of(box));
      continue;
    }
    const media = page.getMediaBox();
    const inset = userSpaceInsets(margins, visibleBox(page).rotation);
    const width = media.width - inset.left - inset.right;
    const height = media.height - inset.bottom - inset.top;
    if (width < 1 || height < 1) throw new Error(`The margins leave no area on page ${index + 1}.`);
    page.node.set(
      PDFName.of(box),
      doc.context.obj([
        media.x + inset.left,
        media.y + inset.bottom,
        media.x + inset.left + width,
        media.y + inset.bottom + height,
      ]),
    );
  }
  return doc.save();
}

export const TRANSITION_STYLES = [
  "Split",
  "Blinds",
  "Box",
  "Wipe",
  "Dissolve",
  "Glitter",
  "Fly",
  "Push",
  "Cover",
  "Uncover",
  "Fade",
] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];

export interface PageTransition {
  style: TransitionStyle;
  /** Seconds the effect takes. */
  duration: number;
  /** Degrees counterclockwise the effect moves, for directional styles. */
  direction: 0 | 90 | 180 | 270;
  dimension: "H" | "V";
  motion: "I" | "O";
  /** Seconds before advancing to the next page in full-screen mode, or null to wait. */
  advanceAfter: number | null;
}

const DIRECTIONAL = new Set<TransitionStyle>([
  "Wipe",
  "Glitter",
  "Fly",
  "Push",
  "Cover",
  "Uncover",
]);
const DIMENSIONAL = new Set<TransitionStyle>(["Split", "Blinds"]);
const MOTION = new Set<TransitionStyle>(["Split", "Box", "Fly"]);

export function readPageTransition(page: PDFPage): PageTransition | null {
  const trans = page.node.lookup(PDFName.of("Trans"));
  if (!(trans instanceof PDFDict)) return null;
  const name = (key: string) => trans.lookupMaybe(PDFName.of(key), PDFName)?.decodeText();
  const number = (dict: PDFDict, key: string) =>
    dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber();
  const style = TRANSITION_STYLES.find((value) => value === name("S"));
  if (!style) return null;
  const direction = number(trans, "Di");
  const advance = number(page.node, "Dur");
  return {
    style,
    duration: number(trans, "D") ?? 1,
    direction: ([0, 90, 180, 270] as const).find((value) => value === direction) ?? 0,
    dimension: name("Dm") === "V" ? "V" : "H",
    motion: name("M") === "O" ? "O" : "I",
    advanceAfter: advance !== undefined && advance >= 0 ? advance : null,
  };
}

export async function readPageTransitions(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map(readPageTransition);
}

/** Sets, or with `transition` null removes, the full-screen transition of the chosen pages. */
export async function setPageTransition(
  bytes: Uint8Array,
  pages: number[],
  transition: PageTransition | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const targets = [...new Set(pages)].filter((index) => index >= 0 && index < doc.getPageCount());
  if (!targets.length) throw new Error("Choose at least one page.");
  if (transition) validateTransition(transition);
  for (const index of targets) {
    const node = doc.getPage(index).node;
    if (transition) writeTransition(doc, node, transition);
    else {
      node.delete(PDFName.of("Trans"));
      node.delete(PDFName.of("Dur"));
    }
  }
  return doc.save();
}

const inRange = (value: number, low: number, high: number) =>
  Number.isFinite(value) && value >= low && value <= high;

function validateTransition(transition: PageTransition) {
  if (!TRANSITION_STYLES.includes(transition.style)) throw new Error("Choose a transition.");
  if (!inRange(transition.duration, 0, 10) || transition.duration === 0)
    throw new Error("Transition length must be more than 0 and at most 10 seconds.");
  if (transition.advanceAfter !== null && !inRange(transition.advanceAfter, 0, 3600))
    throw new Error("Advance time must be from 0 to 3,600 seconds.");
}

function writeTransition(doc: PDFDocument, node: PDFPageLeaf, transition: PageTransition) {
  const entries: Record<string, unknown> = {
    Type: "Trans",
    S: transition.style,
    D: transition.duration,
  };
  if (DIRECTIONAL.has(transition.style)) entries.Di = transition.direction;
  if (DIMENSIONAL.has(transition.style)) entries.Dm = transition.dimension;
  if (MOTION.has(transition.style)) entries.M = transition.motion;
  node.set(PDFName.of("Trans"), doc.context.obj(entries as never));
  if (transition.advanceAfter === null) node.delete(PDFName.of("Dur"));
  else {
    // This is a PDF dictionary, not an HTTP response. validateTransition admits only finite
    // numbers in [0, 3600]; the integration regressions also reject CRLF and nonnumbers.
    node.set(PDFName.of("Dur"), PDFNumber.of(transition.advanceAfter));
  }
}

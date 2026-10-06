// Imposition places several pages on each sheet (N-up) or arranges them for a folded,
// saddle-stitched booklet. The result is a new PDF of page content only: comments, form fields
// and links stay in the original document.

import { PDFDocument, PDFName, degrees, rgb, type PDFEmbeddedPage, type PDFPage } from "pdf-lib";
import { visibleBox } from "./page-box.ts";

export type ImposeLayout = "2" | "4" | "6" | "9" | "16" | "booklet";
export type SheetSize = "letter" | "legal" | "tabloid" | "a4" | "a3";
export type SheetOrientation = "auto" | "portrait" | "landscape";

export interface ImposeOptions {
  layout: ImposeLayout;
  sheet: SheetSize;
  orientation: SheetOrientation;
  /** Outer margin in points. */
  margin: number;
  /** Space between pages in points. */
  gap: number;
  border: boolean;
  /** Pages to place, counting from 1; all pages when omitted. */
  pages?: number[];
}

/** Portrait sheet dimensions in points. */
export const SHEETS: Record<SheetSize, [number, number]> = {
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
};

/** Columns and rows on a portrait sheet. */
const GRIDS: Record<Exclude<ImposeLayout, "booklet">, [number, number]> = {
  "2": [1, 2],
  "4": [2, 2],
  "6": [2, 3],
  "9": [3, 3],
  "16": [4, 4],
};

const MAX_SOURCE_PAGES = 2000;

/**
 * Reading order of source pages for a saddle-stitched booklet: each consecutive pair is one
 * printed side, left then right, after padding with blanks (`null`) to a multiple of four.
 */
export function bookletOrder(count: number): (number | null)[][] {
  const padded = Math.ceil(count / 4) * 4;
  const page = (index: number) => (index < count ? index : null);
  const sides: (number | null)[][] = [];
  for (let sheet = 0; sheet < padded / 4; sheet++) {
    const outer = padded - 1 - 2 * sheet;
    const inner = 2 * sheet;
    sides.push([page(outer), page(inner)], [page(inner + 1), page(outer - 1)]);
  }
  return sides;
}

function sheetSize(sheet: SheetSize, landscape: boolean): [number, number] {
  const [width, height] = SHEETS[sheet];
  return landscape ? [height, width] : [width, height];
}

/** Two- and six-up layouts fill a landscape sheet best; the others suit portrait. */
function isLandscape(options: ImposeOptions) {
  if (options.orientation !== "auto") return options.orientation === "landscape";
  return options.layout === "booklet" || GRIDS[options.layout][0] < GRIDS[options.layout][1];
}

/** Columns and rows, turned to match the sheet when it is landscape. */
function gridFor(layout: ImposeLayout, landscapeSheet: boolean): [number, number] {
  if (layout === "booklet") return [2, 1];
  const [columns, rows] = GRIDS[layout];
  return landscapeSheet ? [rows, columns] : [columns, rows];
}

/** Consecutive pages fill each sheet left to right, top to bottom. */
function nUpOrder(count: number, perSheet: number): number[][] {
  return Array.from({ length: Math.ceil(count / perSheet) }, (_, sheet) =>
    Array.from(
      { length: Math.min(perSheet, count - sheet * perSheet) },
      (_, slot) => sheet * perSheet + slot,
    ),
  );
}

interface Placed {
  embedded: PDFEmbeddedPage;
  rotation: 0 | 90 | 180 | 270;
}

/** Draws a page scaled to fit and centered in a cell, keeping its displayed orientation. */
function drawInCell(
  sheet: PDFPage,
  placed: Placed,
  cell: { x: number; y: number; width: number; height: number },
  border: boolean,
) {
  const { embedded, rotation } = placed;
  const quarter = rotation === 90 || rotation === 270;
  const shownWidth = quarter ? embedded.height : embedded.width;
  const shownHeight = quarter ? embedded.width : embedded.height;
  const scale = Math.min(cell.width / shownWidth, cell.height / shownHeight);
  const width = embedded.width * scale;
  const height = embedded.height * scale;
  const left = cell.x + (cell.width - shownWidth * scale) / 2;
  const bottom = cell.y + (cell.height - shownHeight * scale) / 2;
  // A page shown turned clockwise is drawn turned the same way about its lower-left corner.
  const origin: Record<typeof rotation, [number, number]> = {
    0: [left, bottom],
    90: [left, bottom + width],
    180: [left + width, bottom + height],
    270: [left + height, bottom],
  };
  const [x, y] = origin[rotation];
  sheet.drawPage(embedded, { x, y, xScale: scale, yScale: scale, rotate: degrees(-rotation) });
  if (border)
    sheet.drawRectangle({
      x: left,
      y: bottom,
      width: shownWidth * scale,
      height: shownHeight * scale,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.5,
    });
}

function cells(
  size: [number, number],
  grid: [number, number],
  options: ImposeOptions,
): { x: number; y: number; width: number; height: number }[] {
  const [columns, rows] = grid;
  const width = (size[0] - 2 * options.margin - (columns - 1) * options.gap) / columns;
  const height = (size[1] - 2 * options.margin - (rows - 1) * options.gap) / rows;
  if (width < 18 || height < 18) throw new Error("The margins and gaps leave no room for pages.");
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: options.margin + column * (width + options.gap),
      y: size[1] - options.margin - (row + 1) * height - row * options.gap,
      width,
      height,
    };
  });
}

async function embedSources(output: PDFDocument, source: PDFDocument, indices: number[]) {
  const pages = indices.map((index) => source.getPage(index));
  // Blank pages may have no content stream, which embedding requires.
  for (const page of pages)
    if (!page.node.Contents())
      page.node.set(PDFName.of("Contents"), source.context.register(source.context.stream("")));
  const boxes = pages.map((page) => visibleBox(page));
  const embedded = await output.embedPages(
    pages,
    boxes.map((box) => ({
      left: box.x,
      bottom: box.y,
      right: box.x + box.width,
      top: box.y + box.height,
    })),
    boxes.map((box) => [1, 0, 0, 1, -box.x, -box.y]),
  );
  return embedded.map((page, index) => ({ embedded: page, rotation: boxes[index].rotation }));
}

/** Creates a new PDF with the chosen pages arranged several to a sheet or as a booklet. */
export async function imposePages(
  pdfBytes: Uint8Array,
  options: ImposeOptions,
): Promise<{ bytes: Uint8Array; sheets: number }> {
  if (!(options.margin >= 0 && options.gap >= 0)) throw new Error("Margins must not be negative.");
  const source = await PDFDocument.load(pdfBytes);
  const indices = (options.pages ?? source.getPageIndices().map((index) => index + 1)).map(
    (page) => page - 1,
  );
  if (!indices.length) throw new Error("Choose at least one page.");
  if (
    indices.some((index) => !Number.isInteger(index) || index < 0 || index >= source.getPageCount())
  )
    throw new Error("A chosen page is outside the document.");
  if (indices.length > MAX_SOURCE_PAGES)
    throw new Error(`Imposition is limited to ${MAX_SOURCE_PAGES} pages at a time.`);

  const output = await PDFDocument.create();
  const placed = await embedSources(output, source, indices);
  const landscape = isLandscape(options);
  const grid = gridFor(options.layout, landscape);
  const size = sheetSize(options.sheet, landscape);
  const slots = cells(size, grid, options);

  const sides =
    options.layout === "booklet"
      ? bookletOrder(placed.length)
      : nUpOrder(placed.length, slots.length);
  for (const side of sides) {
    const sheet = output.addPage(size);
    for (const [slot, index] of side.entries())
      if (index !== null) drawInCell(sheet, placed[index], slots[slot], options.border);
  }
  output.setProducer("NavPDF");
  return { bytes: await output.save(), sheets: sides.length };
}

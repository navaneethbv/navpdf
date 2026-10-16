import { mapInOrder } from "../../utils/async-sequence.ts";
import { PDFDocument, PDFName, PDFNumber, degrees } from "pdf-lib";
import { visibleBox, fromTopLeftVisual } from "./page-box.ts";
import { SHEETS, type SheetSize } from "./impose.ts";

export interface PosterOptions {
  sheet: SheetSize;
  landscape: boolean;
  scale: number;
  margin: number;
  overlap: number;
  pages?: number[];
}

/** Tile count includes overlap only between neighbours, never outside the source page. */
export function posterGrid(width: number, height: number, options: PosterOptions) {
  const dimensions = SHEETS[options.sheet];
  if (!dimensions) throw new Error("Choose a supported sheet size.");
  const [w, h] = options.landscape ? [dimensions[1], dimensions[0]] : dimensions;
  const values = [width, height, options.scale, options.margin, options.overlap];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    width <= 0 ||
    height <= 0 ||
    options.scale < 0.1 ||
    options.scale > 10 ||
    options.margin < 0 ||
    options.overlap < 0
  )
    throw new Error("Use a scale from 10% to 1000% and nonnegative margins and overlap.");
  const tileWidth = w - options.margin * 2;
  const tileHeight = h - options.margin * 2;
  if (
    Math.min(tileWidth, tileHeight) < 36 ||
    options.overlap >= Math.min(tileWidth, tileHeight) / 2
  )
    throw new Error(
      "Margins must leave room for content and overlap must be less than half a tile.",
    );
  const columns = Math.max(
    1,
    Math.ceil((width * options.scale - options.overlap) / (tileWidth - options.overlap)),
  );
  const rows = Math.max(
    1,
    Math.ceil((height * options.scale - options.overlap) / (tileHeight - options.overlap)),
  );
  if (columns * rows > 500) throw new Error("A poster is limited to 500 sheets. Reduce its scale.");
  return { columns, rows, tileWidth, tileHeight, sheetWidth: w, sheetHeight: h };
}

/** New print-only PDF; original annotations, form fields and links are not copied. */
export async function posterPages(bytes: Uint8Array, options: PosterOptions) {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = options.pages ?? source.getPageIndices().map((index) => index + 1);
  if (
    !pages.length ||
    pages.length > 500 ||
    pages.some((page) => !Number.isInteger(page) || page < 1 || page > source.getPageCount())
  )
    throw new Error("Choose between 1 and 500 valid pages.");
  // Validate the entire job before creating output or embedding resources.
  const plans = pages.map((number) => {
    const page = source.getPage(number - 1);
    const box = visibleBox(page);
    if (![0, 90, 180, 270].includes(box.rotation)) throw new Error("Unsupported page rotation.");
    const unitObject = page.node.lookup(PDFName.of("UserUnit"));
    const unit = unitObject instanceof PDFNumber ? unitObject.asNumber() : 1;
    if (!Number.isFinite(unit) || unit <= 0) throw new Error("Invalid page unit.");
    const turned = box.rotation === 90 || box.rotation === 270;
    const width = (turned ? box.height : box.width) * unit;
    const height = (turned ? box.width : box.height) * unit;
    return { page, box, unit, width, height, grid: posterGrid(width, height, options) };
  });
  const sheets = plans.reduce((count, plan) => count + plan.grid.columns * plan.grid.rows, 0);
  if (sheets > 500)
    throw new Error(
      "A poster export is limited to 500 sheets. Choose fewer pages or reduce scale.",
    );
  const output = await PDFDocument.create();
  function* tiles() {
    for (const { page, box, unit, width, height, grid } of plans) {
      if (!page.node.Contents())
        page.node.set(PDFName.of("Contents"), source.context.register(source.context.stream("")));
      const scale = options.scale * unit;
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.columns; col++) {
          const x = (col * (grid.tileWidth - options.overlap)) / options.scale;
          const y = (row * (grid.tileHeight - options.overlap)) / options.scale;
          const shownW = Math.min(grid.tileWidth / options.scale, width - x);
          const shownH = Math.min(grid.tileHeight / options.scale, height - y);
          const rect = fromTopLeftVisual(page, x / unit, y / unit, shownW / unit, shownH / unit);
          yield { page, box, grid, scale, shownH, rect };
        }
      }
    }
  }
  const embedTile = async (
    tile: ReturnType<typeof tiles> extends Generator<infer T> ? T : never,
  ) => {
    const { page, rect } = tile;
    const embedded = await output.embedPage(page, {
      left: rect.x,
      bottom: rect.y,
      right: rect.x + rect.width,
      top: rect.y + rect.height,
    });
    return { ...tile, embedded };
  };
  for await (const { box, grid, scale, shownH, rect, embedded } of mapInOrder(tiles(), embedTile)) {
    const sheet = output.addPage([grid.sheetWidth, grid.sheetHeight]);
    const left = options.margin;
    const bottom = grid.sheetHeight - options.margin - shownH * options.scale;
    const origins = {
      0: [left, bottom],
      90: [left, bottom + rect.width * scale],
      180: [left + rect.width * scale, bottom + rect.height * scale],
      270: [left + rect.height * scale, bottom],
    };
    const [drawX, drawY] = origins[box.rotation];
    sheet.drawPage(embedded, {
      x: drawX,
      y: drawY,
      xScale: scale,
      yScale: scale,
      rotate: degrees(-box.rotation),
    });
  }
  output.setProducer("NavPDF");
  return { bytes: await output.save(), sheets };
}

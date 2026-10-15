import { resolve } from "node:path";
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, it } from "vitest";
import { inspectDocument } from "../../src/features/document/document-insights";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

it("reads actual PDF.js text, rotated crop dimensions, mixed page sizes and UserUnit", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText("Hello world", { x: 50, y: 700, font });
  const rotated = document.addPage([400, 500]);
  rotated.setCropBox(20, 30, 200, 300);
  rotated.setRotation(degrees(90));
  const square = document.addPage([100, 100]);
  square.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
  const task = getDocument({
    data: await document.save(),
    standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    const result = await inspectDocument(pdf, [0, 1, 2]);
    expect(result).toMatchObject({
      words: 2,
      characters: 10,
      textlessPages: [2, 3],
      failedPages: [],
    });
    expect(
      result.pages.map(({ page, width, height, rotation, orientation }) => ({
        page,
        width,
        height,
        rotation,
        orientation,
      })),
    ).toEqual([
      { page: 1, width: 612, height: 792, rotation: 0, orientation: "Portrait" },
      { page: 2, width: 300, height: 200, rotation: 90, orientation: "Landscape" },
      { page: 3, width: 200, height: 200, rotation: 0, orientation: "Square" },
    ]);
  } finally {
    await task.destroy();
  }
});

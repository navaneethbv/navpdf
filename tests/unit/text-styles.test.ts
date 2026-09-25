import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  scale,
  setTextRenderingMode,
} from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  displayFontName,
  nearestStandardStyle,
  readPageTextStyles,
} from "../../src/services/pdf/text-styles";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

const pdfOptions = {
  standardFontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
  useSystemFonts: false,
};

describe("nearestStandardStyle", () => {
  it.each([
    [{ name: "ABCDEF+Georgia-BoldItalic" }, { face: "serif", bold: true, italic: true }],
    [{ name: "Arial-ItalicMT" }, { face: "sans", bold: false, italic: true }],
    [{ name: "NotoSans-SemiBold" }, { face: "sans", bold: true, italic: false }],
    [{ name: "Consolas" }, { face: "mono", bold: false, italic: false }],
    [
      { name: "Unknown", fallbackName: "serif" },
      { face: "serif", bold: false, italic: false },
    ],
    [
      { name: "F1", bold: true, fallbackName: "monospace" },
      { face: "mono", bold: true, italic: false },
    ],
    [{ name: "Times-Roman" }, { face: "serif", bold: false, italic: false }],
  ])("maps %o to the closest standard font", (font, expected) => {
    expect(nearestStandardStyle(font)).toEqual(expected);
  });

  it("strips subset prefixes from display names", () => {
    expect(displayFontName("QWERTY+Calibri-Bold")).toBe("Calibri-Bold");
    expect(displayFontName(undefined)).toBe("");
  });
});

describe("readPageTextStyles", () => {
  it("reads visible runs with their rendered size and fill color", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const courierOblique = await doc.embedFont(StandardFonts.CourierOblique);
    page.drawText("Quarterly report", {
      x: 50,
      y: 700,
      size: 18,
      font: timesBold,
      color: rgb(1, 0, 0),
    });
    page.drawText("Body copy that appears most often on the page.", {
      x: 50,
      y: 660,
      size: 10,
      font: helvetica,
    });
    page.pushOperators(pushGraphicsState(), scale(2, 2));
    page.drawText("scaled code", { x: 25, y: 300, size: 6, font: courierOblique });
    page.pushOperators(popGraphicsState());
    // OCR layers draw invisible text; it must not be offered as a style to match.
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText("hidden OCR words", { x: 50, y: 100, size: 30, font: helvetica });
    page.pushOperators(popGraphicsState());
    const pdf = await getDocument({ ...pdfOptions, data: await doc.save() }).promise;
    try {
      const styles = await readPageTextStyles(await pdf.getPage(1));
      expect(
        styles.map(({ fontName, size, color, face, bold, italic }) => ({
          fontName,
          size,
          color,
          face,
          bold,
          italic,
        })),
      ).toEqual([
        {
          fontName: "Helvetica",
          size: 10,
          color: "#000000",
          face: "sans",
          bold: false,
          italic: false,
        },
        {
          fontName: "Times-Bold",
          size: 18,
          color: "#ff0000",
          face: "serif",
          bold: true,
          italic: false,
        },
        {
          fontName: "Courier-Oblique",
          size: 12,
          color: "#000000",
          face: "mono",
          bold: false,
          italic: true,
        },
      ]);
      expect(styles[1].sample).toBe("Quarterly report");
      expect(styles.some((style) => style.sample.includes("hidden"))).toBe(false);
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
});

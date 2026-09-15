// @vitest-environment happy-dom
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { StandardFonts } from "pdf-lib";
import {
  placePageBoxes,
  termRects,
  viewportToPdfRect,
} from "../../src/features/redact/redaction-marks";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

it("places page boxes with real pdf.js viewports at every rotation", async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const task = getDocument({ data: await source.save() });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const rect: [number, number, number, number] = [72, 600, 272, 624];

  for (const rotation of [0, 90, 180, 270]) {
    const viewport = page.getViewport({ scale: 1.5, rotation });
    const div = document.createElement("div");
    const viewer = { getPageView: () => ({ div, viewport }) };
    const cleanup = placePageBoxes(viewer, [{ page: 1, rect, className: "redaction-mark" }]);
    const box = div.querySelector<HTMLElement>(".redaction-mark");
    expect(box).not.toBeNull();
    const [left, top, width, height] = ["left", "top", "width", "height"].map((key) =>
      Number.parseFloat(box!.style.getPropertyValue(key)),
    );
    const [expectedWidth, expectedHeight] = rotation % 180 === 0 ? [300, 36] : [36, 300];
    expect(width).toBeCloseTo(expectedWidth);
    expect(height).toBeCloseTo(expectedHeight);

    // Drawing over the placed box converts back to the marked PDF rectangle.
    const drawn = viewportToPdfRect(
      viewer,
      1,
      { x: left, y: top },
      { x: left + width, y: top + height },
    );
    drawn!.forEach((value, index) => expect(value).toBeCloseTo(rect[index]));

    cleanup();
    expect(div.childElementCount).toBe(0);
  }
  await task.destroy();
});

it("covers the first and last glyph of a term in proportional text", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const size = 14;
  const line = "Client: CANARY-VISIBLE-7731";
  const measure = (text: string) => font.widthOfTextAtSize(text, size);
  const item = {
    str: line,
    transform: [size, 0, 0, size, 72, 700],
    width: measure(line),
    height: size,
  };
  const [rect] = termRects([item], "CANARY-VISIBLE-7731", measure);
  // The narrow "Client: " prefix made average character widths start the box inside "C".
  expect(rect[0]).toBeLessThanOrEqual(72 + measure("Client: "));
  expect(rect[2]).toBeGreaterThanOrEqual(72 + measure(line));
});

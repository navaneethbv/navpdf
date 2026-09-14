import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFString,
  degrees,
} from "pdf-lib";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const target = path.resolve("tests/pdf-fixtures");
await mkdir(target, { recursive: true });
for (const count of [5, 100, 500, 1000]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`NavPDF reader fixture: ${count} pages`);
  pdf.setAuthor("NavPDF test suite");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < count; index++) {
    const page = pdf.addPage([612, 792]);
    page.drawRectangle({
      x: 0,
      y: 776,
      width: 612,
      height: 16,
      color: rgb(0.12, 0.3, 0.24),
    });
    page.drawText("LOCAL DOCUMENT WORKSPACE", {
      x: 54,
      y: 722,
      size: 10,
      font: bold,
      color: rgb(0.18, 0.38, 0.31),
    });
    page.drawText(`Reader test / page ${index + 1}`, {
      x: 54,
      y: 665,
      size: 29,
      font: bold,
    });
    const lines = [
      "A quiet place to read, review, and keep your documents.",
      "Select this sentence and add a persistent highlight.",
      "Searchable text belongs inside the PDF document.",
      `Unique marker: NEEDLE-${String(index + 1).padStart(4, "0")}.`,
      "River river rivers. Match case and whole words independently.",
      "",
      "This file contains native text and standard embedded annotations.",
      "Use thumbnails, page navigation, zoom, and search to explore.",
      "Saving should preserve the original text and every page.",
    ];
    lines.forEach((line, row) =>
      page.drawText(line, {
        x: 54,
        y: 612 - row * 30,
        font: regular,
        size: 13,
        color: rgb(0.2, 0.25, 0.24),
      }),
    );
    page.drawLine({
      start: { x: 54, y: 96 },
      end: { x: 558, y: 96 },
      color: rgb(0.8, 0.84, 0.82),
    });
    page.drawText(`${index + 1} / ${count}`, {
      x: 54,
      y: 72,
      size: 10,
      font: regular,
    });
  }
  await writeFile(path.join(target, `reader-${count}.pdf`), await pdf.save());
}
const mixed = await PDFDocument.create();
const font = await mixed.embedFont(StandardFonts.Helvetica);
for (const [index, size] of [
  [612, 792],
  [842, 595],
  [400, 400],
  [300, 1000],
].entries()) {
  const page = mixed.addPage(size);
  page.drawText(`Mixed dimensions / ${index + 1}`, {
    x: 30,
    y: size[1] - 60,
    size: 15,
    font,
  });
  if (index === 1) page.setRotation(degrees(90));
}
const field = mixed.getForm().createTextField("ReaderName");
field.setText("Existing form value");
field.addToPage(mixed.getPage(0), { x: 40, y: 620, width: 300, height: 30 });
const note = mixed.context.obj({
  Type: "Annot",
  Subtype: "Text",
  Rect: [40, 540, 64, 564],
  Contents: PDFString.of("A standard PDF note."),
  T: PDFString.of("Test author"),
  Name: "Comment",
  F: 4,
});
mixed
  .getPage(0)
  .node.set(
    PDFName.of("Annots"),
    mixed.context.obj([
      mixed.context.register(note),
      ...mixed.getPage(0).node.Annots().asArray(),
    ]),
  );
await writeFile(
  path.join(target, "mixed-forms-annotations.pdf"),
  await mixed.save(),
);
await writeFile(
  path.join(target, "damaged.pdf"),
  "%PDF-1.7\nThis file deliberately has no PDF objects or cross-reference table.",
);

// Generate OCR evaluation fixture
const corpusJson = JSON.parse(
  await readFile(path.join(target, "ocr-evaluation-corpus.json"), "utf8"),
);
const ocrDoc = await PDFDocument.create();
ocrDoc.setTitle("NavPDF OCR evaluation corpus fixture");
const ocrFont = await ocrDoc.embedFont(StandardFonts.Helvetica);

for (const sample of corpusJson.samples) {
  const width = sample.pageWidth || 612;
  const height = sample.pageHeight || 792;
  const page = ocrDoc.addPage([width, height]);
  if (sample.rotation) {
    page.setRotation(degrees(sample.rotation));
  }

  if (sample.hasExistingText) {
    page.drawText(sample.digitalText, {
      x: 54,
      y: height - 60,
      size: 16,
      font: ocrFont,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  const scanHeight = sample.hasExistingText ? height - 120 : height;
  const scanSvg = `<svg width="${width}" height="${scanHeight}">
    <rect width="100%" height="100%" fill="${sample.category === "low-contrast" ? "#e2e2e2" : "#ffffff"}"/>
    <text x="54" y="60" font-family="sans-serif" font-size="14" fill="${sample.category === "low-contrast" ? "#666666" : "#111111"}">
      ${sample.referenceText}
    </text>
  </svg>`;
  const pngBuffer = await sharp(Buffer.from(scanSvg)).png().toBuffer();
  const embeddedImg = await ocrDoc.embedPng(pngBuffer);
  page.drawImage(embeddedImg, {
    x: 0,
    y: 0,
    width,
    height: scanHeight,
  });
}
await writeFile(path.join(target, "ocr-scans.pdf"), await ocrDoc.save());

console.log(
  "Created reader, forms, annotation, rotation, dimension, damaged, and OCR fixtures.",
);

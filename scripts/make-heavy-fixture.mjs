#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

const output = resolve(process.argv[2] ?? "output/perf/heavy-40.pdf");
const pages = Number.parseInt(process.argv[3] ?? "40", 10);
if (!Number.isInteger(pages) || pages < 1 || pages > 500) {
  throw new Error("Page count must be an integer between 1 and 500.");
}

const doc = await PDFDocument.create();
for (let index = 0; index < pages; index++) {
  const page = doc.addPage([1200, 1600]);
  page.drawRectangle({ x: 0, y: 0, width: 1200, height: 1600, color: rgb(0.96, 0.97, 0.96) });
  for (let row = 0; row < 80; row++) {
    page.drawRectangle({
      x: 60,
      y: 80 + row * 18,
      width: 1080,
      height: 8,
      color: rgb((row % 10) / 100 + 0.1, 0.3, 0.2),
      opacity: 0.65,
    });
  }
  page.drawText(`NavPDF memory fixture page ${index + 1}`, {
    x: 60,
    y: 1515,
    size: 24,
    color: rgb(0.1, 0.2, 0.15),
  });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, await doc.save({ useObjectStreams: true }));
console.log(`Created ${output} with ${pages} pages.`);

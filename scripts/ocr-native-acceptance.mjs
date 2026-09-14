import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { applyOcrSearchableLayer } from "../src/services/document-commands.ts";

const directory = "output/ocr-review";
await mkdir(directory, { recursive: true });
const references = ["A violet lighthouse shines beside the river.", "Invoice 7392 total 184.50", ""];
const report = [];
for (const [index, reference] of references.entries()) {
  const path = `${directory}/scan-${index}.png`;
  const svg = `<svg width="1200" height="400"><rect width="1200" height="400" fill="white"/><text x="60" y="160" font-family="Arial" font-size="40">${reference}</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(path, png);
  const start = performance.now();
  const result = JSON.parse(execFileSync("src-tauri/target/debug/examples/ocr_cli", [path], { encoding: "utf8" }));
  assert.equal(result.fullText.trim(), reference);
  for (const line of result.lines) {
    assert.ok(line.bbox.every(Number.isFinite));
    assert.ok(line.bbox[0] >= 0 && line.bbox[1] >= 0 && line.bbox[2] > 0 && line.bbox[3] > 0);
  }
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedPng(png);
  pdf.addPage([1200, 400]).drawImage(embedded, { x: 0, y: 0, width: 1200, height: 400 });
  const original = await pdf.save();
  const source = `${directory}/source-${index}.pdf`;
  const saved = `${directory}/searchable-${index}.pdf`;
  await writeFile(source, original);
  await writeFile(saved, await applyOcrSearchableLayer(original, [result]));
  const extracted = execFileSync("pdftotext", [saved, "-"], { encoding: "utf8" });
  assert.equal(extracted.trim(), reference);
  for (const [file, suffix] of [[source, "before"], [saved, "after"]]) {
    execFileSync("pdftoppm", ["-singlefile", "-r", "72", "-png", file, `${directory}/${index}-${suffix}`]);
  }
  const before = await sharp(`${directory}/${index}-before.png`).raw().toBuffer();
  const after = await sharp(`${directory}/${index}-after.png`).raw().toBuffer();
  assert.deepEqual(after, before);
  report.push({ reference, result, milliseconds: performance.now() - start });
}
await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
console.log("Native OCR: two distinct scans recognized exactly; blank image returned no invented text. Saved text verified by poppler; scan rendering unchanged.");

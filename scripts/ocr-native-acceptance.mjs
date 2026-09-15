import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { applyOcrSearchableLayer } from "../src/services/document-commands.ts";

const directory = "output/ocr-review";
const corpusPath = "tests/pdf-fixtures/ocr-evaluation-corpus.json";
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
const degradedCategories = new Set(["rotated-skewed", "low-contrast", "mixed"]);

function escapedXml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function normalized(text) {
  return text.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function distance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column++) {
      const above = previous[column];
      previous[column] =
        left[row - 1] === right[column - 1]
          ? diagonal
          : 1 + Math.min(diagonal, previous[column], previous[column - 1]);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function errorRate(expected, actual, split) {
  const reference = split(normalized(expected));
  const candidate = split(normalized(actual));
  return distance(reference, candidate) / Math.max(1, reference.length);
}

function words(text) {
  return text ? text.split(" ").filter(Boolean) : [];
}

function characters(text) {
  return Array.from(text);
}

function imageSvg(sample, width, height) {
  const color = sample.category === "low-contrast" ? "#777" : "#111";
  const background = sample.category === "low-contrast" ? "#e2e2e2" : "#fff";
  const lines = sample.referenceText.match(/.{1,62}(?:\s|$)/gu) ?? [sample.referenceText];
  const textLines = lines
    .map(
      (line, index) =>
        `<tspan x="54" dy="${index === 0 ? 0 : 58}">${escapedXml(line.trim())}</tspan>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${background}"/>
    <text x="54" y="90" font-family="Arial" font-size="40" fill="${color}">${textLines}</text>
  </svg>`;
}

async function makeSourcePdf(sample, png, width, height) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([width, height]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (sample.hasExistingText) {
    page.drawText(sample.digitalText, { x: 54, y: height - 60, size: 16, font });
  }
  const image = await pdf.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width, height });
  return pdf.save();
}

await mkdir(directory, { recursive: true });
const report = [];
for (const sample of corpus.samples) {
  const width = 1200;
  const height = 500;
  const path = `${directory}/${sample.id}.png`;
  const png = await sharp(Buffer.from(imageSvg(sample, width, height)))
    .png()
    .toBuffer();
  await writeFile(path, png);

  const start = performance.now();
  try {
    const raw = execFileSync("src-tauri/target/debug/examples/ocr_cli", [path], {
      encoding: "utf8",
    });
    const result = JSON.parse(raw);
    const wer = errorRate(sample.referenceText, result.fullText, words);
    const cer = errorRate(sample.referenceText, result.fullText, characters);
    const thresholds = degradedCategories.has(sample.category)
      ? {
          wer: corpus.acceptanceThresholds.degradedScanMaxWer,
          cer: corpus.acceptanceThresholds.degradedScanMaxCer,
        }
      : {
          wer: corpus.acceptanceThresholds.cleanScanMaxWer,
          cer: corpus.acceptanceThresholds.cleanScanMaxCer,
        };

    assert.ok(Array.isArray(result.lines), `${sample.id}: OCR lines are missing`);
    for (const line of result.lines) {
      assert.equal(line.bbox.length, 4, `${sample.id}: OCR line bbox is malformed`);
      assert.ok(
        line.bbox.every((value) => Number.isFinite(value)),
        `${sample.id}: bbox is not finite`,
      );
      assert.ok(
        line.bbox.every((value) => value >= 0 && value <= 1),
        `${sample.id}: bbox is out of range`,
      );
    }

    const source = await makeSourcePdf(sample, png, width, height);
    const sourcePath = `${directory}/${sample.id}-source.pdf`;
    const savedPath = `${directory}/${sample.id}-searchable.pdf`;
    await writeFile(sourcePath, source);
    await writeFile(
      savedPath,
      await applyOcrSearchableLayer(source, [{ ...result, pageIndex: 0 }]),
    );
    const extracted = execFileSync("pdftotext", [savedPath, "-"], { encoding: "utf8" });
    const extractedWer = errorRate(sample.referenceText, extracted, words);
    const beforePng = `${directory}/${sample.id}-before`;
    const afterPng = `${directory}/${sample.id}-after`;
    for (const [file, output] of [
      [sourcePath, beforePng],
      [savedPath, afterPng],
    ]) {
      execFileSync("pdftoppm", ["-singlefile", "-r", "72", "-png", file, output]);
    }
    const before = await sharp(`${beforePng}.png`).raw().toBuffer();
    const after = await sharp(`${afterPng}.png`).raw().toBuffer();
    assert.deepEqual(after, before, `${sample.id}: searchable layer changed the rendered scan`);

    report.push({
      id: sample.id,
      category: sample.category,
      referenceWords: words(sample.referenceText).length,
      wer,
      cer,
      extractedWer,
      thresholds,
      passed: wer <= thresholds.wer && cer <= thresholds.cer && extractedWer <= thresholds.wer,
      milliseconds: performance.now() - start,
    });
  } catch (error) {
    report.push({
      id: sample.id,
      category: sample.category,
      passed: false,
      error: error instanceof Error ? error.message : "OCR acceptance failed.",
      milliseconds: performance.now() - start,
    });
  }
}

await writeFile(
  `${directory}/corpus-report.json`,
  `${JSON.stringify(
    {
      corpusVersion: corpus.corpusVersion,
      acceptanceThresholds: corpus.acceptanceThresholds,
      passed: report.every((sample) => sample.passed),
      samples: report,
    },
    null,
    2,
  )}\n`,
);

const passed = report.filter((sample) => sample.passed).length;
console.log(
  `Native OCR corpus: ${passed}/${report.length} samples passed. Report: ${directory}/corpus-report.json`,
);
if (passed !== report.length) process.exitCode = 1;

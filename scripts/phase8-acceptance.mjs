// Phase 8 acceptance: converts a synthetic PDF with the same `ooxml.ts` writers the app uses
// and checks every package with consumers that share none of that code: Python zipfile and
// XML parsing, Apple's Cocoa text system (`textutil`) and Quick Look rendering.
import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  buildDocx,
  buildPptx,
  buildRtf,
  buildXlsx,
  layoutPage,
  tableRows,
} from "../src/features/convert/ooxml.ts";

const root = path.resolve("output/phase8");
const results = [];
const record = (check, passed, detail = "") => {
  results.push({ check, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${check}${detail ? ` (${detail})` : ""}`);
};
const run = (command, args) =>
  spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

async function sourcePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([612, 792]);
  first.drawText("Quarterly Report 2026", { x: 72, y: 720, size: 24, font });
  first.drawText("Revenue grew in every region during the quarter.", {
    x: 72,
    y: 680,
    size: 11,
    font,
  });
  first.drawText("Accented text: Café résumé naïve.", { x: 72, y: 664, size: 11, font });
  const table = [
    ["Region", "Revenue", "Date"],
    ["North", "1,250.50", "2026-09-14"],
    ["Formula", "=SUM(A1:A2)", "pending"],
  ];
  table.forEach((row, r) =>
    row.forEach((cell, c) =>
      first.drawText(cell, { x: 72 + c * 170, y: 600 - r * 18, size: 11, font }),
    ),
  );
  const second = pdf.addPage([612, 792]);
  for (let row = 0; row < 12; row++) {
    second.drawText(`Left ${row}`, { x: 72, y: 700 - row * 16, size: 11, font });
    second.drawText(`Right ${row}`, { x: 340, y: 700 - row * 16, size: 11, font });
  }
  return pdf.save();
}

async function layouts(bytes) {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push(
      layoutPage(
        number,
        content.items.filter((item) => typeof item.str === "string"),
        width,
        height,
      ),
    );
  }
  return pages;
}

const PYTHON_PACKAGE_CHECK = `
import json, sys, zipfile
from xml.dom import minidom
archive = zipfile.ZipFile(sys.argv[1])
corrupt = archive.testzip()
parts = [name for name in archive.namelist() if name.endswith((".xml", ".rels"))]
for name in parts:
    minidom.parseString(archive.read(name))
print(json.dumps({"corrupt": corrupt, "parts": len(parts), "names": archive.namelist()}))
`;

function packageCheck(file) {
  const result = run("python3", ["-c", PYTHON_PACKAGE_CHECK, file]);
  if (result.status !== 0) return { ok: false, detail: result.stderr.trim().split("\n").pop() };
  const parsed = JSON.parse(result.stdout);
  return { ok: parsed.corrupt === null, detail: `${parsed.parts} XML parts`, names: parsed.names };
}

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const pdfBytes = await sourcePdf();
await writeFile(path.join(root, "source.pdf"), pdfBytes);
const pages = await layouts(pdfBytes);
const files = {
  docx: path.join(root, "report.docx"),
  xlsx: path.join(root, "report.xlsx"),
  pptxText: path.join(root, "report-text.pptx"),
  rtf: path.join(root, "report.rtf"),
};
await writeFile(files.docx, buildDocx(pages, "Quarterly Report"));
await writeFile(
  files.xlsx,
  buildXlsx(pages.map((page) => ({ name: `Page ${page.page}`, rows: tableRows(page) }))),
);
await writeFile(
  files.pptxText,
  buildPptx(
    pages.map((page) => ({
      width: page.width,
      height: page.height,
      boxes: page.lines.map((line) => ({ x: line.x, y: line.y, size: line.size, text: line.text })),
    })),
    "Quarterly Report",
  ),
);
await writeFile(files.rtf, buildRtf(pages));

for (const [kind, file] of Object.entries(files).filter(([kind]) => kind !== "rtf")) {
  const check = packageCheck(file);
  record(`${kind} is a valid ZIP with well-formed XML`, check.ok, check.detail);
}

const docxText = run("textutil", ["-convert", "txt", "-stdout", files.docx]).stdout;
record(
  "textutil reads the DOCX heading and body",
  docxText.includes("Quarterly Report 2026") && docxText.includes("Revenue grew in every region"),
);
record("textutil reads accented DOCX text", docxText.includes("Café résumé naïve"));
record(
  "DOCX keeps column reading order",
  docxText.indexOf("Left 11") >= 0 && docxText.indexOf("Left 11") < docxText.indexOf("Right 0"),
);
const rtfText = run("textutil", ["-convert", "txt", "-stdout", files.rtf]).stdout;
record(
  "textutil reads the RTF with Unicode escapes",
  rtfText.includes("Quarterly Report 2026") && rtfText.includes("Café résumé naïve"),
);

const sheet = run("python3", [
  "-c",
  "import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read('xl/worksheets/sheet1.xml').decode())",
  files.xlsx,
]).stdout;
record("XLSX stores 1,250.50 as a number", /<c r="B\d+"><v>1250.5<\/v><\/c>/.test(sheet));
record(
  "XLSX stores the ISO date as a dated serial",
  /<c r="C\d+" s="1"><v>46279<\/v><\/c>/.test(sheet),
);
record(
  "XLSX keeps formula-like text as an inline string",
  sheet.includes('<t xml:space="preserve">=SUM(A1:A2)</t>') && !sheet.includes("<f>"),
);

const pptxNames = packageCheck(files.pptxText).names ?? [];
record(
  "PPTX has one slide per page",
  pptxNames.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length === pages.length,
);
const previews = path.join(root, "quicklook");
await mkdir(previews, { recursive: true });
run("qlmanage", ["-t", "-s", "512", "-o", previews, files.pptxText, files.docx, files.xlsx]);
const thumbnails = await readdir(previews);
record(
  "Quick Look renders the PPTX, DOCX and XLSX",
  thumbnails.length === 3,
  thumbnails.join(", "),
);

await writeFile(path.join(root, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((result) => !result.passed);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed. Report: output/phase8/report.json`,
);
process.exit(failed.length ? 1 : 0);

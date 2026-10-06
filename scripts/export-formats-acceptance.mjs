// Export format acceptance: builds CSV, XML Spreadsheet 2003, HTML, XML, plain text, TIFF,
// PostScript and EPS files with the same writers the app uses, then checks them with
// consumers that share none of that code: Python's csv, html and XML parsers, Pillow,
// LibreOffice, ImageMagick and Ghostscript. Tools that are not installed are reported as
// failures rather than skipped.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { layoutPage, tableRows } from "../src/features/convert/ooxml.ts";
import {
  buildCsv,
  buildHtml,
  buildPlainText,
  buildSpreadsheetXml,
  buildXmlDocument,
} from "../src/features/convert/formats.ts";
import { buildEps, buildPostScript, buildTiff } from "../src/features/convert/raster.ts";

const root = path.resolve("output/export-formats");
const results = [];
const record = (check, passed, detail = "") => {
  results.push({ check, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${check}${detail ? ` (${detail})` : ""}`);
};
const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
const python = (code, ...args) => run("python3", ["-I", "-c", code, ...args]);

async function sourcePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([612, 792]);
  first.drawText("Quarterly Report 2026", { x: 72, y: 720, size: 24, font });
  first.drawText("Revenue grew in every region.", { x: 72, y: 680, size: 11, font });
  first.drawText("Accented text: Café résumé <b>&amp;", { x: 72, y: 664, size: 11, font });
  const table = [
    ["Region", "Revenue", "Date"],
    ["North", "1,250.50", "2026-09-14"],
    ["Formula", "=SUM(A1:A2)", 'a, "quoted"'],
  ];
  table.forEach((row, r) =>
    row.forEach((cell, c) =>
      first.drawText(cell, { x: 72 + c * 170, y: 600 - r * 18, size: 11, font }),
    ),
  );
  const second = pdf.addPage([792, 612]);
  second.drawText("Landscape page", { x: 72, y: 500, size: 11, font });
  return pdf.save();
}

async function layouts(bytes) {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push(layoutPage(number, content.items, width, height));
  }
  return pages;
}

/** A synthetic RGBA page: colored quadrants, a gradient band and a half-transparent block. */
function pattern(width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const band = y > height * 0.8;
      rgba[i] = band ? Math.round((x / width) * 255) : x < width / 2 ? 200 : 20;
      rgba[i + 1] = band ? 128 : y < height / 2 ? 40 : 180;
      rgba[i + 2] = band ? 255 - Math.round((x / width) * 255) : 90;
      rgba[i + 3] = x > width * 0.6 && y < height * 0.3 ? 128 : 255;
    }
  return rgba;
}

/** Composites onto white exactly as the TIFF writer documents, for pixel comparison. */
function flattened(rgba) {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let p = 0; p < rgba.length / 4; p++) {
    const alpha = rgba[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++)
      rgb[p * 3 + c] = Math.round(rgba[p * 4 + c] * alpha + 255 * (1 - alpha));
  }
  return rgb;
}

async function main() {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const pages = await layouts(await sourcePdf());
  const write = async (name, data) => {
    const file = path.join(root, name);
    await writeFile(file, data);
    return file;
  };

  const text = await write("report.txt", buildPlainText(pages));
  const textLines = (await readFile(text, "utf8")).split("\n");
  record(
    "plain text keeps title and body on separate lines",
    textLines.includes("Quarterly Report 2026") &&
      textLines.includes("Revenue grew in every region."),
  );

  const csv = await write("report.csv", buildCsv(pages.map((page) => tableRows(page))));
  const csvCheck = python(
    `import csv,sys,json
rows=list(csv.reader(open(sys.argv[1],encoding='utf-8-sig',newline='')))
print(json.dumps(rows))`,
    csv,
  );
  const csvRows = csvCheck.status === 0 ? JSON.parse(csvCheck.stdout) : [];
  const flat = csvRows.flat();
  record(
    "CSV parses with Python csv",
    csvCheck.status === 0 && flat.includes("1,250.50"),
    csvCheck.stderr.trim(),
  );
  record(
    "CSV neutralizes formula text and keeps quoted commas",
    flat.includes("'=SUM(A1:A2)") && flat.includes('a, "quoted"') && !flat.includes("=SUM(A1:A2)"),
  );

  const xmlSheet = await write(
    "report-2003.xml",
    buildSpreadsheetXml(
      pages.map((page) => ({ name: `Page ${page.page}`, rows: tableRows(page) })),
    ),
  );
  const converted = run("soffice", [
    "--headless",
    "--convert-to",
    "xlsx",
    "--outdir",
    path.join(root, "libreoffice"),
    xmlSheet,
  ]);
  const xlsxCheck = python(
    `import openpyxl,sys,json,datetime
wb=openpyxl.load_workbook(sys.argv[1])
cells=[c for ws in wb for row in ws.iter_rows() for c in row if c.value is not None]
out={'sheets':wb.sheetnames,
 'numbers':[c.value for c in cells if isinstance(c.value,(int,float))],
 'dates':[c.value.date().isoformat() for c in cells if isinstance(c.value,datetime.datetime)],
 'formulas':[c.value for c in cells if c.data_type=='f'],
 'text':[c.value for c in cells if isinstance(c.value,str)]}
print(json.dumps(out))`,
    path.join(root, "libreoffice", "report-2003.xlsx"),
  );
  const workbook = xlsxCheck.status === 0 ? JSON.parse(xlsxCheck.stdout) : null;
  record(
    "XML Spreadsheet 2003 opens in LibreOffice with one sheet per page",
    converted.status === 0 && workbook?.sheets.join("|") === "Page 1|Page 2",
    (converted.stderr || xlsxCheck.stderr).trim().slice(0, 200),
  );
  record(
    "XML Spreadsheet 2003 types numbers and dates without formulas",
    Boolean(
      workbook?.numbers.includes(1250.5) &&
      workbook.dates.includes("2026-09-14") &&
      workbook.formulas.length === 0 &&
      workbook.text.includes("=SUM(A1:A2)"),
    ),
  );

  const html = await write("report.html", buildHtml(pages, "report"));
  const htmlCheck = python(
    `import sys,json
from html.parser import HTMLParser
class P(HTMLParser):
  def __init__(s):
    super().__init__(); s.tags=[]; s.text=[]; s.meta=[]
  def handle_starttag(s,t,a):
    s.tags.append(t)
    if t=='meta': s.meta.append(dict(a))
  def handle_data(s,d):
    if d.strip(): s.text.append(d.strip())
p=P(); p.feed(open(sys.argv[1],encoding='utf-8').read())
print(json.dumps({'tags':p.tags,'text':p.text,'meta':p.meta}))`,
    html,
  );
  const parsedHtml = htmlCheck.status === 0 ? JSON.parse(htmlCheck.stdout) : null;
  record(
    "HTML parses with headings, escaped text and a restrictive CSP",
    Boolean(
      parsedHtml &&
      parsedHtml.tags.includes("h2") &&
      parsedHtml.tags.filter((tag) => tag === "section").length === 2 &&
      !parsedHtml.tags.includes("script") &&
      !parsedHtml.tags.includes("b") &&
      parsedHtml.text.some((value) => value.includes("Café résumé <b>&amp;")) &&
      parsedHtml.meta.some((meta) => meta.content?.startsWith("default-src 'none'")),
    ),
    htmlCheck.stderr.trim(),
  );
  const htmlText = run("soffice", [
    "--headless",
    "--convert-to",
    "txt:Text (encoded):UTF8",
    "--outdir",
    path.join(root, "libreoffice"),
    html,
  ]);
  const htmlAsText =
    htmlText.status === 0
      ? await readFile(path.join(root, "libreoffice", "report.txt"), "utf8").catch(() => "")
      : "";
  record(
    "HTML opens in LibreOffice Writer",
    htmlAsText.includes("Quarterly Report 2026") && htmlAsText.includes("Landscape page"),
  );

  const xml = await write("report.xml", buildXmlDocument(pages, "report"));
  const xmlCheck = python(
    `import sys,json,xml.etree.ElementTree as ET
r=ET.parse(sys.argv[1]).getroot()
print(json.dumps({'root':r.tag,'pages':[(p.get('number'),p.get('width')) for p in r],
 'headings':[h.text for h in r.iter('heading')],'paragraphs':[p.text for p in r.iter('paragraph')]}))`,
    xml,
  );
  const parsedXml = xmlCheck.status === 0 ? JSON.parse(xmlCheck.stdout) : null;
  record(
    "XML 1.0 document parses with pages, headings and paragraphs",
    Boolean(
      parsedXml?.root === "document" &&
      parsedXml.pages.length === 2 &&
      parsedXml.pages[1][1] === "792" &&
      parsedXml.headings.includes("Quarterly Report 2026") &&
      parsedXml.paragraphs.some((value) => value.includes("<b>&amp;")),
    ),
    xmlCheck.stderr.trim(),
  );

  const raster = [
    { width: 300, height: 200, dpi: 150 },
    { width: 120, height: 260, dpi: 72 },
  ].map((page) => ({ ...page, rgba: pattern(page.width, page.height) }));
  const tiff = await write("report.tiff", buildTiff(raster));
  for (const [index, page] of raster.entries())
    await write(`expected-${index}.rgb`, flattened(page.rgba));
  const tiffCheck = python(
    `import sys,json
from PIL import Image
im=Image.open(sys.argv[1]); out=[]
for i in range(im.n_frames):
  im.seek(i)
  exp=open(sys.argv[2]+f'/expected-{i}.rgb','rb').read()
  out.append({'size':im.size,'mode':im.mode,'dpi':[round(v) for v in im.info.get('dpi',(0,0))],
   'compression':im.info.get('compression'),'exact':im.convert('RGB').tobytes()==exp})
print(json.dumps(out))`,
    tiff,
    root,
  );
  const frames = tiffCheck.status === 0 ? JSON.parse(tiffCheck.stdout) : [];
  record(
    "multipage TIFF decodes pixel-exactly in Pillow",
    frames.length === 2 &&
      frames.every(
        (frame) => frame.exact && frame.mode === "RGB" && frame.compression === "packbits",
      ) &&
      frames[0].dpi[0] === 150 &&
      frames[1].size.join("x") === "120x260",
    tiffCheck.stderr.trim() || JSON.stringify(frames),
  );
  const identify = run("identify", ["-format", "%w %h %x %[compression]\\n", tiff]);
  record(
    "multipage TIFF reads in ImageMagick",
    identify.status === 0 && identify.stdout.trim().split("\n").length === 2,
    (identify.stdout || identify.stderr).trim().replaceAll("\n", "; "),
  );

  const jpegPages = [];
  for (const [index, page] of raster.entries()) {
    const ppm = await write(
      `source-${index}.ppm`,
      Buffer.concat([
        Buffer.from(`P6 ${page.width} ${page.height} 255\n`),
        Buffer.from(flattened(page.rgba)),
      ]),
    );
    const jpeg = path.join(root, `source-${index}.jpg`);
    run("convert", [ppm, "-quality", "95", jpeg]);
    jpegPages.push({
      jpeg: new Uint8Array(await readFile(jpeg)),
      pixelWidth: page.width,
      pixelHeight: page.height,
      width: (page.width * 72) / page.dpi,
      height: (page.height * 72) / page.dpi,
    });
  }
  const ps = await write("report.ps", buildPostScript(jpegPages, "report"));
  const gsPs = run("gs", [
    "-q",
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=png16m",
    "-r150",
    `-sOutputFile=${path.join(root, "ps-%d.png")}`,
    ps,
  ]);
  const psCheck = python(
    `import sys,json
from PIL import Image, ImageChops, ImageStat
out=[]
for i in (1,2):
  r=Image.open(f'{sys.argv[1]}/ps-{i}.png').convert('RGB')
  s=Image.open(f'{sys.argv[1]}/source-{i-1}.jpg').convert('RGB').resize(r.size)
  out.append({'size':r.size,'diff':max(ImageStat.Stat(ImageChops.difference(r,s)).mean)})
print(json.dumps(out))`,
    root,
  );
  const psPages = psCheck.status === 0 ? JSON.parse(psCheck.stdout) : [];
  record(
    "PostScript renders every page in Ghostscript at the page size",
    gsPs.status === 0 &&
      psPages.length === 2 &&
      psPages[0].size.join("x") === "300x200" &&
      psPages.every((page) => page.diff < 12),
    (gsPs.stderr || psCheck.stderr).trim().slice(0, 200) || JSON.stringify(psPages),
  );
  const dsc = (await readFile(ps, "utf8")).split("\n");
  record(
    "PostScript DSC page comments match the page count and no data line starts with %",
    dsc.filter((line) => line.startsWith("%%Page:")).length === 2 &&
      dsc.includes("%%Pages: 2") &&
      dsc.every((line) => !line.startsWith("%") || /^%(%|!)/.test(line)),
  );

  const eps = await write("report.eps", buildEps(jpegPages[1], "report"));
  const gsEps = run("gs", [
    "-q",
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-dEPSCrop",
    "-sDEVICE=png16m",
    "-r72",
    `-sOutputFile=${path.join(root, "eps.png")}`,
    eps,
  ]);
  const epsSize = python(
    `import sys
from PIL import Image
print('%dx%d' % Image.open(sys.argv[1]).size)`,
    path.join(root, "eps.png"),
  );
  record(
    "EPS renders in Ghostscript cropped to its bounding box",
    gsEps.status === 0 && epsSize.stdout.trim() === "120x260",
    (gsEps.stderr || epsSize.stderr || epsSize.stdout).trim(),
  );

  const passed = results.filter((result) => result.passed).length;
  await writeFile(path.join(root, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${passed} of ${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

await main();

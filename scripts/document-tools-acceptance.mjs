// Document tools acceptance: applies stamps, flattening, page labels, imposition, comment
// summaries, field geometry, accessibility fixes, image export and measurements with the same
// modules the app uses, then checks the saved files with readers that share none of that code:
// pypdf, Poppler (pdftotext, pdfinfo), Ghostscript and Pillow. Missing tools fail the run.
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  addFormField,
  addReply,
  addStickyNote,
  addTextMarkupAnnotations,
  updateFormField,
} from "../src/services/document-commands.ts";
import { addStamp } from "../src/services/pdf/stamps.ts";
import { flattenDocument } from "../src/services/pdf/flatten.ts";
import { setPageLabels } from "../src/services/pdf/page-labels.ts";
import { imposePages } from "../src/services/pdf/impose.ts";
import { setWidgetGeometry } from "../src/services/pdf/field-geometry.ts";
import { fixAccessibility } from "../src/services/pdf/accessibility.ts";
import { addMeasurement } from "../src/services/pdf/measure.ts";
import {
  collectComments,
  commentSummaryCsv,
  commentSummaryHtml,
} from "../src/features/annotations/comment-summary.ts";
import { pageImages } from "../src/features/convert/embedded-images.ts";

const root = path.resolve("output/document-tools");
const results = [];
const record = (check, passed, detail = "") => {
  results.push({ check, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${check}${detail ? ` (${detail})` : ""}`);
};
const run = (command, args) =>
  spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const python = (code, ...args) => run("python3", ["-I", "-c", code, ...args]);
const json = (result) => (result.status === 0 ? JSON.parse(result.stdout) : null);

async function write(name, bytes) {
  const file = path.join(root, name);
  await writeFile(file, bytes);
  return file;
}

async function source() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 4; index++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Source page ${index}`, { x: 72, y: 700, size: 18, font });
    if (index === 2) page.setRotation(degrees(90));
  }
  return doc.save();
}

/** Mean darkness of a rendered region, 0 for white; used to confirm marks were drawn. */
function inkIn(png, box) {
  return json(
    python(
      `import sys,json
from PIL import Image, ImageStat
im=Image.open(sys.argv[1]).convert('L').crop(tuple(json.loads(sys.argv[2])))
print(json.dumps(255-ImageStat.Stat(im).mean[0]))`,
      png,
      JSON.stringify(box),
    ),
  );
}

function render(file, page, name) {
  const out = path.join(root, name);
  const result = run("gs", [
    "-q",
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=png16m",
    "-r72",
    `-dFirstPage=${page}`,
    `-dLastPage=${page}`,
    `-sOutputFile=${out}`,
    file,
  ]);
  return result.status === 0 ? out : null;
}

async function checkStampsAndFlatten(base) {
  let bytes = await addStamp(base, { page: 1, stamp: "Approved", position: "top-right" });
  bytes = await addStamp(bytes, { page: 2, stamp: "Confidential", position: "top-left" });
  const stamped = await write("stamped.pdf", bytes);
  const stamps = json(
    python(
      `import sys,json,pypdf
r=pypdf.PdfReader(sys.argv[1])
print(json.dumps([[str(a.get_object()['/Name']), '/AP' in a.get_object()] for p in r.pages for a in p.get('/Annots',[])]))`,
      stamped,
    ),
  );
  record(
    "stamps carry names and appearances in pypdf",
    JSON.stringify(stamps) ===
      JSON.stringify([
        ["/Approved", true],
        ["/Confidential", true],
      ]),
    JSON.stringify(stamps),
  );
  const page1 = render(stamped, 1, "stamped-1.png");
  const page2 = render(stamped, 2, "stamped-2.png");
  // Approved sits top-right of the portrait page; Confidential top-left of the landscape view.
  const approved = page1 ? inkIn(page1, [400, 20, 590, 80]) : 0;
  const confidential = page2 ? inkIn(page2, [20, 20, 220, 80]) : 0;
  record(
    "Ghostscript draws stamps where placed, upright on the rotated page",
    approved > 5 && confidential > 5,
    `${approved?.toFixed(1)} / ${confidential?.toFixed(1)}`,
  );

  bytes = await addTextMarkupAnnotations(bytes, "Highlight", [
    { page: 3, quads: [{ x1: 70, y1: 696, x2: 250, y2: 718 }], opacity: 0.5 },
  ]);
  bytes = await addFormField(bytes, {
    type: "text",
    name: "Reviewer",
    page: 3,
    x: 72,
    y: 600,
    width: 200,
    height: 24,
  });
  bytes = await updateFormField(bytes, { name: "Reviewer", value: "Flattened Value" });
  const { bytes: flat } = await flattenDocument(bytes, { annotations: true, forms: true });
  const flattened = await write("flattened.pdf", flat);
  const structure = json(
    python(
      `import sys,json,pypdf
r=pypdf.PdfReader(sys.argv[1])
print(json.dumps({'annots': sum(len(p.get('/Annots',[])) for p in r.pages), 'acroform': '/AcroForm' in r.trailer['/Root']}))`,
      flattened,
    ),
  );
  const text = run("pdftotext", [flattened, "-"]).stdout;
  record(
    "flattened output has no annotations or form and keeps visible values",
    structure?.annots === 0 &&
      structure.acroform === false &&
      text.includes("Flattened Value") &&
      text.includes("APPROVED"),
    JSON.stringify(structure),
  );
}

async function checkLabelsAndImposition(base) {
  const labeled = await write(
    "labeled.pdf",
    await setPageLabels(base, [
      { startPage: 1, style: "roman-lower", prefix: "", firstNumber: 1 },
      { startPage: 3, style: "decimal", prefix: "A-", firstNumber: 1 },
    ]),
  );
  const labels = json(
    python(
      `import sys,json,pypdf
print(json.dumps(list(pypdf.PdfReader(sys.argv[1]).page_labels)))`,
      labeled,
    ),
  );
  record(
    "pypdf reads the page labels",
    JSON.stringify(labels) === JSON.stringify(["i", "ii", "A-1", "A-2"]),
    JSON.stringify(labels),
  );

  const booklet = await imposePages(base, {
    layout: "booklet",
    sheet: "letter",
    orientation: "auto",
    margin: 18,
    gap: 9,
    border: false,
  });
  const bookletFile = await write("booklet.pdf", booklet.bytes);
  const info = run("pdfinfo", [bookletFile]).stdout;
  const sides = [1, 2].map((page) =>
    run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", bookletFile, "-"])
      .stdout.replaceAll(/\s+/g, " ")
      .trim(),
  );
  record(
    "Poppler reads booklet sides in saddle-stitch order on landscape sheets",
    /Pages:\s+2/.test(info) &&
      /792 x 612/.test(info) &&
      sides[0].indexOf("page 4") < sides[0].indexOf("page 1") &&
      sides[0].includes("page 4") &&
      sides[1].includes("page 3"),
    sides.join(" | "),
  );
}

async function checkSummary(base) {
  let bytes = await addStickyNote(base, {
    page: 3,
    x: 100,
    y: 600,
    contents: 'Check, "quoted" <value>',
    author: "Ana",
    id: "note",
  });
  bytes = await addReply(bytes, { parentId: "note", contents: "Done", author: "Ben" });
  const entries = collectComments(await PDFDocument.load(bytes));
  const csv = await write("comments.csv", commentSummaryCsv(entries));
  const html = await write("comments.html", commentSummaryHtml(entries, "report"));
  const rows = json(
    python(
      `import sys,csv,json
print(json.dumps(list(csv.reader(open(sys.argv[1],encoding='utf-8-sig',newline='')))))`,
      csv,
    ),
  );
  const parsed = json(
    python(
      `import sys,json
from html.parser import HTMLParser
class P(HTMLParser):
  def __init__(s): super().__init__(); s.text=[]
  def handle_data(s,d):
    if d.strip(): s.text.append(d.strip())
p=P(); p.feed(open(sys.argv[1],encoding='utf-8').read()); print(json.dumps(p.text))`,
      html,
    ),
  );
  record(
    "comment summary parses as CSV and HTML with threads",
    rows?.[1]?.[6] === 'Check, "quoted" <value>' &&
      rows?.[2]?.[1] === "Reply" &&
      Boolean(parsed?.includes('Check, "quoted" <value>')),
    JSON.stringify(rows?.slice(1)),
  );
}

async function checkFieldsAndAccessibility(base) {
  let bytes = await addFormField(base, {
    type: "text",
    name: "Moved",
    page: 1,
    x: 72,
    y: 500,
    width: 120,
    height: 20,
  });
  bytes = (
    await setWidgetGeometry(bytes, {
      field: "Moved",
      widget: 0,
      x: 300,
      y: 100,
      width: 200,
      height: 30,
    })
  ).bytes;
  bytes = await fixAccessibility(bytes, {
    title: "Acceptance report",
    displayTitle: true,
    language: "en-GB",
    tabOrder: true,
  });
  const file = await write("fields-accessibility.pdf", bytes);
  const facts = json(
    python(
      `import sys,json,pypdf
r=pypdf.PdfReader(sys.argv[1]); root=r.trailer['/Root']
a=r.pages[0]['/Annots'][0].get_object()
print(json.dumps({'rect':[round(float(v)) for v in a['/Rect']],'title':r.metadata.title,'lang':str(root.get('/Lang')),
 'display':bool(root['/ViewerPreferences'].get('/DisplayDocTitle')),'tabs':str(r.pages[0].get('/Tabs'))}))`,
      file,
    ),
  );
  record(
    "pypdf reads the moved field and accessibility settings",
    JSON.stringify(facts?.rect) === JSON.stringify([300, 662, 500, 692]) &&
      facts.title === "Acceptance report" &&
      facts.lang === "en-GB" &&
      facts.display === true &&
      facts.tabs === "/S",
    JSON.stringify(facts),
  );
}

async function checkImagesAndMeasurements() {
  const doc = await PDFDocument.create();
  const width = 5;
  const height = 3;
  const pixels = new Uint8Array(width * height * 3).map((_, index) => (index * 53) % 256);
  const image = doc.context.register(
    doc.context.flateStream(pixels, {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
    }),
  );
  const page = doc.addPage([400, 400]);
  const name = page.node.newXObject("Im", image);
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.stream(`q 50 0 0 30 20 20 cm ${name} Do Q`)),
  );
  const pdf = await getDocument({ data: await doc.save(), verbosity: 0 }).promise;
  const [extracted] = await pageImages(await pdf.getPage(1), 1, new Set(), 1);
  const png = await write("image.png", extracted.png);
  await write("image.rgb", pixels);
  const exact = json(
    python(
      `import sys,json
from PIL import Image
im=Image.open(sys.argv[1]); print(json.dumps([im.size, im.convert('RGB').tobytes()==open(sys.argv[2],'rb').read()]))`,
      png,
      path.join(root, "image.rgb"),
    ),
  );
  record(
    "Pillow decodes the exported image pixel-exactly",
    exact?.[1] === true,
    JSON.stringify(exact?.[0]),
  );

  const measured = await addMeasurement(await doc.save(), {
    page: 1,
    kind: "area",
    points: [
      [100, 100],
      [244, 100],
      [244, 244],
      [100, 244],
    ],
    scale: { pageInches: 1, realValue: 2, unit: "m" },
  });
  const file = await write("measured.pdf", measured.bytes);
  const annotation = json(
    python(
      `import sys,json,pypdf
a=pypdf.PdfReader(sys.argv[1]).pages[0]['/Annots'][0].get_object()
print(json.dumps([str(a['/Subtype']), str(a['/IT']), str(a['/Contents']), str(a['/Measure']['/R'])]))`,
      file,
    ),
  );
  const rendered = render(file, 1, "measured.png");
  const ink = rendered ? inkIn(rendered, [95, 150, 250, 305]) : 0;
  record(
    "pypdf reads the area measurement and Ghostscript draws it",
    JSON.stringify(annotation) ===
      JSON.stringify(["/Polygon", "/PolygonDimension", "16.00 sq m", "1 in = 2 m"]) && ink > 1,
    `${JSON.stringify(annotation)} ink ${ink?.toFixed(2)}`,
  );
}

async function main() {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const base = await source();
  await write("source.pdf", base);
  await checkStampsAndFlatten(base);
  await checkLabelsAndImposition(base);
  await checkSummary(base);
  await checkFieldsAndAccessibility(base);
  await checkImagesAndMeasurements();
  const passed = results.filter((result) => result.passed).length;
  await writeFile(path.join(root, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${passed} of ${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

await main();

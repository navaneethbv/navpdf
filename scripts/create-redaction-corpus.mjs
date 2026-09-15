// Synthetic Phase 7 acceptance corpus. Every canary is unique so an independent consumer can
// prove its absence. Output goes to ignored directories; nothing here is a checked-in fixture.
import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFontAndSize,
  setTextRenderingMode,
  showText,
} from "pdf-lib";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const CANARIES = {
  visible: "CANARY-VISIBLE-7731",
  ocr: "CANARY-OCR-4410",
  image: "CANARY-IMAGE-9902",
  annotation: "CANARY-ANNOT-5521",
  field: "CANARY-FIELD-6630",
  layer: "CANARY-LAYER-3318",
  meta: "CANARY-META-2207",
  xmp: "CANARY-XMP-8814",
  attachment: "CANARY-ATTACH-1190",
  script: "CANARY-JS-4471",
  outline: "CANARY-OUTLINE-6021",
  revision: "CANARY-REVISION-3355",
  shared: "CANARY-SHARED-7070",
};

function textOperators(font, fontKey, text, x, y, size, invisible = false) {
  return [
    pushGraphicsState(),
    beginText(),
    setFontAndSize(fontKey, size),
    ...(invisible ? [setTextRenderingMode(TextRenderingMode.Invisible)] : []),
    moveText(x, y),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  ];
}

/** Appends an incremental update that drops the page's last content stream from /Contents. */
async function dropLastContentStreamIncrementally(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  page.node.set(PDFName.of("Contents"), doc.context.obj(contents.asArray().slice(0, -1)));
  const ref = page.ref;
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 64))).toString("latin1");
  const previous = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail)[1]);
  const body = `${ref.objectNumber} ${ref.generationNumber} obj\n${page.node.toString()}\nendobj\n`;
  const objectOffset = bytes.length + 1;
  const xrefOffset = objectOffset + Buffer.byteLength(body, "latin1");
  const { Root, Info } = doc.context.trailerInfo;
  const xref =
    `xref\n0 1\n0000000000 65535 f \n${ref.objectNumber} 1\n` +
    `${String(objectOffset).padStart(10, "0")} ${String(ref.generationNumber).padStart(5, "0")} n \n` +
    `trailer\n<< /Size ${doc.context.largestObjectNumber + 1} /Root ${Root} /Info ${Info} /Prev ${previous} >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([Buffer.from(bytes), Buffer.from(`\n${body}${xref}`, "latin1")]);
}

async function redactionDocument() {
  const pdf = await PDFDocument.create();
  pdf.setTitle(CANARIES.meta);
  pdf.setSubject(`Synthetic subject ${CANARIES.meta}`);
  pdf.setKeywords([CANARIES.meta]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const second = pdf.addPage([612, 792]);

  page.drawText("Public heading stays visible", { x: 72, y: 740, size: 14, font });
  page.drawText(`Client: ${CANARIES.visible}`, { x: 72, y: 700, size: 14, font });
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(...textOperators(font, fontKey, CANARIES.ocr, 72, 650, 12, true));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="#ffffff"/><text x="20" y="80" font-family="Helvetica, Arial, sans-serif" font-size="52" fill="#000000">${CANARIES.image}</text></svg>`;
  const image = await pdf.embedPng(
    await sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).png().toBuffer(),
  );
  page.drawImage(image, { x: 72, y: 500, width: 300, height: 60 });

  const note = pdf.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [400, 690, 420, 710],
    Contents: PDFString.of(CANARIES.annotation),
  });
  page.node.addAnnot(pdf.context.register(note));

  const field = pdf.getForm().createTextField("synthetic.canary");
  field.setText(CANARIES.field);
  field.addToPage(page, { x: 72, y: 400, width: 250, height: 24, font });

  const layer = pdf.context.register(
    pdf.context.obj({ Type: "OCG", Name: PDFString.of("Private notes") }),
  );
  pdf.catalog.set(
    PDFName.of("OCProperties"),
    pdf.context.obj({ OCGs: [layer], D: { OFF: [layer], Order: [layer] } }),
  );
  page.node
    .normalizedEntries()
    .Resources.set(PDFName.of("Properties"), pdf.context.obj({ L1: layer }));
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of("OC"),
      PDFName.of("L1"),
    ]),
    ...textOperators(font, fontKey, CANARIES.layer, 72, 320, 12),
    PDFOperator.of(PDFOperatorNames.EndMarkedContent),
  );

  const xmp = pdf.context.stream(
    `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${CANARIES.xmp}</dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
    { Type: "Metadata", Subtype: "XML" },
  );
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(xmp));
  await pdf.attach(
    new TextEncoder().encode(`Synthetic notes ${CANARIES.attachment}`),
    "notes.txt",
    {
      mimeType: "text/plain",
      description: "Synthetic attachment",
    },
  );
  pdf.catalog.set(
    PDFName.of("OpenAction"),
    pdf.context.register(
      pdf.context.obj({ S: "JavaScript", JS: PDFString.of(`app.alert("${CANARIES.script}")`) }),
    ),
  );
  const outlines = pdf.context.nextRef();
  const item = pdf.context.nextRef();
  pdf.context.assign(
    item,
    pdf.context.obj({
      Title: PDFString.of(CANARIES.outline),
      Parent: outlines,
      Dest: [page.ref, "Fit"],
    }),
  );
  pdf.context.assign(
    outlines,
    pdf.context.obj({ Type: "Outlines", First: item, Last: item, Count: 1 }),
  );
  pdf.catalog.set(PDFName.of("Outlines"), outlines);

  const shared = pdf.context.register(
    pdf.context.stream(`BT /F1 12 Tf 72 200 Td (${CANARIES.shared}) Tj ET`, {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 612, 792],
      Resources: { Font: { F1: font.ref } },
    }),
  );
  second.drawText("Second page public text", { x: 72, y: 700, size: 14, font });
  for (const target of [page, second]) {
    const key = target.node.newXObject("Shared", shared);
    target.pushOperators(
      pushGraphicsState(),
      PDFOperator.of(PDFOperatorNames.DrawObject, [key]),
      popGraphicsState(),
    );
  }

  // The first revision also draws REVISION; the appended update removes that stream.
  const revision = pdf.context.register(
    pdf.context.contentStream(textOperators(font, fontKey, CANARIES.revision, 72, 250, 12)),
  );
  page.node.addContentStream(revision);
  const incremental = await dropLastContentStreamIncrementally(
    await pdf.save({ useObjectStreams: false }),
  );

  const width = (text, size) => font.widthOfTextAtSize(text, size);
  const clientWidth = width("Client: ", 14);
  const regions = [
    {
      page: 1,
      rect: [72 + clientWidth - 0.5, 695, 72 + clientWidth + width(CANARIES.visible, 14) + 1, 716],
    },
    { page: 1, rect: [70, 645, 74 + width(CANARIES.ocr, 12), 663] },
    { page: 1, rect: [72, 500, 372, 560] },
    { page: 1, rect: [398, 688, 422, 712] },
    { page: 1, rect: [72, 400, 322, 424] },
    { page: 1, rect: [70, 195, 74 + width(CANARIES.shared, 12), 212] },
  ];
  // The image canary exists only as pixels; the shared canary must survive on page 2.
  const terms = Object.entries(CANARIES)
    .filter(([key]) => key !== "shared" && key !== "image")
    .map(([, value]) => value);
  return { bytes: incremental, regions, terms };
}

async function protectionDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 3; index++) {
    pdf
      .addPage([612, 792])
      .drawText(`Protected marker PROTECT-PAGE-${index}`, { x: 72, y: 700, size: 16, font });
  }
  return pdf.save();
}

async function compressionDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 3; index++) {
    const { data, info } = await sharp({
      create: {
        width: 1800,
        height: 1200,
        channels: 3,
        background: { r: 40 * index, g: 120, b: 200 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><defs><linearGradient id="g"><stop offset="0" stop-color="#1f5f4b"/><stop offset="1" stop-color="#f5cf58"/></linearGradient></defs><rect width="1800" height="1200" fill="url(#g)"/><circle cx="${300 * index}" cy="600" r="380" fill="#8f3f32" opacity="0.6"/></svg>`,
          ),
        },
      ])
      .raw()
      .toBuffer({ resolveWithObject: true });
    const noisy = Buffer.from(data);
    for (let i = 0; i < noisy.length; i += 7) noisy[i] = (noisy[i] + ((i * 31) % 23)) & 0xff;
    const png = await sharp(noisy, { raw: info }).png({ compressionLevel: 0 }).toBuffer();
    const image = await pdf.embedPng(png);
    const page = pdf.addPage([612, 792]);
    page.drawText(`Compression marker COMPRESS-PAGE-${index}`, { x: 72, y: 740, size: 16, font });
    page.drawImage(image, { x: 72, y: 380, width: 300, height: 200 });
    page.drawRectangle({ x: 72, y: 330, width: 468, height: 20, color: rgb(0.2, 0.4, 0.3) });
  }
  return pdf.save();
}

/** Duplicate image streams and a classic cross-reference table leave room for lossless savings. */
async function losslessDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { data, info } = await sharp({
    create: { width: 700, height: 500, channels: 3, background: { r: 30, g: 90, b: 70 } },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(data);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (pixels[i] + ((i * 131) % 97)) & 0xff;
  const png = await sharp(pixels, { raw: info }).png().toBuffer();
  for (let index = 1; index <= 4; index++) {
    // Embedding the same bytes again creates a separate, byte-identical image object.
    const image = await pdf.embedPng(png);
    const page = pdf.addPage([612, 792]);
    page.drawText(`Lossless marker LOSSLESS-PAGE-${index}`, { x: 72, y: 740, size: 16, font });
    page.drawImage(image, { x: 72, y: 300, width: 420, height: 300 });
  }
  return pdf.save({ useObjectStreams: false });
}

export async function createCorpus(directory) {
  await mkdir(directory, { recursive: true });
  const redaction = await redactionDocument();
  const files = {
    redaction: path.join(directory, "redaction-canary.pdf"),
    protection: path.join(directory, "protection-source.pdf"),
    compression: path.join(directory, "compression-source.pdf"),
    lossless: path.join(directory, "lossless-source.pdf"),
  };
  await writeFile(files.redaction, redaction.bytes);
  await writeFile(files.protection, await protectionDocument());
  await writeFile(files.compression, await compressionDocument());
  await writeFile(files.lossless, await losslessDocument());
  return { files, regions: redaction.regions, terms: redaction.terms };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = path.resolve(process.argv[2] ?? "output/phase7/corpus");
  const corpus = await createCorpus(target);
  console.log(JSON.stringify(corpus.files, null, 2));
}

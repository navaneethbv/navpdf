import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFName, degrees } from "pdf-lib";
import { resolve } from "node:path";
import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  applyDocumentDecorations,
  removeDocumentDecorations,
} from "../../src/services/document-commands";
import {
  decorationMatrix,
  decorationSourceType,
  type DecorationImage,
} from "../../src/services/pdf/decoration-images";
import { pageImages } from "../../src/features/viewer/view-geometry";
import { addImageStamp, addStamp } from "../../src/services/pdf/stamps";
import { addShapeAnnotation, updateAnnotation } from "../../src/services/document-commands";
import { addPolyShape } from "../../src/services/pdf/comment-types";
import { readComment } from "../../src/services/pdf/read-comment";
import { eraseInk, eraseStrokes } from "../../src/services/pdf/ink-eraser";
import { addLinkAnnotation } from "../../src/services/document-commands";
import { readHideActions } from "../../src/services/pdf/hide-actions";
import { AnnotationMode } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
const standardFontDataUrl = `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`;

// A 2 by 1 pixel PNG: one red and one blue pixel.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==",
  ),
  (char) => char.codePointAt(0) ?? 0,
);

async function pages(...sizes: [number, number, number?][]) {
  const doc = await PDFDocument.create();
  for (const [width, height, rotation] of sizes) {
    const page = doc.addPage([width, height]);
    page.drawText("Body", { x: 40, y: 40, size: 12 });
    if (rotation) page.setRotation(degrees(rotation));
  }
  return doc.save();
}

async function operators(bytes: Uint8Array, pageNumber = 1) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  try {
    const page = await (await task.promise).getPage(pageNumber);
    return await page.getOperatorList();
  } finally {
    await task.destroy();
  }
}

const picture = (overrides: Partial<DecorationImage> = {}): DecorationImage => ({
  bytes: PNG,
  type: "png",
  scale: 0.5,
  opacity: 0.4,
  rotation: 0,
  behind: false,
  ...overrides,
});

describe("watermarks and backgrounds from a file", () => {
  it("centres a picture at a share of the page width, over or behind the content", async () => {
    const source = await pages([600, 800]);
    const over = await applyDocumentDecorations(source, { watermark: { image: picture() } });
    const list = await operators(over);
    const [image] = pageImages(list.fnArray, list.argsArray, OPS);
    // Half the page width, keeping the 2:1 shape, centred on the page.
    expect(image.bounds).toEqual({ left: 150, right: 450, top: 325, bottom: 475 });
    // Drawn after the page's text.
    expect(list.fnArray.indexOf(OPS.paintImageXObject)).toBeGreaterThan(
      list.fnArray.indexOf(OPS.showText),
    );

    const behind = await applyDocumentDecorations(source, {
      background: { image: picture({ scale: 1, opacity: 1 }) },
    });
    const behindList = await operators(behind);
    expect(behindList.fnArray.indexOf(OPS.paintImageXObject)).toBeLessThan(
      behindList.fnArray.indexOf(OPS.showText),
    );
    const doc = await PDFDocument.load(behind);
    const contents = doc.getPage(0).node.Contents() as PDFArray;
    const first = doc.context.lookup(contents.get(0)) as { dict: { get(name: PDFName): unknown } };
    expect(first.dict.get(PDFName.of("NavPDF_Decoration"))).toBeTruthy();

    // Removing decorations takes the picture away and keeps the page's text.
    const removed = await operators(await removeDocumentDecorations(behind));
    expect(removed.fnArray).not.toContain(OPS.paintImageXObject);
    expect(removed.fnArray).toContain(OPS.showText);
  });

  it("uses a page of another PDF and keeps a picture upright on a rotated page", async () => {
    const logo = await PDFDocument.create();
    logo.addPage([100, 50]);
    const second = logo.addPage([200, 100]);
    second.drawText("Logo", { x: 10, y: 10, size: 20 });
    const source = await pages([600, 800], [600, 800, 90]);
    const watermarked = await applyDocumentDecorations(source, {
      watermark: {
        image: picture({ bytes: await logo.save(), type: "pdf", pageNumber: 2, scale: 0.25 }),
      },
    });
    const list = await operators(watermarked);
    expect(list.fnArray).toContain(OPS.paintFormXObjectBegin);

    // On the page turned 90 degrees, a quarter of its displayed width (800) is 200 points, and
    // the picture is turned back so it reads upright.
    const matrix = decorationMatrix(
      { x: 0, y: 0, width: 600, height: 800, rotation: 90 },
      { width: 200, height: 100 },
      { scale: 0.25, rotation: 0 },
    );
    expect(matrix.map((value) => Math.round(value * 1000) / 1000)).toEqual([0, 1, -1, 0, 350, 300]);

    await expect(
      applyDocumentDecorations(source, {
        watermark: { image: picture({ bytes: await logo.save(), type: "pdf", pageNumber: 3 }) },
      }),
    ).rejects.toThrow(/has 2 page/);
  });

  it("recognises PNG, JPEG and PDF files by their contents", () => {
    expect(decorationSourceType(PNG)).toBe("png");
    expect(decorationSourceType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(decorationSourceType(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(decorationSourceType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});

async function annotationsOf(bytes: Uint8Array, pageNumber = 1) {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  try {
    const page = await (await task.promise).getPage(pageNumber);
    const annotations = await page.getAnnotations();
    const list = await page.getOperatorList({ annotationMode: AnnotationMode.ENABLE });
    return { annotations, list };
  } finally {
    await task.destroy();
  }
}

describe("sign-here and picture stamps", () => {
  it("draws a filled sign-here tag without a detail line", async () => {
    const stamped = await addStamp(await pages([600, 800]), {
      page: 1,
      stamp: "SignHere",
      detail: "Ada, 2026-10-24",
      position: "bottom-left",
      width: 160,
    });
    const { annotations, list } = await annotationsOf(stamped);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ subtype: "Stamp", contentsObj: { str: "SIGN HERE" } });
    // PDF.js folds the painting operator into each constructed path.
    const painted = list.fnArray.flatMap((fn, index) =>
      fn === OPS.constructPath ? [list.argsArray[index][0]] : [],
    );
    expect(painted).toContain(OPS.fill);
    const doc = await PDFDocument.load(stamped);
    const annotation = doc.getPage(0).node.Annots()!.lookup(0) as unknown as {
      get(name: PDFName): unknown;
    };
    expect(String(annotation.get(PDFName.of("Name")))).toBe("/NavPDFSignHere");
  });

  it("stamps a picture or a PDF page keeping its shape, upright on a rotated page", async () => {
    const source = await pages([600, 800], [600, 800, 90]);
    const pictured = await addImageStamp(source, {
      page: 1,
      bytes: PNG,
      type: "png",
      position: "center",
      width: 200,
      label: "Logo",
    });
    const first = await annotationsOf(pictured);
    expect(first.annotations[0]).toMatchObject({ subtype: "Stamp", contentsObj: { str: "Logo" } });
    const [x1, y1, x2, y2] = first.annotations[0].rect as number[];
    expect([x2 - x1, y2 - y1]).toEqual([200, 100]);
    expect([x1 + (x2 - x1) / 2, y1 + (y2 - y1) / 2]).toEqual([300, 400]);
    expect(first.list.fnArray).toContain(OPS.paintImageXObject);

    const logo = await PDFDocument.create();
    logo.addPage([300, 100]).drawText("Seal", { x: 10, y: 10, size: 30 });
    const paged = await addImageStamp(pictured, {
      page: 2,
      bytes: await logo.save(),
      type: "pdf",
      position: "top-left",
      width: 150,
    });
    const second = await annotationsOf(paged, 2);
    const [a, b, c, d] = second.annotations[0].rect as number[];
    // The page is turned 90 degrees, so the 150 by 50 stamp is 50 wide and 150 tall in its space.
    expect([c - a, d - b]).toEqual([50, 150]);
    expect(second.annotations[0].contentsObj.str).toBe("Image stamp");
    expect(second.list.fnArray).toContain(OPS.paintFormXObjectBegin);
  });
});

async function onlyAnnotation(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots()!;
  return { doc, dict: annots.lookup(0) as unknown as import("pdf-lib").PDFDict, annots };
}

describe("line endings and dashed or cloudy borders", () => {
  it("draws every line ending style and redraws the appearance after later edits", async () => {
    const lined = await addShapeAnnotation(await pages([600, 800]), {
      page: 1,
      kind: "Line",
      start: [100, 400],
      end: [300, 400],
      color: [1, 0, 0],
      width: 2,
      id: "line",
    });
    const before = await onlyAnnotation(lined);
    const [, , oldRight] = (before.dict.lookup(PDFName.of("Rect")) as PDFArray)
      .asArray()
      .map(Number);
    const ended = await updateAnnotation(lined, {
      id: "line",
      page: 1,
      lineEndings: ["Diamond", "RClosedArrow"],
      borderStyle: "dashed",
    });
    const { dict } = await onlyAnnotation(ended);
    expect(String(dict.lookup(PDFName.of("LE")))).toBe("[ /Diamond /RClosedArrow ]");
    const style = dict.lookup(PDFName.of("BS")) as import("pdf-lib").PDFDict;
    expect(String(style.lookup(PDFName.of("S")))).toBe("/D");
    // The rectangle grows to hold the reversed arrow beyond the end point.
    const rect = (dict.lookup(PDFName.of("Rect")) as PDFArray).asArray().map(Number);
    expect(rect[2]).toBeGreaterThan(oldRight);

    const { annotations, list } = await annotationsOf(ended);
    expect(annotations[0].lineEndings).toEqual(["Diamond", "RClosedArrow"]);
    expect(list.fnArray).toContain(OPS.setDash);
    const painted = list.fnArray.flatMap((fn, index) =>
      fn === OPS.constructPath ? [list.argsArray[index][0]] : [],
    );
    // Diamond and the closed reversed arrow are filled; the line itself is stroked.
    expect(painted.filter((op) => op === OPS.fillStroke).length).toBe(2);

    // A colour change redraws the appearance NavPDF made, in the new colour.
    const recoloured = await updateAnnotation(ended, { id: "line", page: 1, color: [0, 0, 1] });
    const blue = await annotationsOf(recoloured);
    const colours = blue.list.fnArray.flatMap((fn, index) =>
      fn === OPS.setStrokeRGBColor ? [blue.list.argsArray[index][0]] : [],
    );
    expect(colours).toContain("#0000ff");
    expect(colours).not.toContain("#ff0000");

    await expect(
      updateAnnotation(lined, { id: "line", page: 1, borderStyle: "cloudy" }),
    ).rejects.toThrow(/cloudy border/);
    await expect(
      updateAnnotation(lined, {
        id: "line",
        page: 1,
        lineEndings: ["Bracket" as never, "None"],
      }),
    ).rejects.toThrow(/line ending/);
  });

  it("gives rectangles a cloudy border and connected lines their endings", async () => {
    const boxed = await addShapeAnnotation(await pages([600, 800]), {
      page: 1,
      kind: "Square",
      start: [100, 100],
      end: [300, 250],
      color: [0, 0.5, 0],
      width: 1,
      id: "box",
    });
    const cloudy = await updateAnnotation(boxed, { id: "box", page: 1, borderStyle: "cloudy" });
    const { dict, annots } = await onlyAnnotation(cloudy);
    expect(
      String((dict.lookup(PDFName.of("BE")) as import("pdf-lib").PDFDict).lookup(PDFName.of("S"))),
    ).toBe("/C");
    const comment = readComment({ id: "box", subtype: "Square" }, 1, annots);
    expect(comment?.borderStyle).toBe("cloudy");
    const { list } = await annotationsOf(cloudy);
    // Scallops are drawn as Bézier curves.
    const pathOps = list.fnArray.flatMap((fn, index) =>
      fn === OPS.constructPath ? [list.argsArray[index]] : [],
    );
    expect(pathOps.length).toBeGreaterThan(0);

    const connected = await addPolyShape(await pages([600, 800]), {
      page: 1,
      kind: "PolyLine",
      vertices: [
        [100, 100],
        [200, 150],
        [300, 100],
      ],
      color: [0, 0, 0],
      width: 2,
    });
    // Connected lines get a generated name.
    const name = String(
      (
        (await onlyAnnotation(connected)).dict.lookup(PDFName.of("NM")) as { decodeText(): string }
      ).decodeText(),
    );
    const ended = await updateAnnotation(connected, {
      id: name,
      page: 1,
      lineEndings: ["OpenArrow", "Slash"],
    });
    const poly = await onlyAnnotation(ended);
    expect(readComment({ id: name, subtype: "PolyLine" }, 1, poly.annots)?.lineEndings).toEqual([
      "OpenArrow",
      "Slash",
    ]);
    const polyList = (await annotationsOf(ended)).list;
    const strokes = polyList.fnArray.flatMap((fn, index) =>
      fn === OPS.constructPath ? [polyList.argsArray[index][0]] : [],
    );
    // The connected line, the open arrow and the slash are each stroked.
    expect(strokes.filter((op) => op === OPS.stroke).length).toBe(3);
  });
});

/** A page with one ink annotation of a horizontal and a vertical stroke, and its pop-up. */
async function inked() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const popup = doc.context.register(
    doc.context.obj({ Type: "Annot", Subtype: "Popup", Rect: [0, 0, 10, 10] }),
  );
  const ink = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Ink",
      Rect: [99, 99, 301, 301],
      InkList: [
        [100, 200, 200, 200, 300, 200],
        [250, 100, 250, 300],
      ],
      BS: { W: 2 },
      C: [0, 0, 1],
      Popup: popup,
    }),
  );
  page.node.set(PDFName.of("Annots"), doc.context.obj([ink, popup]));
  return doc.save();
}

describe("ink eraser", () => {
  it("cuts strokes where the eraser passes, including between stored points", () => {
    const { strokes, changed } = eraseStrokes(
      [
        [
          [0, 0],
          [100, 0],
        ],
        [
          [0, 50],
          [10, 50],
        ],
      ],
      [
        [50, -20],
        [50, 20],
      ],
      5,
    );
    expect(changed).toBe(true);
    // The long stroke had no point near x = 50 but is still cut there; the other is untouched.
    expect(strokes).toHaveLength(3);
    expect(Math.max(...strokes[0].map(([x]) => x))).toBeLessThan(46);
    expect(Math.min(...strokes[1].map(([x]) => x))).toBeGreaterThan(54);
    expect(strokes[2]).toEqual([
      [0, 50],
      [10, 50],
    ]);
  });

  it("keeps the remaining pieces of a drawing and deletes one that is wholly erased", async () => {
    const source = await inked();
    const cut = await eraseInk(
      source,
      1,
      [
        [150, 210],
        [150, 190],
      ],
      6,
    );
    expect(cut.changed).toBe(1);
    const { dict } = await onlyAnnotation(cut.bytes);
    const strokes = (dict.lookup(PDFName.of("InkList")) as PDFArray).asArray();
    expect(strokes).toHaveLength(3);
    expect(dict.lookup(PDFName.of("AP"))).toBeTruthy();
    const { list } = await annotationsOf(cut.bytes);
    const strokeOps = list.fnArray.flatMap((fn, index) =>
      fn === OPS.constructPath && list.argsArray[index][0] === OPS.stroke ? [1] : [],
    );
    expect(strokeOps).toHaveLength(3);

    const untouched = await eraseInk(source, 1, [[500, 500]], 5);
    expect(untouched).toEqual({ bytes: source, changed: 0 });

    const wiped = await eraseInk(
      source,
      1,
      [
        [90, 200],
        [310, 200],
        [250, 310],
        [250, 90],
      ],
      6,
    );
    const doc = await PDFDocument.load(wiped.bytes);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });
});

/** A page with two text fields, "contact.name" and "notes", and one optional content group. */
async function formWithLayer() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  form.createTextField("contact.name").addToPage(page, { x: 50, y: 600, width: 200, height: 20 });
  form.createTextField("notes").addToPage(page, { x: 50, y: 500, width: 200, height: 20 });
  const layer = doc.context.register(doc.context.obj({ Type: "OCG", Name: "Notes" }));
  doc.catalog.set(
    PDFName.of("OCProperties"),
    doc.context.obj({ OCGs: [layer], D: { ON: [layer], Order: [layer] } }),
  );
  return { bytes: await doc.save(), layer: `${layer.objectNumber}R` };
}

const linkAt = { page: 1, rect: [50, 100, 250, 130] as [number, number, number, number] };

describe("link actions and appearance", () => {
  it("adds layer, show or hide field and reset links that PDF.js reads", async () => {
    const { bytes, layer } = await formWithLayer();
    const layered = await addLinkAnnotation(bytes, {
      ...linkAt,
      target: { type: "layers", layers: [layer], layerState: "OFF" },
      appearance: { width: 2, style: "dashed", color: [1, 0, 0], highlight: "Outline" },
    });
    const hidden = await addLinkAnnotation(layered, {
      ...linkAt,
      target: { type: "fields", fields: ["contact", "notes"], hideFields: true },
    });
    const reset = await addLinkAnnotation(hidden, { ...linkAt, target: { type: "reset" } });

    const { annotations } = await annotationsOf(reset);
    const links = annotations.filter((annotation) => annotation.subtype === "Link");
    expect(links[0].setOCGState).toEqual({ state: ["OFF", layer], preserveRB: true });
    expect(links[0].borderStyle).toMatchObject({ width: 2, style: 2 });
    expect(links[2].resetForm).toMatchObject({ fields: [], refs: [], include: true });

    const doc = await PDFDocument.load(reset);
    const first = doc.getPage(0).node.Annots()!.lookup(2) as import("pdf-lib").PDFDict;
    expect(String(first.lookup(PDFName.of("H")))).toBe("/O");

    // PDF.js leaves the show or hide action to NavPDF, which reads it from the document.
    const actions = await readHideActions(reset);
    expect(actions.get(String(links[1].id))).toEqual({ fields: ["contact", "notes"], hide: true });

    await expect(
      addLinkAnnotation(bytes, { ...linkAt, target: { type: "layers", layers: ["9999R"] } }),
    ).rejects.toThrow(/layer is not in this document/);
    await expect(
      addLinkAnnotation(bytes, { ...linkAt, target: { type: "fields", fields: ["missing"] } }),
    ).rejects.toThrow(/no form field named missing/);
  });
});

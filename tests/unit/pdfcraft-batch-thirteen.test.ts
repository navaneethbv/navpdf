import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { updateAnnotation } from "../../src/services/document-commands";
import {
  parseDefaultAppearance,
  shapeBounds,
  styleTextBox,
} from "../../src/services/pdf/text-box-style";
import { screenToPageOffset } from "../../src/features/annotations/nudge";
import { orthoPoint } from "../../src/features/annotations/ortho";
import {
  clearCommentClipboard,
  clipboardText,
  nextPasteOffset,
  pastesComments,
  setCommentClipboard,
} from "../../src/features/annotations/comment-clipboard";
import { selectedCommentIds } from "../../src/stores/workspace";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

async function onePage(entries: Record<string, unknown>) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.node.addAnnot(
    doc.context.register(doc.context.obj({ Type: "Annot", P: page.ref, ...entries } as never)),
  );
  return doc.save();
}

async function annotation(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const dict = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
  const appearance = dict.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N")) as PDFRawStream;
  const resources = appearance.dict.lookup(PDFName.of("Resources"), PDFDict);
  const content = new TextDecoder("latin1").decode(decodePDFRawStream(appearance).decode());
  const states = resources.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
  const alpha = (name: string) => {
    const state = states?.lookupMaybe(PDFName.of(name), PDFDict);
    return {
      CA: state?.lookupMaybe(PDFName.of("CA"), PDFNumber)?.asNumber(),
      ca: state?.lookupMaybe(PDFName.of("ca"), PDFNumber)?.asNumber(),
    };
  };
  const nums = (key: string) =>
    dict
      .lookupMaybe(PDFName.of(key), PDFArray)
      ?.asArray()
      .map((value) => (value as PDFNumber).asNumber());
  return { dict, content, alpha, nums, bbox: appearance.dict.lookup(PDFName.of("BBox")) };
}

describe("Separate line and fill opacity", () => {
  it("draws the line and the fill of a rectangle at their own opacity", async () => {
    const bytes = await onePage({
      Subtype: "Square",
      NM: PDFString.of("box"),
      Rect: [100, 100, 300, 200],
      C: [1, 0, 0],
      BS: { W: 2, S: "S" },
    });
    const updated = await updateAnnotation(bytes, {
      id: "box",
      fillColor: [0, 0, 1],
      strokeOpacity: 1,
      fillOpacity: 0.25,
    });
    const saved = await annotation(updated);
    expect(saved.nums("IC")).toEqual([0, 0, 1]);
    expect(saved.alpha("GS0")).toEqual({ CA: 1, ca: 0.25 });
    expect(saved.dict.lookup(PDFName.of("CA"), PDFNumber).asNumber()).toBe(1);
    expect(saved.content).toMatch(/\bB\b/);
    // A single opacity afterwards applies to the whole shape again.
    const whole = await annotation(await updateAnnotation(updated, { id: "box", opacity: 0.5 }));
    expect(whole.alpha("GS0")).toEqual({ CA: 0.5, ca: 0.5 });
    // Removing the fill draws the outline alone.
    const unfilled = await annotation(
      await updateAnnotation(updated, { id: "box", fillColor: null }),
    );
    expect(unfilled.nums("IC")).toBeUndefined();
    expect(unfilled.content).not.toMatch(/\bB\b/);
  });

  it("refuses part opacity on comments without a fill", async () => {
    const bytes = await onePage({
      Subtype: "Line",
      NM: PDFString.of("line"),
      Rect: [0, 0, 100, 100],
      L: [0, 0, 100, 100],
    });
    await expect(updateAnnotation(bytes, { id: "line", fillOpacity: 0.5 })).rejects.toThrow(/fill/);
  });
});

describe("Text box border shapes", () => {
  const textBox = () =>
    onePage({
      Subtype: "FreeText",
      NM: PDFString.of("tb"),
      Rect: [100, 100, 200, 140],
      Contents: PDFString.of("Room 12"),
      DA: PDFString.of("/Helv 12 Tf 0 0 1 rg"),
      BS: { W: 1 },
    });

  it("reads font size and colour from the default appearance", () => {
    expect(parseDefaultAppearance("/Helv 9 Tf 0 0 1 rg")).toEqual({ size: 9, color: [0, 0, 1] });
    expect(parseDefaultAppearance("0.5 g /F1 14 Tf")).toEqual({
      size: 14,
      color: [0.5, 0.5, 0.5],
    });
    expect(parseDefaultAppearance("")).toEqual({ size: 12, color: [0, 0, 0] });
  });

  it("finds valid appearance operands after a long malformed numeric token", () => {
    const malformed = "1".repeat(100_000) + "x";
    expect(parseDefaultAppearance(`${malformed} /Helv 14 Tf 0.3 g 2 0.5 . rg`)).toEqual({
      size: 14,
      color: [1, 0.5, 0],
    });
  });

  it("puts an oval through the text box's corners and a circle around it", () => {
    const oval = shapeBounds([0, 0, 100, 40], "oval", 0);
    expect(oval[2] - oval[0]).toBeCloseTo(100 * Math.SQRT2);
    expect(oval[3] - oval[1]).toBeCloseTo(40 * Math.SQRT2);
    const circle = shapeBounds([0, 0, 100, 40], "circle", 2);
    expect(circle[2] - circle[0]).toBeCloseTo(circle[3] - circle[1]);
    expect(circle[2] - circle[0]).toBeCloseTo(Math.hypot(100, 40) + 2);
  });

  it("draws an oval around the text, keeps the text's place and goes back to a rectangle", async () => {
    const oval = await styleTextBox(await textBox(), "tb", { shape: "oval", fillOpacity: 0.3 });
    const saved = await annotation(oval);
    const rect = saved.nums("Rect")!;
    const rd = saved.nums("RD")!;
    // The text area (rectangle less RD) is the original box.
    expect(rect[0] + rd[0]).toBeCloseTo(100);
    expect(rect[1] + rd[1]).toBeCloseTo(100);
    expect(rect[2] - rd[2]).toBeCloseTo(200);
    expect(rect[3] - rd[3]).toBeCloseTo(140);
    expect(saved.dict.lookup(PDFName.of("NavPDFBorderShape"), PDFName).decodeText()).toBe("Oval");
    expect(saved.content).toMatch(/ c\n/);
    expect(saved.alpha("GSFill")).toEqual({ CA: 0.3, ca: 0.3 });
    // An independent reader finds the text inside the original box.
    const pdf = await getDocument({ data: oval.slice() }).promise;
    const [item] = await (await pdf.getPage(1)).getAnnotations();
    expect(item.subtype).toBe("FreeText");
    await pdf.cleanup();

    const back = await annotation(await styleTextBox(oval, "tb", { shape: "rectangle" }));
    expect(back.nums("Rect")).toEqual([100, 100, 200, 140]);
    expect(back.nums("RD")).toBeUndefined();
    expect(back.dict.has(PDFName.of("NavPDFBorderShape"))).toBe(false);
    // The stored fill opacity is kept when only the shape changes.
    expect(back.alpha("GSFill")).toEqual({ CA: 0.3, ca: 0.3 });
  });

  it("refuses callouts, other comments and text Helvetica cannot show", async () => {
    const callout = await onePage({
      Subtype: "FreeText",
      NM: PDFString.of("c"),
      Rect: [0, 0, 100, 100],
      CL: [0, 0, 50, 50],
    });
    await expect(styleTextBox(callout, "c", { shape: "oval" })).rejects.toThrow(/Callouts/);
    const square = await onePage({ Subtype: "Square", NM: PDFString.of("s"), Rect: [0, 0, 9, 9] });
    await expect(styleTextBox(square, "s", { shape: "oval" })).rejects.toThrow(/text boxes/);
    const greek = await onePage({
      Subtype: "FreeText",
      NM: PDFString.of("g"),
      Rect: [0, 0, 100, 40],
      Contents: PDFString.of("Ωμέγα"),
    });
    await expect(styleTextBox(greek, "g", { shape: "oval" })).rejects.toThrow(/Helvetica/);
  });
});

describe("Moving and drawing helpers", () => {
  it("maps screen arrow directions through page rotation", () => {
    expect(screenToPageOffset(1, 0, 0)).toEqual([1, -0]);
    expect(screenToPageOffset(0, -1, 0)).toEqual([0, 1]);
    // Turned a quarter clockwise: screen right is PDF up, screen down is PDF right.
    expect(screenToPageOffset(1, 0, 90)).toEqual([0, 1]);
    expect(screenToPageOffset(0, 1, 90)).toEqual([1, 0]);
    expect(screenToPageOffset(1, 0, 180)).toEqual([-1, 0]);
    expect(screenToPageOffset(1, 0, 270)).toEqual([-0, -1]);
    expect(screenToPageOffset(0, 1, -90)).toEqual([-1, -0]);
  });

  it("keeps a point level or plumb with its anchor, whichever is nearer", () => {
    expect(orthoPoint([0, 0], [10, 3])).toEqual([10, 0]);
    expect(orthoPoint([0, 0], [2, -9])).toEqual([0, -9]);
  });
});

describe("Comment clipboard and selection", () => {
  it("pastes comments only while the system clipboard holds their text", () => {
    clearCommentClipboard();
    expect(pastesComments(null)).toBe(false);
    const marker = clipboardText(2, ["First", " ", "Second"]);
    expect(marker).toBe("First\n\nSecond\n\n(2 comments from NavPDF)");
    expect(clipboardText(1, [])).toBe("(1 comment from NavPDF)");
    setCommentClipboard({ bytes: new Uint8Array(), count: 2, page: 1, text: "" }, marker);
    expect(pastesComments(marker)).toBe(true);
    expect(pastesComments(null)).toBe(true);
    expect(pastesComments("something copied elsewhere")).toBe(false);
    expect([nextPasteOffset("a", 1), nextPasteOffset("a", 1), nextPasteOffset("a", 2)]).toEqual([
      0, 18, 0,
    ]);
    clearCommentClipboard();
  });

  it("treats a single selection set elsewhere as the whole selection", () => {
    expect(
      selectedCommentIds({ selectedAnnotationId: null, selectedAnnotationIds: ["a"] }),
    ).toEqual([]);
    expect(
      selectedCommentIds({ selectedAnnotationId: "c", selectedAnnotationIds: ["a", "b"] }),
    ).toEqual(["c"]);
    expect(
      selectedCommentIds({ selectedAnnotationId: "a", selectedAnnotationIds: ["a", "b"] }),
    ).toEqual(["b", "a"]);
  });
});

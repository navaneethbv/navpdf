import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import {
  AnnotationEditorType,
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  FREEHAND_HIGHLIGHT_OPACITY,
  installHighlightInterop,
} from "../../src/features/viewer/highlight-interop";
import {
  addFormField,
  addStickyNote,
  reorderPages,
  rotatePages,
  insertTextContent,
  applyDocumentDecorations,
  applyBatesNumbering,
  addLinkAnnotation,
  addEmbeddedAttachment,
  extractEmbeddedAttachment,
  extractPages,
  applyOcrSearchableLayer,
} from "../../src/services/document-commands";
import type { OcrPageResult } from "../../src/types/operations";
GlobalWorkerOptions.workerSrc = resolve(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
);
const options = {
  standardFontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
  useSystemFonts: false,
};
async function open(name: string) {
  return getDocument({
    ...options,
    data: new Uint8Array(await readFile(resolve("tests/pdf-fixtures", name))),
  }).promise;
}
beforeAll(async () => {
  await mkdir("output", { recursive: true });
});
describe("real PDF parsing and saving", () => {
  it.each([5, 100, 500, 1000])(
    "reads first and last pages of a %i-page PDF",
    async (count) => {
      const pdf = await open(`reader-${count}.pdf`);
      try {
        expect(pdf.numPages).toBe(count);
        for (const index of [1, count]) {
          const page = await pdf.getPage(index);
          const content = await page.getTextContent();
          const text = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          expect(text).toContain(`NEEDLE-${String(index).padStart(4, "0")}`);
        }
      } finally {
        await pdf.loadingTask.destroy();
      }
    },
  );
  it("saves a standard highlight and preserves all 500 pages and text", async () => {
    const pdf = await open("reader-500.pdf");
    try {
      pdf.annotationStorage.setValue("pdfjs_internal_editor_test", {
        annotationType: AnnotationEditorType.HIGHLIGHT,
        pageIndex: 0,
        rect: [54, 579, 340, 597],
        rotation: 0,
        color: [245, 207, 88],
        opacity: 1,
        quadPoints: [54, 597, 340, 597, 54, 579, 340, 579],
        outlines: [[54, 579, 340, 579, 340, 597, 54, 597]],
      });
      const bytes = await pdf.saveDocument();
      await writeFile("output/highlight-roundtrip.pdf", bytes);
      const reopened = await getDocument({ ...options, data: bytes }).promise;
      try {
        expect(reopened.numPages).toBe(500);
        const page = await reopened.getPage(1);
        const annotations = await page.getAnnotations();
        expect(annotations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ subtype: "Highlight" }),
          ]),
        );
        const text = (await page.getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        expect(text).toContain("persistent highlight");
        expect(text).toContain("NEEDLE-0001");
      } finally {
        await reopened.loadingTask.destroy();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
  it("saves freehand highlights with opacity readers without blend modes honor", async () => {
    const pdf = await open("reader-5.pdf");
    try {
      installHighlightInterop(pdf.annotationStorage);
      const common = {
        annotationType: AnnotationEditorType.HIGHLIGHT,
        rotation: 0,
        color: [245, 207, 88],
        opacity: 1,
        thickness: 12,
      };
      pdf.annotationStorage.setValue("pdfjs_internal_editor_free", {
        ...common,
        pageIndex: 0,
        rect: [52.24, 580.11, 349.35, 593.71],
        quadPoints: null,
        outlines: {
          outline: [
            NaN, NaN, NaN, NaN, 52.85, 580.9, NaN, NaN, NaN, NaN, 348.74,
            580.9, NaN, NaN, NaN, NaN, 348.74, 592.92, NaN, NaN, NaN, NaN,
            52.85, 592.92,
          ],
          points: [[52.85, 586.9, 348.74, 586.9]],
        },
      });
      pdf.annotationStorage.setValue("pdfjs_internal_editor_text", {
        ...common,
        pageIndex: 1,
        rect: [54, 579, 340, 597],
        quadPoints: [54, 597, 340, 597, 54, 579, 340, 579],
        outlines: [[54, 579, 340, 579, 340, 597, 54, 597]],
      });
      const bytes = await pdf.saveDocument();
      await writeFile("output/freehand-highlight-interop.pdf", bytes);

      const saved = await PDFDocument.load(bytes);
      const annotation = (pageIndex: number) =>
        saved
          .getPage(pageIndex)
          .node.lookup(PDFName.of("Annots"), PDFArray)
          .lookup(0, PDFDict);
      const number = (dict: PDFDict, key: string) =>
        dict.lookup(PDFName.of(key), PDFNumber).asNumber();

      const free = annotation(0);
      expect(free.get(PDFName.of("Subtype"))).toBe(PDFName.of("Ink"));
      expect(free.get(PDFName.of("IT"))).toBe(PDFName.of("InkHighlight"));
      expect(number(free, "CA")).toBe(FREEHAND_HIGHLIGHT_OPACITY);
      const appearance = free
        .lookup(PDFName.of("AP"), PDFDict)
        .lookup(PDFName.of("N"), PDFRawStream);
      const state = appearance.dict
        .lookup(PDFName.of("Resources"), PDFDict)
        .lookup(PDFName.of("ExtGState"), PDFDict)
        .lookup(PDFName.of("R0"), PDFDict);
      expect(number(state, "ca")).toBe(FREEHAND_HIGHLIGHT_OPACITY);
      expect(state.get(PDFName.of("BM"))).toBe(PDFName.of("Multiply"));
      const [red, green] = free
        .lookup(PDFName.of("C"), PDFArray)
        .asArray()
        .map((value) => (value as PDFNumber).asNumber());
      expect(0.5 + red * 0.5).toBeCloseTo(245 / 255, 2);
      expect(0.5 + green * 0.5).toBeCloseTo(207 / 255, 2);

      const text = annotation(1);
      expect(text.get(PDFName.of("Subtype"))).toBe(PDFName.of("Highlight"));
      expect(number(text, "CA")).toBe(1);

      const reopened = await getDocument({ ...options, data: bytes }).promise;
      try {
        expect(await (await reopened.getPage(1)).getAnnotations()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ subtype: "Ink", it: "InkHighlight" }),
          ]),
        );
        const pageText = (await (await reopened.getPage(1)).getTextContent())
          .items.map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        expect(pageText).toContain("persistent highlight");
      } finally {
        await reopened.loadingTask.destroy();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
  it("retains existing forms, comments, rotation, and mixed page dimensions", async () => {
    const pdf = await open("mixed-forms-annotations.pdf");
    try {
      expect(pdf.numPages).toBe(4);
      expect((await pdf.getPage(2)).rotate).toBe(90);
      expect((await pdf.getPage(3)).view).toEqual([0, 0, 400, 400]);
      const fields = await pdf.getFieldObjects();
      expect(fields?.get("ReaderName")?.[1]).toMatchObject({
        value: "Existing form value",
      });
      expect(await (await pdf.getPage(1)).getAnnotations()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subtype: "Text",
            contentsObj: expect.objectContaining({
              str: "A standard PDF note.",
            }),
          }),
        ]),
      );
      const saved = await pdf.saveDocument();
      const reopened = await getDocument({ ...options, data: saved }).promise;
      try {
        expect(
          (await reopened.getFieldObjects())?.get("ReaderName")?.[1],
        ).toMatchObject({ value: "Existing form value" });
      } finally {
        await reopened.loadingTask.destroy();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
  it("authors text, checkbox, radio group, dropdown, and button widgets and roundtrips their values", async () => {
    let bytes = new Uint8Array(
      await readFile(resolve("tests/pdf-fixtures/reader-5.pdf")),
    );
    bytes = await addFormField(bytes, {
      type: "text",
      name: "AuthorText",
      page: 1,
      x: 50,
      y: 600,
      width: 200,
      height: 24,
      defaultValue: "Hello NavPDF",
      required: true,
    });
    bytes = await addFormField(bytes, {
      type: "checkbox",
      name: "AgreedBox",
      page: 1,
      x: 50,
      y: 560,
      width: 20,
      height: 20,
      defaultValue: "true",
    });
    bytes = await addFormField(bytes, {
      type: "radio",
      name: "DeliveryGroup",
      group: "DeliveryGroup",
      page: 1,
      x: 50,
      y: 520,
      width: 20,
      height: 20,
      defaultValue: "Express",
    });
    bytes = await addFormField(bytes, {
      type: "radio",
      name: "DeliveryGroup",
      group: "DeliveryGroup",
      page: 1,
      x: 80,
      y: 520,
      width: 20,
      height: 20,
      defaultValue: "Standard",
    });
    bytes = await addFormField(bytes, {
      type: "dropdown",
      name: "PrioritySelect",
      page: 1,
      x: 50,
      y: 480,
      width: 150,
      height: 24,
      options: ["Low", "Medium", "High"],
      defaultValue: "High",
    });
    bytes = await addFormField(bytes, {
      type: "button",
      name: "SubmitBtn",
      page: 1,
      x: 50,
      y: 440,
      width: 80,
      height: 26,
      label: "Click Me",
    });

    // Verify with independent reader / parser pdf-lib
    const loaded = await PDFDocument.load(bytes);
    const form = loaded.getForm();
    expect(form.getTextField("AuthorText").getText()).toBe("Hello NavPDF");
    expect(form.getCheckBox("AgreedBox").isChecked()).toBe(true);
    expect(form.getRadioGroup("DeliveryGroup").getOptions()).toEqual(["Express", "Standard"]);
    expect(form.getDropdown("PrioritySelect").getSelected()).toEqual(["High"]);
    expect(form.getButton("SubmitBtn")).toBeTruthy();

    // Verify with PDF.js
    const doc = await getDocument({ ...options, data: bytes }).promise;
    try {
      expect(doc.numPages).toBe(5);
      const fields = await doc.getFieldObjects();
      expect(fields?.has("AuthorText")).toBe(true);
      expect(fields?.has("AgreedBox")).toBe(true);
      expect(fields?.has("PrioritySelect")).toBe(true);
      expect(fields?.has("DeliveryGroup")).toBe(true);
      expect(fields?.has("SubmitBtn")).toBe(true);
    } finally {
      await doc.loadingTask.destroy();
    }
  });
  it("rejects damaged PDFs with a parser error", async () => {
    await expect(open("damaged.pdf")).rejects.toMatchObject({
      name: "InvalidPDFException",
    });
  });
});
describe("special document corpus", () => {
  it("requests a password and rejects an incorrect password", async () => {
    const bytes = new Uint8Array(
      await readFile("tests/pdf-fixtures/encrypted.pdf"),
    );
    const task = getDocument({ ...options, data: bytes });
    const reasons: number[] = [];
    task.onPassword = (submit, reason) => {
      reasons.push(reason);
      submit(reason === 1 ? "incorrect" : "reader-fixture");
    };
    const pdf = await task.promise;
    try {
      expect(reasons).toEqual([1, 2]);
      expect(pdf.numPages).toBe(5);
      expect((await pdf.getMetadata()).info).toMatchObject({
        EncryptFilterName: "Standard",
      });
    } finally {
      await task.destroy();
    }
  });
  it("opens image-only scanned pages without inventing text", async () => {
    const pdf = await open("scanned-images.pdf");
    try {
      expect(pdf.numPages).toBe(12);
      const page = await pdf.getPage(12);
      expect((await page.getTextContent()).items).toHaveLength(0);
      expect((await page.getOperatorList()).fnArray.length).toBeGreaterThan(0);
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
  it("extracts embedded-font text and bookmarks", async () => {
    const pdf = await open("embedded-font.pdf");
    try {
      expect((await (await pdf.getPage(1)).getTextContent()).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            str: "Embedded font: café, résumé, naïve.",
          }),
        ]),
      );
      expect(await pdf.getOutline()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Embedded text" }),
        ]),
      );
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
  it("preserves declared structures and annotations through combined form fill, sticky note, reorder, rotate roundtrip", async () => {
    const rawBytes = new Uint8Array(
      await readFile(resolve("tests/pdf-fixtures/reader-5.pdf")),
    );
    const noted = await addStickyNote(rawBytes, {
      page: 1,
      x: 100,
      y: 500,
      contents: "Combined test note",
      author: "NavPDF",
      id: "note-combined-1",
    });
    const reordered = await reorderPages(noted, [1, 2, 3, 4, 0]);
    const rotated = await rotatePages(reordered, [0], 90);

    await writeFile("output/combined-workflow-roundtrip.pdf", rotated);

    const reopened = await getDocument({ ...options, data: rotated }).promise;
    try {
      expect(reopened.numPages).toBe(5);
      const page1 = await reopened.getPage(1);
      expect(page1.rotate).toBe(90);

      const page5 = await reopened.getPage(5);
      const annots = await page5.getAnnotations();
      expect(annots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subtype: "Text",
            contentsObj: expect.objectContaining({
              str: "Combined test note",
            }),
          }),
        ]),
      );
    } finally {
      await reopened.loadingTask.destroy();
    }
  });
  it("preserves inserted text, headers, bates numbering, links, and attachments across roundtrip", async () => {
    const rawBytes = new Uint8Array(
      await readFile(resolve("tests/pdf-fixtures/reader-5.pdf")),
    );

    // 1. Insert multiline text
    const withText = await insertTextContent(rawBytes, {
      page: 1,
      text: "Phase 5 Content Placement\nValidated multiline paragraph.",
      x: 54,
      y: 750,
      fontSize: 16,
      fontFamily: "Helvetica-Bold",
      alignment: "left",
      maxWidth: 400,
    });

    // 2. Apply document decorations (header/footer with tokens)
    const withDecorations = await applyDocumentDecorations(withText, {
      header: {
        left: "Confidential Doc",
        right: "Page {page} of {total}",
      },
      metadata: {
        title: "NavPDF Verified",
      },
    });

    // 3. Apply Bates numbering
    const batesResult = await applyBatesNumbering(withDecorations, {
      prefix: "BATCH-",
      startNumber: 501,
      padding: 5,
      position: "bottom-right",
    });
    expect(batesResult.manifest.items[0].batesNumber).toBe("BATCH-00501");

    // 4. Add Link annotation (safe external URL)
    const withLink = await addLinkAnnotation(batesResult.bytes, {
      page: 1,
      rect: [54, 480, 250, 510],
      target: {
        type: "url",
        url: "https://navpdf.org/docs",
      },
    });

    // 5. Add embedded attachment
    const attachmentContent = new Uint8Array([80, 68, 70, 45, 69, 100, 105, 116, 111, 114]);
    const withAttachment = await addEmbeddedAttachment(
      withLink,
      "audit-manifest.txt",
      attachmentContent,
      "Phase 5 audit record",
    );

    await writeFile(
      "output/phase5-placement-decoration-roundtrip.pdf",
      withAttachment,
    );

    // Verify independent extraction and structure
    const extractedData = await extractEmbeddedAttachment(
      withAttachment,
      "audit-manifest.txt",
    );
    expect(extractedData).not.toBeNull();
    expect(Array.from(extractedData!)).toEqual(Array.from(attachmentContent));

    const reopened = await getDocument({ ...options, data: withAttachment }).promise;
    try {
      expect(reopened.numPages).toBe(5);

      // Verify page 1 annotations contains Link
      const page1 = await reopened.getPage(1);
      const annots = await page1.getAnnotations();
      expect(annots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subtype: "Link",
            url: "https://navpdf.org/docs",
          }),
        ]),
      );

      // Verify text extraction includes inserted text and header
      const text = (await page1.getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      expect(text).toContain("Phase 5 Content Placement");
      expect(text).toContain("Confidential Doc");
      expect(text).toContain("BATCH-00501");
    } finally {
      await reopened.loadingTask.destroy();
    }
  });

  it("Phase 6 OCR searchable layer roundtrip on scanned fixture", async () => {
    const fixturePath = resolve("tests/pdf-fixtures/ocr-scans.pdf");
    const scanBytes = new Uint8Array(await readFile(fixturePath));

    // Initially, page 1 is an image-only scan with no digital text
    const initialDoc = await getDocument({ ...options, data: scanBytes.slice() }).promise;
    try {
      const page1 = await initialDoc.getPage(1);
      const text = (await page1.getTextContent()).items
        .map((i) => ("str" in i ? i.str : ""))
        .join(" ")
        .trim();
      expect(text).toBe("");
    } finally {
      await initialDoc.loadingTask.destroy();
    }

    // Apply OCR searchable layer
    const ocrResult: OcrPageResult = {
      pageIndex: 0,
      language: "en-US",
      lines: [
        {
          text: "NavPDF Local OCR Workspace",
          confidence: 0.98,
          bbox: [0.08, 0.85, 0.82, 0.04],
          words: [
            { text: "NavPDF", confidence: 0.99, bbox: [0.08, 0.85, 0.2, 0.04] },
            { text: "Local", confidence: 0.98, bbox: [0.3, 0.85, 0.15, 0.04] },
            { text: "OCR", confidence: 0.99, bbox: [0.47, 0.85, 0.12, 0.04] },
            { text: "Workspace", confidence: 0.98, bbox: [0.61, 0.85, 0.28, 0.04] },
          ],
        },
      ],
      fullText: "NavPDF Local OCR Workspace",
      meanConfidence: 0.98,
    };

    const searchablePdf = await applyOcrSearchableLayer(scanBytes, [ocrResult]);

    // Reopen in PDF.js and verify text is now searchable and indexed
    const reopened = await getDocument({ ...options, data: searchablePdf }).promise;
    try {
      const page1 = await reopened.getPage(1);
      const text = (await page1.getTextContent()).items
        .map((i) => ("str" in i ? i.str : ""))
        .join(" ");

      expect(text).toContain("NavPDF");
      expect(text).toContain("Local");
      expect(text).toContain("OCR");
      expect(text).toContain("Workspace");
    } finally {
      await reopened.loadingTask.destroy();
    }
  });

  it("extracts a single page from a document with cross-page links without leaking unreferenced pages (DS-03)", async () => {
    const doc = await PDFDocument.create();
    const page1 = doc.addPage([300, 400]);
    const page2 = doc.addPage([300, 400]);

    // Cross-page link on page 1 targeting page 2
    const dest = doc.context.obj([
      page2.ref,
      PDFName.of("XYZ"),
      PDFNumber.of(0),
      PDFNumber.of(0),
      PDFNumber.of(0),
    ]);
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 50, 20],
      Dest: dest,
    });
    const linkRef = doc.context.register(link);
    page1.node.set(PDFName.of("Annots"), doc.context.obj([linkRef]));

    const inputBytes = await doc.save();
    const extractedBytes = await extractPages(inputBytes, [0]);

    // Verify extracted document has exactly 1 page dictionary in its saved objects
    const extractedDoc = await PDFDocument.load(extractedBytes);
    expect(extractedDoc.getPageCount()).toBe(1);

    const pageObjectCount = extractedDoc.context
      .enumerateIndirectObjects()
      .filter(([, obj]) => {
        if (obj instanceof PDFDict) {
          const type = obj.lookupMaybe(PDFName.of("Type"), PDFName);
          return type?.asString() === "/Page";
        }
        return false;
      }).length;
    expect(pageObjectCount).toBe(1);
  });
});

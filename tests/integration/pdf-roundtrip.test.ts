import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AnnotationEditorType,
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
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
});

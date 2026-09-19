import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { imageFileToPdf, imageHeader } from "../../src/features/pages/image-import";
import { mergeDocuments } from "../../src/services/document-commands";
GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

describe("image imports produce portable PDF pages", () => {
  it("combines PNG and JPEG pages in order with their aspect ratios and visible image operators", async () => {
    const png = await sharp({
      create: { width: 320, height: 160, channels: 3, background: "#eeba22" },
    })
      .png()
      .toBuffer();
    const jpeg = await sharp({
      create: { width: 100, height: 300, channels: 3, background: "#254879" },
    })
      .jpeg()
      .toBuffer();
    const files = [new File([png], "landscape.png"), new File([jpeg], "portrait.jpg")];
    const imported = await Promise.all(files.map(imageFileToPdf));
    const bytes = await mergeDocuments(imported);
    await mkdir("output", { recursive: true });
    await writeFile("output/workspace-image-import.pdf", bytes);
    await writeFile("output/workspace-import-yellow.png", png);
    await writeFile("output/workspace-import-blue.jpg", jpeg);
    const task = getDocument({ data: bytes });
    const pdf = await task.promise;
    try {
      expect(pdf.numPages).toBe(2);
      const first = await pdf.getPage(1),
        second = await pdf.getPage(2);
      expect(first.view).toEqual([0, 0, 240, 120]);
      expect(second.view).toEqual([0, 0, 75, 225]);
      for (const page of [first, second]) {
        const operators = await page.getOperatorList();
        expect(operators.fnArray).toContain(OPS.paintImageXObject);
      }
    } finally {
      await task.destroy();
    }
  });

  it("rejects malformed and oversized image headers before decoding", async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    png.writeUInt32BE(50000, 16);
    await expect(imageFileToPdf(new File([png], "huge.png"))).rejects.toThrow("32 megapixels");
    expect(() => imageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xff]))).toThrow(
      "valid PNG or JPEG",
    );
    expect(() => imageHeader(new Uint8Array([1, 2, 3]))).toThrow("valid PNG or JPEG");
    await expect(
      imageFileToPdf(new File([new Uint8Array(26 * 1024 * 1024)], "big.jpg")),
    ).rejects.toThrow("25 MB");
  });
});

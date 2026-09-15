import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { requireFixture } from "../helpers/fixtures";
import { describe, expect, it } from "vitest";
import { readMetadata, writeMetadata } from "../../src/services/pdf/metadata";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

describe("PDF metadata", () => {
  it("reads Info metadata without changing the source", async () => {
    const source = new Uint8Array(await readFile(requireFixture("reader-5.pdf")));
    const metadata = await readMetadata(source);
    expect(metadata.title).toBe("NavPDF reader fixture: 5 pages");
    expect(metadata.author).toBe("NavPDF test suite");
    expect(metadata.keywords).toEqual([]);
  });

  it("writes synchronized Info and XMP metadata while preserving pages", async () => {
    const source = new Uint8Array(await readFile(requireFixture("reader-5.pdf")));
    const changed = await writeMetadata(source, {
      title: "Updated title",
      author: "Updated author",
      subject: "Updated subject",
      keywords: ["alpha", "beta"],
      creator: "NavPDF",
      producer: "NavPDF test",
    });
    const metadata = await readMetadata(changed);
    const doc = await PDFDocument.load(changed, { updateMetadata: false });
    const metadataStream = doc.catalog.lookup(PDFName.of("Metadata"), PDFRawStream);
    const xmp = new TextDecoder().decode(inflateSync(metadataStream.getContents()));
    expect(metadata.title).toBe("Updated title");
    expect(metadata.author).toBe("Updated author");
    expect(metadata.keywords).toEqual(["alpha", "beta"]);
    expect(xmp).toContain("<dc:title>");
    expect(xmp).toContain("Updated title");
    expect(xmp).toContain("<pdf:Keywords>alpha, beta</pdf:Keywords>");
  });
});

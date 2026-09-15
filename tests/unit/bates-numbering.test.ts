import { describe, it, expect, beforeEach } from "vitest";
import { createBlankDocument, applyBatesNumbering } from "../../src/services/document-commands";
import { PDFDocument } from "pdf-lib";

describe("applyBatesNumbering", () => {
  let samplePdf: Uint8Array;

  beforeEach(async () => {
    samplePdf = await createBlankDocument(4, 612, 792);
  });

  it("applies sequential bates numbers and returns structured manifest", async () => {
    const result = await applyBatesNumbering(samplePdf, {
      prefix: "CASE-2026-",
      suffix: "-CONF",
      startNumber: 101,
      padding: 6,
      position: "bottom-right",
    });

    expect(result.bytes.length).toBeGreaterThan(samplePdf.length);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(4);

    expect(result.manifest.prefix).toBe("CASE-2026-");
    expect(result.manifest.suffix).toBe("-CONF");
    expect(result.manifest.startNumber).toBe(101);
    expect(result.manifest.padding).toBe(6);
    expect(result.manifest.items).toHaveLength(4);

    expect(result.manifest.items[0]).toEqual({
      pageIndex: 0,
      pageNumber: 1,
      batesNumber: "CASE-2026-000101-CONF",
    });
    expect(result.manifest.items[1]).toEqual({
      pageIndex: 1,
      pageNumber: 2,
      batesNumber: "CASE-2026-000102-CONF",
    });
    expect(result.manifest.items[3]).toEqual({
      pageIndex: 3,
      pageNumber: 4,
      batesNumber: "CASE-2026-000104-CONF",
    });
  });

  it("applies bates numbers only to selected page indices", async () => {
    const result = await applyBatesNumbering(samplePdf, {
      prefix: "LEGAL-",
      startNumber: 1,
      padding: 4,
      pageIndices: [1, 3], // pages 2 and 4
      position: "top-right",
    });

    expect(result.manifest.items).toHaveLength(2);
    expect(result.manifest.items[0]).toEqual({
      pageIndex: 1,
      pageNumber: 2,
      batesNumber: "LEGAL-0001",
    });
    expect(result.manifest.items[1]).toEqual({
      pageIndex: 3,
      pageNumber: 4,
      batesNumber: "LEGAL-0002",
    });
  });

  it("supports multiple positions across pages", async () => {
    for (const pos of ["top-left", "bottom-center", "bottom-left"] as const) {
      const result = await applyBatesNumbering(samplePdf, {
        prefix: "P-",
        startNumber: 1,
        position: pos,
      });
      expect(result.manifest.items).toHaveLength(4);
    }
  });
});

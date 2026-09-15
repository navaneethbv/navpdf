import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { requireFixture } from "../helpers/fixtures";
const reads = vi.hoisted(() => ({
  bytes: new Uint8Array(),
  requests: [] as [number, number][],
}));
vi.mock("../../src/services/native", () => ({
  readRange: async (_id: string, begin: number, end: number) => {
    reads.requests.push([begin, end]);
    if (end - begin > 4 * 1024 * 1024) throw new Error("Range exceeded native limit");
    return reads.bytes.slice(begin, end);
  },
}));
import { loadPdf, LocalRangeTransport } from "../../src/services/pdf";
GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
describe("local byte range transport", () => {
  it("delivers coalesced ranges as one response while bounding native reads", async () => {
    reads.bytes = new Uint8Array(3 * 1024 * 1024 + 33);
    reads.bytes[reads.bytes.length - 1] = 91;
    reads.requests = [];
    const result = Promise.withResolvers<{
      begin: number;
      chunk: Uint8Array;
    }>();
    const transport = new LocalRangeTransport(
      { id: "test", name: "large.pdf", size: reads.bytes.length },
      new Uint8Array(),
      result.reject,
    );
    transport.transportReady((event: { type: string; begin: number; chunk: Uint8Array }) => {
      if (event.type === "range") result.resolve(event);
    });
    transport.requestDataRange(0, reads.bytes.length);
    const response = await result.promise;
    expect(response.begin).toBe(0);
    expect(response.chunk).toHaveLength(reads.bytes.length);
    expect(response.chunk.at(-1)).toBe(91);
    expect(reads.requests).toHaveLength(4);
    expect(reads.requests.every(([begin, end]) => end - begin <= 1024 * 1024)).toBe(true);
  });
  it("loads and extracts remote pages through the same range adapter as the desktop app", async () => {
    reads.bytes = new Uint8Array(await readFile(requireFixture("reader-1000.pdf")));
    reads.requests = [];
    const errors: Error[] = [];
    const task = await loadPdf(
      { id: "test", name: "reader-1000.pdf", size: reads.bytes.length },
      () => {},
      (error) => errors.push(error),
    );
    try {
      const pdf = await task.promise;
      expect(pdf.numPages).toBe(1000);
      const page = await pdf.getPage(1000);
      const text = (await page.getTextContent({ disableNormalization: true })).items
        .map((item) => ("str" in item ? item.str : ""))
        .join("");
      expect(text).toContain("NEEDLE-1000");
      expect(reads.requests.length).toBeGreaterThan(1);
      expect(errors).toEqual([]);
    } finally {
      await task.destroy();
    }
  });
});

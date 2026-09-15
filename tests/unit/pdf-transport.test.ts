import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

const source = { bytes: new Uint8Array() };

vi.mock("../../src/services/native", () => ({
  readRange: vi.fn(async (id: string, begin: number, end: number) => {
    if (id !== "doc") throw new Error("unknown document");
    return source.bytes.slice(begin, end);
  }),
}));

import { LocalRangeTransport, loadPdf } from "../../src/services/pdf";

beforeAll(async () => {
  source.bytes = new Uint8Array(await readFile(resolve("tests/pdf-fixtures/reader-5.pdf")));
});

describe("LocalRangeTransport", () => {
  it("assembles coalesced range requests from bounded native reads", async () => {
    const { readRange } = await import("../../src/services/native");
    const descriptor = { id: "doc", name: "reader-5.pdf", size: source.bytes.length };
    const initial = source.bytes.slice(0, 65536);
    const received: { begin: number; chunk: Uint8Array }[] = [];
    const transport = new LocalRangeTransport(
      descriptor,
      initial as Uint8Array<ArrayBuffer>,
      () => {},
    );
    transport.onDataRange = (begin: number, chunk: Uint8Array) => {
      received.push({ begin, chunk });
    };
    transport.onDataProgress = () => {};
    transport.requestDataRange(0, source.bytes.length);
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0].begin).toBe(0);
    expect(received[0].chunk).toEqual(source.bytes);
    expect(vi.mocked(readRange).mock.calls.some(([, , end]) => end - 0 > 0)).toBe(true);
  });

  it("reports transport failures and honors abort", async () => {
    const failures: Error[] = [];
    const transport = new LocalRangeTransport(
      { id: "missing", name: "x.pdf", size: 10 },
      new Uint8Array(10) as Uint8Array<ArrayBuffer>,
      (error) => failures.push(error),
    );
    transport.onDataRange = () => {};
    transport.onDataProgress = () => {};
    transport.requestDataRange(0, 10);
    await vi.waitFor(() => {
      expect(failures).toHaveLength(1);
    });
    expect(failures[0].message).toBe("unknown document");
    transport.abort();
    transport.requestDataRange(0, 10);
  });

  it("loads a document task through the range transport", async () => {
    const descriptor = { id: "doc", name: "reader-5.pdf", size: source.bytes.length };
    const task = await loadPdf(
      descriptor,
      () => {},
      () => {},
    );
    expect(task).toBeTruthy();
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(5);
    await task.destroy();
  });
});

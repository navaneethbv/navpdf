import { describe, expect, it, vi } from "vitest";
import { allPageNumbers, pagesInOrder } from "../../src/utils/pdf-pages";

describe("pagesInOrder", () => {
  it("yields the requested pages with their numbers in order", async () => {
    const pdf = { getPage: vi.fn(async (number: number) => `page ${number}`) };
    const seen: (readonly [number, string])[] = [];
    for await (const entry of pagesInOrder(pdf, [3, 1, 2])) seen.push(entry);
    expect(seen).toEqual([
      [3, "page 3"],
      [1, "page 1"],
      [2, "page 2"],
    ]);
  });

  it("does not load pages after the caller stops", async () => {
    const pdf = { getPage: vi.fn(async (number: number) => number) };
    for await (const [number] of pagesInOrder(pdf, allPageNumbers(5))) {
      if (number === 2) break;
    }
    expect(pdf.getPage.mock.calls.map(([number]) => number)).toEqual([1, 2]);
  });
});

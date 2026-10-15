import { describe, expect, it } from "vitest";
import {
  inspectDocument,
  insightsCsv,
  type InsightsSource,
} from "../../src/features/document/document-insights";

function source(texts: (string | Error)[]): InsightsSource {
  return {
    numPages: texts.length,
    async getPage(number) {
      return {
        rotate: 0,
        getViewport: () => ({ width: 612, height: 792 }),
        async getTextContent() {
          const text = texts[number - 1];
          if (text instanceof Error) throw text;
          return { items: [{ str: text }, { type: "beginMarkedContent" }] };
        },
      };
    },
  };
}

describe("document insights", () => {
  it("counts Unicode code points without whitespace and reports selected textless pages", async () => {
    const result = await inspectDocument(source(["excluded", "Café 😀 日本語 é", " \n\t"]), [1, 2]);
    expect(result).toMatchObject({ words: 4, characters: 10, textlessPages: [3], failedPages: [] });
    expect(
      result.pages.map((page) => [page.page, page.words, page.characters, page.textStatus]),
    ).toEqual([
      [2, 4, 10, "text"],
      [3, 0, 0, "textless"],
    ]);
    expect(JSON.stringify(result)).not.toContain("Café");
  });

  it("keeps readable geometry when text fails and distinguishes unavailable pages from textless ones", async () => {
    const pdf = source(["", new Error("text failure"), "readable"]);
    const getPage = pdf.getPage;
    pdf.getPage = async (number) => {
      if (number === 1) throw new Error("page failure");
      return getPage(number);
    };
    const result = await inspectDocument(pdf, [0, 1, 2]);
    expect(result.failedPages).toEqual([1, 2]);
    expect(result.textlessPages).toEqual([]);
    expect(result.words).toBe(1);
    expect(result.pages[0]).toMatchObject({ width: null, height: null, textStatus: "unavailable" });
    expect(result.pages[1]).toMatchObject({ width: 612, height: 792, textStatus: "unavailable" });
  });

  it("stops after an in-flight page when cancelled and never loads the next page", async () => {
    let finish: (() => void) | undefined;
    let started = false;
    const visited: number[] = [];
    const abort = new AbortController();
    const pdf = source(["one", "two"]);
    const original = pdf.getPage;
    pdf.getPage = async (number) => {
      visited.push(number);
      const page = await original(number);
      page.getTextContent = async () => {
        started = true;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { items: [{ str: "late result" }] };
      };
      return page;
    };
    const pending = inspectDocument(pdf, [0, 1], { signal: abort.signal }).catch(
      (cause: unknown) => cause,
    );
    await expect.poll(() => started).toBe(true);
    abort.abort();
    finish!();
    await expect(pending).resolves.toMatchObject({ name: "AbortError" });
    expect(visited).toEqual([1]);
  });

  it("reports progress in selected-page order and checks stale source cancellation between pages", async () => {
    const progress: number[] = [];
    const result = inspectDocument(source(["first", "second"]), [0, 1], {
      isCancelled: () => progress.length === 1,
      onProgress: (completed) => progress.push(completed),
    });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(progress).toEqual([1]);
  });

  it.each([[], [-1], [3], [0.5], [Number.NaN], [0, 0]].map((indices) => [indices]))(
    "rejects an invalid selection %j",
    async (indices) => {
      await expect(inspectDocument(source(["one", "two"]), indices)).rejects.toThrow(
        /page selection/i,
      );
    },
  );

  it("exports counts and geometry without source text", async () => {
    const result = await inspectDocument(source(["=secret", ""]), [0, 1]);
    const csv = insightsCsv(result);
    expect(csv).toContain(
      "Page,Words,Characters (excluding whitespace),Text layer,Width (pt),Height (pt),Rotation (degrees),Orientation",
    );
    expect(csv).toContain("1,1,7,Text present,612,792,0,Portrait");
    expect(csv).toContain("2,0,0,Textless,612,792,0,Portrait");
    expect(csv).not.toContain("=secret");
  });
});

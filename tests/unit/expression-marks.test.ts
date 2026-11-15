import { describe, expect, it } from "vitest";
import { findExpressionMarks, type FindInPages } from "../../src/features/redact/redaction-marks";
import { luhnValid } from "../../src/features/redact/sensitive-patterns";

/** A text item 10 points per character wide on a baseline at (x, y). */
const item = (str: string, x: number, y: number) => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: str.length * 10,
  height: 10,
});

const pdf = (pages: ReturnType<typeof item>[][]) => ({
  numPages: pages.length,
  getPage: async (page: number) => ({
    getTextContent: async () => ({ items: pages[page - 1] }),
  }),
});

/** Stands in for the native finder, which is tested in the engine. */
const finder =
  (expression: RegExp, seen: string[] = []): FindInPages =>
  async (texts) => {
    seen.push(...texts);
    return texts.map((text) =>
      [...text.matchAll(expression)].map((match) => [match.index, match.index + match[0].length]),
    );
  };

describe("marks from a typed expression", () => {
  it("joins a page's text items by one space and never crosses a page", async () => {
    const seen: string[] = [];
    const marks = await findExpressionMarks(
      pdf([[item("Case", 100, 700), item("AB-1234 closed", 100, 680)], [item("AB-", 50, 500)]]),
      finder(/Case AB-\d{4}/g, seen),
    );
    expect(seen).toEqual(["Case AB-1234 closed", "AB-"]);
    // One match over two items gives one rectangle on each, both on page 1.
    expect(marks.map((mark) => [mark.page, mark.kind, mark.text])).toEqual([
      [1, "custom", "Case AB-1234"],
      [1, "custom", "Case AB-1234"],
    ]);
    const [first, second] = marks.map((mark) => mark.rect);
    expect(first[1]).toBeGreaterThan(second[3]);
    // The second rectangle covers "AB-1234" and stops before " closed".
    expect(second[0]).toBeLessThanOrEqual(100);
    expect(second[2]).toBeGreaterThanOrEqual(170);
    expect(second[2]).toBeLessThan(185);
  });

  it("keeps only matches a check accepts", async () => {
    const digits = (text: string) => luhnValid(text.replaceAll(/\D/g, ""));
    const marks = await findExpressionMarks(
      pdf([[item("4111 1111 1111 1111 and 4111 1111 1111 1112", 72, 700)]]),
      finder(/\d{4}(?: \d{4}){3}/g),
      digits,
    );
    expect(marks.map((mark) => mark.text)).toEqual(["4111 1111 1111 1111"]);
  });

  it("marks nothing for pages without matches or text", async () => {
    expect(await findExpressionMarks(pdf([[], [item("plain", 0, 0)]]), finder(/\d+/g))).toEqual([]);
  });
});

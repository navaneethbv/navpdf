import { describe, expect, it } from "vitest";
import type { PageLayout } from "../../src/features/convert/ooxml";
import { buildMarkdown, escapeMarkdown } from "../../src/features/convert/formats";
import { changeKind, filterComparison } from "../../src/features/compare/compare-pdf";

function page(number: number, paragraphs: PageLayout["paragraphs"]): PageLayout {
  return { page: number, width: 612, height: 792, lines: [], paragraphs };
}

describe("Markdown export", () => {
  it("writes headings, paragraphs and a rule between pages", () => {
    const markdown = buildMarkdown(
      [
        page(1, [
          { text: "Overview", heading: 1 },
          { text: "First   paragraph\nwrapped", heading: 0 },
        ]),
        page(2, [
          { text: "Details", heading: 2 },
          { text: "", heading: 0 },
        ]),
      ],
      "Report",
    );
    expect(markdown).toBe(
      "# Report\n\n## Overview\n\nFirst paragraph wrapped\n\n---\n\n### Details\n",
    );
  });

  it("escapes text that CommonMark would read as markup", () => {
    expect(escapeMarkdown("*bold* _it_ `code` [link](x) <b> a|b & c!")).toBe(
      String.raw`\*bold\* \_it\_ \`code\` \[link\](x) \<b\> a\|b \& c\!`,
    );
    expect(escapeMarkdown("# not a heading")).toBe(String.raw`\# not a heading`);
    expect(escapeMarkdown("- not a list")).toBe(String.raw`\- not a list`);
    expect(escapeMarkdown("> not a quote")).toBe(String.raw`\> not a quote`);
    expect(escapeMarkdown("12. not numbered")).toBe(String.raw`12\. not numbered`);
    expect(escapeMarkdown(String.raw`back\slash`)).toBe(String.raw`back\\slash`);
    expect(escapeMarkdown("plain text 3.5")).toBe("plain text 3.5");
  });

  it("escapes the title", () => {
    expect(buildMarkdown([], "*draft*").startsWith(String.raw`# \*draft\*`)).toBe(true);
  });
});

describe("Compare filters", () => {
  const signatures: [{ text: string; key: string }[], { text: string; key: string }[]] = [
    [
      { text: "same", key: "a" },
      { text: "old", key: "b" },
      { text: "kept", key: "c" },
    ],
    [
      { text: "same", key: "a" },
      { text: "new", key: "b2" },
      { text: "kept", key: "c2" },
    ],
  ];
  const rows = [
    { before: 1, after: 1, status: "unchanged" as const },
    { before: 2, after: 2, status: "changed" as const },
    { before: 3, after: 3, status: "changed" as const },
    { before: null, after: 4, status: "added" as const },
  ];

  it("classifies changed pairs by whether their text differs", () => {
    expect(changeKind(rows[0], signatures)).toBeNull();
    expect(changeKind(rows[1], signatures)).toBe("text");
    expect(changeKind(rows[2], signatures)).toBe("visual");
    expect(changeKind(rows[3], signatures)).toBeNull();
  });

  it("lists only the kinds of change shown, keeping added and removed pages", () => {
    const pages = (text: boolean, visual: boolean, only: boolean) =>
      filterComparison(rows, signatures, { text, visual }, only).map((row) => row.after);
    expect(pages(true, true, false)).toEqual([1, 2, 3, 4]);
    expect(pages(true, true, true)).toEqual([2, 3, 4]);
    expect(pages(false, true, true)).toEqual([3, 4]);
    expect(pages(true, false, true)).toEqual([2, 4]);
    expect(pages(false, false, false)).toEqual([1, 4]);
  });
});

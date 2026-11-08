// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { runsToHtml, selectionHtml } from "../../src/features/viewer/copy-layout";

function page(number: number, lines: [number, string, number][]) {
  const element = document.createElement("div");
  element.className = "page";
  element.dataset.pageNumber = String(number);
  const layer = document.createElement("div");
  layer.className = "textLayer";
  for (const [top, text, size] of lines) {
    const span = document.createElement("span");
    span.setAttribute("role", "presentation");
    span.style.top = `${top}%`;
    span.style.setProperty("--font-height", `${size}px`);
    span.style.fontFamily = "serif";
    span.textContent = text;
    layer.append(span);
  }
  element.append(layer);
  document.body.append(element);
  return layer;
}

describe("Copying page text with its layout", () => {
  it("keeps lines, paragraphs, sizes and fonts and escapes markup", () => {
    expect(
      runsToHtml([
        { page: "1", top: 10, text: "Title <b>", size: 18, family: "serif" },
        { page: "1", top: 14, text: "First line", size: 10, family: "serif" },
        { page: "1", top: 16, text: "second line", size: 10, family: "serif" },
        { page: "1", top: 24, text: "Next paragraph", size: 10, family: "serif" },
        { page: "2", top: 5, text: "Page two", size: 10, family: 'x";color:red' },
      ]),
    ).toBe(
      [
        '<p><span style="font-size:18pt;font-family:serif">Title &lt;b&gt;</span><br>' +
          '<span style="font-size:10pt;font-family:serif">First line</span><br>' +
          '<span style="font-size:10pt;font-family:serif">second line</span></p>',
        '<p><span style="font-size:10pt;font-family:serif">Next paragraph</span></p>',
        '<p><span style="font-size:10pt;font-family:xcolorred">Page two</span></p>',
      ].join("\n"),
    );
  });

  it("builds HTML from a selection across spans, trimmed to the selected characters", () => {
    document.body.replaceChildren();
    const layer = page(1, [
      [10, "Hello world", 12],
      [13, "Goodbye now", 12],
    ]);
    const [first, second] = layer.querySelectorAll("span");
    const range = document.createRange();
    range.setStart(first.firstChild!, 6);
    range.setEnd(second.firstChild!, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const html = selectionHtml(selection)!;
    expect(html).toContain(">world</span><br>");
    expect(html).toContain(">Goodbye</span>");
    expect(html).not.toContain("Hello");
    // Selections outside page text are left to the default copy.
    const outside = document.createElement("p");
    outside.textContent = "plain";
    document.body.append(outside);
    const other = document.createRange();
    other.selectNodeContents(outside);
    selection.removeAllRanges();
    selection.addRange(other);
    expect(selectionHtml(selection)).toBeNull();
  });
});

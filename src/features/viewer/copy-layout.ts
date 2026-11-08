// HTML for text copied from page text layers: paragraphs, line breaks, font sizes and families,
// so a word processor keeps the text's shape. Bold, italic and colour are not in the text layer.

interface Run {
  page: string;
  top: number;
  text: string;
  size: number;
  family: string;
}

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** A CSS font-family list without characters that could end the style attribute. */
const safeFamily = (family: string) => family.replaceAll(/[^\w\s,'-]/g, "").slice(0, 200);

/** The selected part of each text-layer span the range touches, in document order. */
function selectedRuns(range: Range): Run[] {
  const spans = [...document.querySelectorAll<HTMLElement>(".textLayer span[role='presentation']")];
  const runs: Run[] = [];
  for (const span of spans) {
    if (!range.intersectsNode(span)) continue;
    let text = span.textContent ?? "";
    const node = span.firstChild;
    if (node && range.endContainer === node) text = text.slice(0, range.endOffset);
    if (node && range.startContainer === node) text = text.slice(range.startOffset);
    if (!text) continue;
    const page = span.closest<HTMLElement>(".page")?.dataset.pageNumber ?? "";
    runs.push({
      page,
      top: Number.parseFloat(span.style.top) || 0,
      text,
      size: Number.parseFloat(span.style.getPropertyValue("--font-height")) || 0,
      family: span.style.fontFamily,
    });
  }
  return runs;
}

/** Groups runs into lines and lines into paragraphs by their vertical position. */
export function runsToHtml(runs: Run[]): string {
  if (!runs.length) return "";
  const paragraphs: string[][] = [[]];
  let line: Run[] = [];
  let previousTop = runs[0].top;
  let previousPitch = 0;
  const flush = () => {
    if (!line.length) return;
    const parts: string[] = [];
    for (const run of line) {
      const style = [
        run.size > 0 ? `font-size:${Math.round(run.size * 10) / 10}pt` : "",
        run.family ? `font-family:${safeFamily(run.family)}` : "",
      ]
        .filter(Boolean)
        .join(";");
      parts.push(
        style ? `<span style="${style}">${escapeHtml(run.text)}</span>` : escapeHtml(run.text),
      );
    }
    paragraphs.at(-1)!.push(parts.join(""));
    line = [];
  };
  for (const [index, run] of runs.entries()) {
    const previous = runs[index - 1];
    const sameLine =
      previous && previous.page === run.page && Math.abs(run.top - previousTop) < 0.6;
    if (!sameLine && previous) {
      const pitch = run.top - previousTop;
      flush();
      // A page change or a gap well beyond the usual line spacing starts a new paragraph.
      if (
        previous.page !== run.page ||
        pitch < 0 ||
        (previousPitch > 0 && pitch > previousPitch * 1.6)
      )
        paragraphs.push([]);
      else previousPitch = previousPitch ? Math.min(previousPitch, pitch) : pitch;
      previousTop = run.top;
    }
    line.push(run);
  }
  flush();
  return paragraphs
    .filter((lines) => lines.length)
    .map((lines) => `<p>${lines.join("<br>")}</p>`)
    .join("\n");
}

/** HTML for the current selection when it lies in page text, or null. */
export function selectionHtml(selection: Selection | null): string | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start = range.startContainer.parentElement;
  if (!start?.closest(".textLayer")) return null;
  const html = runsToHtml(selectedRuns(range));
  return html ? `<meta charset="utf-8">${html}` : null;
}

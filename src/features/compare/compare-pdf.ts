import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PageSignature {
  text: string;
  key: string;
}
export interface ComparedPage {
  before: number | null;
  after: number | null;
  status: "unchanged" | "changed" | "added" | "removed";
}

export async function renderComparisonPage(
  pdf: PDFDocumentProxy,
  number: number,
  edge = 700,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(number);
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: Math.min(2, edge / Math.max(natural.width, natural.height)),
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Comparison canvas unavailable.");
  await page.render({ canvas, canvasContext: context, viewport, background: "white" }).promise;
  return canvas;
}

export async function pageSignatures(
  pdf: PDFDocumentProxy,
  cancelled: () => boolean,
  progress: (page: number) => void,
): Promise<PageSignature[]> {
  if (pdf.numPages > 500) throw new Error("Compare supports up to 500 pages per document.");
  const signatures: PageSignature[] = [];
  let totalCharacters = 0;
  for (let number = 1; number <= pdf.numPages; number++) {
    if (cancelled()) throw new Error("Comparison cancelled.");
    progress(number);
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
      .join("")
      .trim();
    totalCharacters += text.length;
    if (totalCharacters > 10_000_000)
      throw new Error("Document text exceeds the comparison limit.");
    if (text.length > 200_000) throw new Error("A page contains too much text to compare safely.");
    const canvas = await renderComparisonPage(pdf, number, 250);
    try {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(pixels));
      const visual = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const viewport = page.getViewport({ scale: 1 });
      signatures.push({ text, key: `${viewport.width}:${viewport.height}:${text}:${visual}` });
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return signatures;
}

/** Align exact pages first so an insertion does not mark every following page changed. */
export function alignPages(before: PageSignature[], after: PageSignature[]): ComparedPage[] {
  if (before.length > 500 || after.length > 500) throw new Error("Comparison page limit exceeded.");
  const lengths = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(after.length + 1),
  );
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      lengths[i][j] =
        before[i].key === after[j].key
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const anchors: [number, number][] = [];
  let i = 0,
    j = 0;
  while (i < before.length && j < after.length) {
    if (before[i].key === after[j].key) {
      anchors.push([i++, j++]);
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  const rows: ComparedPage[] = [];
  let a = 0,
    b = 0;
  for (const [nextA, nextB] of [...anchors, [before.length, after.length]]) {
    while (a < nextA || b < nextB) {
      const left = a < nextA ? a++ : null,
        right = b < nextB ? b++ : null;
      rows.push({
        before: left === null ? null : left + 1,
        after: right === null ? null : right + 1,
        status: left === null ? "added" : right === null ? "removed" : "changed",
      });
    }
    if (nextA < before.length) {
      rows.push({ before: ++a, after: ++b, status: "unchanged" });
    }
  }
  return rows;
}

export function changedText(
  before: string,
  after: string,
): { prefix: string; before: string; after: string; suffix: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    prefix: before.slice(0, start),
    before: before.slice(start, before.length - end),
    after: after.slice(start, after.length - end),
    suffix: end ? before.slice(-end) : "",
  };
}

export function visualDifference(before: HTMLCanvasElement, after: HTMLCanvasElement): string {
  const width = Math.max(before.width, after.width),
    height = Math.max(before.height, after.height);
  const make = (source: HTMLCanvasElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0);
    return { canvas, context, pixels: context.getImageData(0, 0, width, height).data };
  };
  const left = make(before),
    right = make(after);
  try {
    right.context.fillStyle = "rgba(220, 45, 75, 0.4)";
    for (let y = 0; y < height; y += 8)
      for (let x = 0; x < width; x += 8) {
        let changed = false;
        for (let yy = y; yy < Math.min(y + 8, height) && !changed; yy++)
          for (let xx = x; xx < Math.min(x + 8, width); xx++) {
            const p = (yy * width + xx) * 4;
            if (
              Math.max(
                ...[0, 1, 2].map((c) => Math.abs(left.pixels[p + c] - right.pixels[p + c])),
              ) > 24
            ) {
              changed = true;
              break;
            }
          }
        if (changed) right.context.fillRect(x, y, 8, 8);
      }
    return right.canvas.toDataURL("image/png");
  } finally {
    left.canvas.width = 0;
    right.canvas.width = 0;
  }
}

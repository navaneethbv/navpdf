// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument, StandardFonts, decodePDFRawStream, PDFRawStream, rgb } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ContentEditor } from "../../src/features/editor/ContentEditor";
import { createBlankDocument, insertTextContent } from "../../src/services/document-commands";
import { readPageTextStyles } from "../../src/services/pdf/text-styles";
import type { ViewerController } from "../../src/features/viewer/controller";
import { lastReplacedBytes, loadWithPdfJs, pageTextItems } from "../helpers/inspect-pdf";

async function stylesOf(bytes: Uint8Array) {
  const pdf = await loadWithPdfJs(bytes);
  try {
    return await readPageTextStyles(await pdf.getPage(1));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function contentOperators(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const streams = contents && "asArray" in contents ? contents.asArray() : [contents];
  return streams
    .map((ref) => doc.context.lookup(ref))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .join("\n");
}

describe("insertTextContent styling", () => {
  it.each([
    [{ fontFace: "sans", bold: false, italic: false }, "Helvetica"],
    [{ fontFace: "sans", bold: true, italic: true }, "Helvetica-BoldOblique"],
    [{ fontFace: "serif", bold: false, italic: true }, "Times-Italic"],
    [{ fontFace: "serif", bold: true, italic: true }, "Times-BoldItalic"],
    [{ fontFace: "mono", bold: true, italic: false }, "Courier-Bold"],
    [{ fontFamily: "Times-Roman" }, "Times-Roman"],
    [{ fontFamily: "Helvetica-Bold", italic: true }, "Helvetica-BoldOblique"],
  ] as const)("writes %o with the %s font, size and color", async (style, fontName) => {
    const output = await insertTextContent(await createBlankDocument(1, 600, 800), {
      page: 1,
      text: "Styled text",
      x: 60,
      y: 600,
      fontSize: 13.5,
      color: [0, 0, 1],
      ...style,
    });
    const [written] = await stylesOf(output);
    expect(written).toMatchObject({
      fontName,
      size: 13.5,
      color: "#0000ff",
      sample: "Styled text",
    });
  });

  it("stretches justified lines to the wrap width but leaves each paragraph's last line", async () => {
    const output = await insertTextContent(await createBlankDocument(1, 600, 800), {
      page: 1,
      text: "Justified words spread across the whole measure of this line\nShort end",
      x: 50,
      y: 700,
      fontSize: 12,
      maxWidth: 200,
      alignment: "justify",
    });
    const pdf = await loadWithPdfJs(output);
    try {
      const items = (await pageTextItems(pdf, 0)).filter(
        (item): item is Extract<typeof item, { str: string }> => "str" in item && !!item.str.trim(),
      );
      const rows = new Map<number, typeof items>();
      for (const item of items) {
        const y = Math.round(item.transform[5]);
        rows.set(y, [...(rows.get(y) ?? []), item]);
      }
      const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row);
      expect(lines.length).toBeGreaterThan(2);
      const rightEdge = (row: typeof items) =>
        Math.max(...row.map((item) => item.transform[4] + item.width));
      for (const row of lines.slice(0, -2)) {
        expect(Math.min(...row.map((item) => item.transform[4]))).toBeCloseTo(50, 1);
        expect(rightEdge(row)).toBeCloseTo(250, 1);
      }
      // The last wrapped line of the first paragraph and the second paragraph stay ragged.
      expect(rightEdge(lines.at(-2)!)).toBeLessThan(249);
      expect(rightEdge(lines.at(-1)!)).toBeLessThan(150);
    } finally {
      await pdf.loadingTask.destroy();
    }
  });

  it("underlines each line and applies line spacing", async () => {
    const output = await insertTextContent(await createBlankDocument(1, 600, 800), {
      page: 1,
      text: "First line\nSecond line",
      x: 50,
      y: 700,
      fontSize: 10,
      lineHeight: 25,
      underline: true,
    });
    const operators = await contentOperators(output);
    expect(operators.match(/ l\n/g)).toHaveLength(2);
    expect(operators).toContain("S");
    const pdf = await loadWithPdfJs(output);
    try {
      const baselines = (await pageTextItems(pdf, 0))
        .filter((item) => "str" in item && item.str.trim())
        .map((item) => ("transform" in item ? item.transform[5] : 0));
      expect(baselines[0] - baselines[1]).toBeCloseTo(25, 3);
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
});

describe("ContentEditor match existing text", () => {
  it("copies an existing run's style and writes new text in it", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.drawText("Section heading", {
      x: 50,
      y: 700,
      size: 18,
      font: await doc.embedFont(StandardFonts.TimesRomanBold),
      color: rgb(0.8, 0, 0),
    });
    page.drawText("Body text in a smaller sans serif face.", {
      x: 50,
      y: 650,
      size: 10,
      font: await doc.embedFont(StandardFonts.Helvetica),
    });
    const source = await doc.save();
    const pdf: PDFDocumentProxy = await loadWithPdfJs(source);
    const replaceWithBytes = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const controller = {
      pdf: { getPage: (n: number) => pdf.getPage(n), saveDocument: async () => source },
      replaceWithBytes,
    } as unknown as ViewerController;
    try {
      render(<ContentEditor controller={controller} type="text" onClose={onClose} />);
      const picker = await screen.findByLabelText("Text style to match on page 1");
      const heading = await screen.findByRole("option", {
        name: /Section heading.*Times-Bold, 18 pt/,
      });
      fireEvent.change(picker, { target: { value: (heading as HTMLOptionElement).value } });

      expect(
        screen.getByText(/Uses Times Bold, the closest built-in font to Times-Bold/),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect((screen.getByLabelText("Size (pt)") as HTMLInputElement).value).toBe("18");

      fireEvent.click(screen.getByRole("button", { name: "Align center" }));
      fireEvent.change(screen.getByPlaceholderText(/Enter text to place on page/i), {
        target: { value: "Matched addition" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Insert Text" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());

      // The new run is indistinguishable from the heading, so both share one style group.
      const added = (await stylesOf(lastReplacedBytes(replaceWithBytes))).find((style) =>
        style.sample.includes("Matched addition"),
      );
      expect(added).toMatchObject({
        fontName: "Times-Bold",
        size: 18,
        color: "#cc0000",
        sample: "Section heading Matched addition",
      });
    } finally {
      await pdf.loadingTask.destroy();
    }
  });

  it("clears the match note when a style is changed by hand", async () => {
    const source = await createBlankDocument(1, 600, 800);
    const pdf = await loadWithPdfJs(
      await insertTextContent(source, { page: 1, text: "Existing", x: 50, y: 700 }),
    );
    const controller = {
      pdf: { getPage: (n: number) => pdf.getPage(n), saveDocument: async () => source },
      replaceWithBytes: vi.fn(),
    } as unknown as ViewerController;
    try {
      render(<ContentEditor controller={controller} type="text" onClose={vi.fn()} />);
      const option = await screen.findByRole("option", { name: /Existing/ });
      fireEvent.change(screen.getByLabelText("Text style to match on page 1"), {
        target: { value: (option as HTMLOptionElement).value },
      });
      expect(screen.getByText(/the closest built-in font to Helvetica/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Italic" }));
      expect(screen.queryByText(/the closest built-in font to Helvetica/)).toBeNull();
      expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    } finally {
      await pdf.loadingTask.destroy();
    }
  });

  it("reports pages without visible text", async () => {
    const source = await createBlankDocument(1, 600, 800);
    const pdf = await loadWithPdfJs(source);
    const controller = {
      pdf: { getPage: (n: number) => pdf.getPage(n), saveDocument: async () => source },
      replaceWithBytes: vi.fn(),
    } as unknown as ViewerController;
    try {
      render(<ContentEditor controller={controller} type="text" onClose={vi.fn()} />);
      expect(await screen.findByRole("option", { name: "No visible text on page 1" })).toBeTruthy();
      expect(
        (screen.getByLabelText("Text style to match on page 1") as HTMLSelectElement).disabled,
      ).toBe(true);
    } finally {
      await pdf.loadingTask.destroy();
    }
  });
});

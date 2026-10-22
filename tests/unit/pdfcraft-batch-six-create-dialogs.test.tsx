// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { CreatePdfDialog } from "../../src/features/pages/CreatePdfDialog";
import { OcrBatchDialog, ocrFile } from "../../src/features/ocr/OcrBatchDialog";
import { OcrPanel } from "../../src/features/ocr/OcrPanel";
import { downloadBlob } from "../../src/utils/download";
import { ocrRecognizePage } from "../../src/services/native";
import { pageImage } from "../../src/features/ocr/ocr-pages";
import { readOcrReview } from "../../src/services/pdf/ocr-review";
import { useWorkspace } from "../../src/stores/workspace";
import type { OcrPageResult } from "../../src/types/operations";

vi.mock("../../src/utils/download", () => ({ downloadBlob: vi.fn(async () => true) }));
vi.mock("../../src/services/native", () => ({
  native: true,
  ocrGetEngineInfo: vi.fn(async () => ({
    engineName: "Test OCR",
    isOffline: true,
    supportedLanguages: ["en-US"],
  })),
  ocrRecognizePage: vi.fn(
    async (_image: Uint8Array, { pageIndex }: { pageIndex: number }): Promise<OcrPageResult> => ({
      pageIndex,
      language: "en-US",
      lines: [
        {
          text: `Scanned ${pageIndex + 1}`,
          confidence: 0.9,
          bbox: [0.1, 0.1, 0.5, 0.05],
          words: [
            { text: `Scanned${pageIndex + 1}`, confidence: 0.9, bbox: [0.1, 0.1, 0.5, 0.05] },
          ],
        },
      ],
      fullText: `Scanned ${pageIndex + 1}`,
      meanConfidence: 0.9,
    }),
  ),
}));
vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: vi.fn((bytes: Uint8Array) => ({
    promise: PDFDocument.load(bytes).then((doc) => ({ numPages: doc.getPageCount() })),
    destroy: vi.fn(async () => {}),
  })),
}));
vi.mock("../../src/features/ocr/ocr-pages", async (original) => ({
  ...(await original<object>()),
  pageImage: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
});

/** Page 1 has real text; page 2 is a blank "scan". */
async function mixedPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText("Digital text", { font });
  doc.addPage([300, 300]);
  return doc.save();
}

it("creates a PDF from typed text with the chosen font and size", async () => {
  const load = vi.fn();
  render(<CreatePdfDialog initialTab="text" onLoad={load} onClose={() => {}} />);
  const create = screen.getByRole("button", { name: /Create PDF/ });
  expect(create).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Hello from text" } });
  fireEvent.click(screen.getByLabelText("Monospaced font"));
  fireEvent.click(create);
  await vi.waitFor(() => expect(load).toHaveBeenCalled());
  const file = load.mock.calls[0][0] as File;
  const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
  expect(doc.getPageCount()).toBe(1);
  expect(useWorkspace.getState().status).toBe("Created a PDF from text");
});

it("shows font coverage errors without creating anything", async () => {
  const load = vi.fn();
  render(<CreatePdfDialog initialTab="text" onLoad={load} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: "日本語" } });
  fireEvent.click(screen.getByRole("button", { name: /Create PDF/ }));
  expect(await screen.findByText(/cannot show/)).toBeTruthy();
  expect(load).not.toHaveBeenCalled();
});

it("reads text from the clipboard and explains when it cannot", async () => {
  const readText = vi.fn(async () => "Clipboard words");
  Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
  render(<CreatePdfDialog initialTab="text" onLoad={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Paste from Clipboard/ }));
  await vi.waitFor(() =>
    expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("Clipboard words"),
  );
  readText.mockRejectedValueOnce(new Error("Denied."));
  fireEvent.click(screen.getByRole("button", { name: /Paste from Clipboard/ }));
  expect(await screen.findByText(/Denied\. You can also paste/)).toBeTruthy();
});

it("converts each listed file to its own PDF in a ZIP archive", async () => {
  const onClose = vi.fn();
  render(<CreatePdfDialog initialTab="combine" onLoad={() => {}} onClose={onClose} />);
  const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
  const pdf = await mixedPdf();
  const files = [
    new File([pdf], "report.pdf", { type: "application/pdf" }),
    new File([pdf], "report.pdf", { type: "application/pdf" }),
  ];
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
  fireEvent.click(await screen.findByLabelText(/Convert each file to its own PDF/));
  fireEvent.click(screen.getByRole("button", { name: /Convert & Save ZIP/ }));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  const zip = new Uint8Array(
    await (vi.mocked(downloadBlob).mock.calls[0][0] as Blob).arrayBuffer(),
  );
  const text = new TextDecoder("latin1").decode(zip);
  expect(text).toContain("report.pdf");
  expect(text).toContain("report (2).pdf");
});

it("adds a searchable layer only to pages without text in batch OCR", async () => {
  const file = new File([await mixedPdf()], "scan.pdf", { type: "application/pdf" });
  const outcome = await ocrFile(
    file,
    {
      language: "en-US",
      skipTextPages: true,
      preprocessing: { grayscale: true, contrast: false, threshold: false, despeckle: false },
    },
    () => false,
    () => {},
  );
  expect(outcome).toMatchObject({ pages: 1, skipped: 1 });
  expect(vi.mocked(ocrRecognizePage)).toHaveBeenCalledOnce();
  expect(vi.mocked(pageImage).mock.calls[0][3]).toMatchObject({ grayscale: true });
  const review = await readOcrReview(outcome.bytes!, [0, 1]);
  expect(review.map((page) => page.pageIndex)).toEqual([1]);
});

it("runs multi-file OCR, reports each file and saves a ZIP", async () => {
  render(<OcrBatchDialog onClose={() => {}} />);
  const files = [
    new File([await mixedPdf()], "one.pdf", { type: "application/pdf" }),
    new File([new Uint8Array([1, 2, 3])], "broken.pdf", { type: "application/pdf" }),
  ];
  fireEvent.change(screen.getByLabelText("PDF files"), { target: { files } });
  expect(await screen.findByText("2 file(s) selected.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Recognize & Save ZIP" }));
  expect(await screen.findByText(/one\.pdf: 1 page\(s\) recognized, 1 skipped/)).toBeTruthy();
  expect(await screen.findByText(/broken\.pdf: The PDF could not be opened/)).toBeTruthy();
  await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
  const zip = new TextDecoder("latin1").decode(
    new Uint8Array(await (vi.mocked(downloadBlob).mock.calls[0][0] as Blob).arrayBuffer()),
  );
  expect(zip).toContain("one (OCR).pdf");
});

it("skips pages with text in the OCR panel", async () => {
  const bytes = await mixedPdf();
  act(() =>
    useWorkspace.getState().set({
      document: { id: "d", name: "scan.pdf", size: 1 },
      info: { pages: 2, encrypted: false, title: "", author: "", version: "1.7" } as never,
      page: 1,
    }),
  );
  const controller = {
    pdf: { numPages: 2, saveDocument: vi.fn(async () => bytes), getPage: vi.fn() },
    replaceWithBytes: vi.fn(),
  };
  render(<OcrPanel controller={controller as never} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /All Pages/ }));
  fireEvent.click(screen.getByLabelText("Skip pages that already have text"));
  fireEvent.click(screen.getByLabelText(/Black and white/));
  fireEvent.click(screen.getByRole("button", { name: "Apply Searchable Layer" }));
  expect(await screen.findByText("Review and correct recognized words")).toBeTruthy();
  expect(vi.mocked(ocrRecognizePage).mock.calls.map((call) => call[1].pageIndex)).toEqual([1]);
  expect(vi.mocked(pageImage).mock.calls[0][3]).toMatchObject({ threshold: true });
  expect(useWorkspace.getState().status).toMatch(/Skipping 1 page/);
});

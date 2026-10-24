// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PrintDialog } from "../../src/features/pages/PrintDialog";
import { CompressDialog } from "../../src/features/compress/CompressDialog";
import { printDocument } from "../../src/services/native";
import { compressDocument } from "../../src/services/engine";
import { rasterizeForPrint } from "../../src/features/pages/print-options";
import { useWorkspace } from "../../src/stores/workspace";

vi.mock("../../src/services/native", () => ({
  native: true,
  printDocument: vi.fn(async () => true),
}));
vi.mock("../../src/services/engine", () => ({
  compressDocument: vi.fn(),
  cancelEngineJob: vi.fn(),
  newJobId: () => "job",
  ENGINE_UNAVAILABLE: "Unavailable",
}));
vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: () => ({
    promise: Promise.resolve({ numPages: 2 }),
    destroy: vi.fn(async () => {}),
  }),
}));
vi.mock("../../src/features/viewer/PdfPagePreview", () => ({
  PdfPagePreview: ({ label, page }: { label: string; page: number }) => (
    <span>
      {label} {page}
    </span>
  ),
}));
vi.mock("../../src/features/pages/print-options", async (original) => ({
  ...(await original<object>()),
  rasterizeForPrint: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
});

async function numbered(pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index++)
    doc.addPage([200 + index, 300]).drawText(`Page ${index}`, { font });
  return doc.save();
}

function printController(bytes: Uint8Array, pages: number) {
  return { pdf: { numPages: pages, saveDocument: async () => bytes, getPage: vi.fn() } };
}

it("prints odd pages in reverse order", async () => {
  const bytes = await numbered(5);
  const close = vi.fn();
  render(<PrintDialog controller={printController(bytes, 5) as never} onClose={close} />);
  fireEvent.change(screen.getByLabelText("Subset"), { target: { value: "odd" } });
  fireEvent.click(screen.getByLabelText("Reverse page order"));
  fireEvent.click(screen.getByText("Print", { exact: true }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  const [payload, count] = vi.mocked(printDocument).mock.calls[0];
  expect(count).toBe(3);
  const printed = await PDFDocument.load(payload);
  expect(printed.getPages().map((page) => page.getWidth())).toEqual([205, 203, 201]);
});

it("rasterizes grayscale output and previews the prepared pages", async () => {
  const bytes = await numbered(2);
  render(<PrintDialog controller={printController(bytes, 2) as never} onClose={() => {}} />);
  fireEvent.click(screen.getByLabelText("Print in grayscale"));
  fireEvent.change(screen.getByLabelText("Image resolution"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Print preview 1")).toBeTruthy();
  expect(screen.getByText(/of 2/)).toBeTruthy();
  expect(rasterizeForPrint).toHaveBeenCalledWith(
    expect.any(Uint8Array),
    { dpi: 300, grayscale: true },
    expect.any(Function),
  );
  // Changing an option discards the stale preview.
  fireEvent.click(screen.getByLabelText("Reverse page order"));
  expect(screen.queryByText("Print preview 1")).toBeNull();
});

it("sends chosen discards to the optimizer and lists what was removed", async () => {
  vi.mocked(compressDocument).mockResolvedValue({
    bytes: new Uint8Array(10),
    report: {
      preset: "balanced",
      beforeBytes: 100,
      afterBytes: 10,
      useful: true,
      unusedObjectsRemoved: 0,
      duplicateStreamsMerged: 0,
      imagesExamined: 0,
      imagesRecompressed: 0,
      imagesSkipped: 0,
      checks: [],
      discarded: ["Page thumbnails removed: 2"],
      message: "Saves 90 bytes (90.0%).",
    },
  });
  const controller = {
    pdf: { saveDocument: vi.fn(async () => new Uint8Array(100)) },
    replaceWithBytes: vi.fn(),
  };
  render(<CompressDialog controller={controller as never} onClose={() => {}} />);
  fireEvent.click(screen.getByText(/Discard objects/));
  fireEvent.click(screen.getByLabelText("Embedded page thumbnails"));
  fireEvent.click(screen.getByLabelText("JavaScript actions"));
  expect(screen.getByText("Discard objects (2 chosen)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Analyze Compression/ }));
  expect(await screen.findByText("Page thumbnails removed: 2")).toBeTruthy();
  expect(vi.mocked(compressDocument).mock.calls[0][3]).toMatchObject({
    thumbnails: true,
    javascript: true,
    comments: false,
  });
});

it("sends no discard options when none are chosen", async () => {
  vi.mocked(compressDocument).mockResolvedValue({
    bytes: null,
    report: {
      preset: "balanced",
      beforeBytes: 100,
      afterBytes: 100,
      useful: false,
      unusedObjectsRemoved: 0,
      duplicateStreamsMerged: 0,
      imagesExamined: 0,
      imagesRecompressed: 0,
      imagesSkipped: 0,
      checks: [],
      message: "Kept",
    },
  });
  const controller = { pdf: { saveDocument: vi.fn(async () => new Uint8Array(100)) } };
  render(<CompressDialog controller={controller as never} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Analyze Compression/ }));
  expect(await screen.findByText("Kept")).toBeTruthy();
  expect(vi.mocked(compressDocument).mock.calls[0][3]).toBeUndefined();
});

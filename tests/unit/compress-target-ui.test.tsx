// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompressDialog } from "../../src/features/compress/CompressDialog";
import { compressDocument } from "../../src/services/engine";
import type { ViewerController } from "../../src/features/viewer/controller";
vi.mock("../../src/services/native", () => ({ native: true }));
vi.mock("../../src/services/engine", () => ({
  compressDocument: vi.fn(),
  cancelEngineJob: vi.fn(),
  newJobId: () => "test-compress",
  ENGINE_UNAVAILABLE: "Unavailable",
}));
vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: () => ({ promise: Promise.resolve({ numPages: 1 }), destroy: vi.fn() }),
}));
vi.mock("../../src/features/viewer/PdfPagePreview", () => ({
  PdfPagePreview: ({ label }: { label: string }) => <span>{label}</span>,
}));
describe("target compression dialog", () => {
  it("measures presets, previews, and applies the selected source-bound result", async () => {
    vi.mocked(compressDocument).mockImplementation(async (_bytes, preset) => ({
      bytes: new Uint8Array(preset === "lossless" ? 3_000_000 : 1_000_000),
      report: {
        preset,
        beforeBytes: 4_000_000,
        afterBytes: preset === "lossless" ? 3_000_000 : 1_000_000,
        useful: true,
        imagesExamined: 1,
        imagesRecompressed: 0,
        imagesSkipped: 0,
        duplicateStreamsMerged: 0,
        unusedObjectsRemoved: 0,
        checks: [{ name: "Text", passed: true, detail: "Unchanged" }],
        message: "Ready",
      },
    }));
    const controller = {
      pdf: { saveDocument: vi.fn().mockResolvedValue(new Uint8Array(4_000_000)) },
      replaceWithBytes: vi.fn(),
    } as unknown as ViewerController;
    const onClose = vi.fn();
    render(<CompressDialog controller={controller} onClose={onClose} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Compress to a target size" }));
    fireEvent.click(screen.getByRole("button", { name: "Under 2 MB" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze Compression" }));
    await screen.findByText(/Target met/);
    await screen.findByText("Original");
    await screen.findByText("Compressed");
    expect(vi.mocked(compressDocument).mock.calls.map((call) => call[1])).toEqual([
      "lossless",
      "balanced",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Apply Compressed Version" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(controller.replaceWithBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.stringContaining("Balanced"),
      { expectedSource: controller.pdf },
    );
  });
});

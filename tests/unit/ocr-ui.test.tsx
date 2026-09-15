// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OcrPanel } from "../../src/features/ocr/OcrPanel";
import { createBlankDocument, insertTextContent } from "../../src/services/document-commands";
import type { ViewerController } from "../../src/features/viewer/controller";
import { ocrGetEngineInfo, ocrRecognizePage } from "../../src/services/native";
import { useWorkspace } from "../../src/stores/workspace";

vi.mock("../../src/services/native", () => ({
  ocrGetEngineInfo: vi.fn(),
  ocrRecognizePage: vi.fn(),
}));

describe("OcrPanel UI Component (P6.4)", () => {
  let samplePdf: Uint8Array;

  beforeEach(async () => {
    vi.mocked(ocrGetEngineInfo).mockResolvedValue({
      engineName: "Test adapter",
      isOffline: true,
      supportedLanguages: ["en-US"],
    });
    vi.mocked(ocrRecognizePage).mockResolvedValue({
      pageIndex: 0,
      language: "en-US",
      lines: [],
      fullText: "Synthetic adapter result",
      meanConfidence: 0,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AA==",
    );
    samplePdf = await createBlankDocument(3, 600, 800);
  });

  const createMockController = (pdfBytes: Uint8Array): ViewerController => {
    return {
      pdf: {
        numPages: 3,
        saveDocument: vi.fn().mockResolvedValue(pdfBytes),
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
          render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
          getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        }),
      },
      replaceWithBytes: vi.fn().mockResolvedValue(undefined),
    } as unknown as ViewerController;
  };

  it("renders offline status badge and recognition options", async () => {
    const mockController = createMockController(samplePdf);
    render(<OcrPanel controller={mockController} onClose={vi.fn()} />);

    expect(screen.getByText(/Optical Character Recognition \(OCR\)/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/100% Offline & Private/i)).toBeDefined();
    });

    expect(screen.getByText(/Current Page/i)).toBeDefined();
    expect(screen.getByText(/All Pages/i)).toBeDefined();
    expect(screen.getByText(/Custom Range/i)).toBeDefined();
  });

  it("switches target page scope and shows range input", () => {
    const mockController = createMockController(samplePdf);
    render(<OcrPanel controller={mockController} onClose={vi.fn()} />);

    const rangeBtn = screen.getByRole("button", { name: /Custom Range/i });
    fireEvent.click(rangeBtn);

    const input = screen.getByPlaceholderText(/e.g. 1-3, 5/i);
    expect(input).toBeDefined();
    fireEvent.change(input, { target: { value: "1-2" } });
  });

  it("disables recognition when the native engine is unavailable", async () => {
    vi.mocked(ocrGetEngineInfo).mockRejectedValueOnce(new Error("OCR unavailable"));
    render(<OcrPanel controller={createMockController(samplePdf)} onClose={vi.fn()} />);
    await screen.findByText("OCR unavailable");
    expect(
      screen.getByRole("button", { name: /Apply Searchable Layer/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("does not apply the final page after cancellation", async () => {
    let finish!: (value: Awaited<ReturnType<typeof ocrRecognizePage>>) => void;
    vi.mocked(ocrRecognizePage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = createMockController(samplePdf);
    render(<OcrPanel controller={controller} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Apply Searchable Layer/i });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Cancel OCR" }));
    finish({
      pageIndex: 0,
      language: "en-US",
      lines: [],
      fullText: "cancelled",
      meanConfidence: 0,
    });
    await waitFor(() => expect(screen.queryByText("Cancel OCR")).toBeNull());
    expect(controller.replaceWithBytes).not.toHaveBeenCalled();
  });

  it("does not call recognition when canvas encoding fails", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementationOnce(() => {
      throw new Error("Canvas failed");
    });
    const controller = createMockController(samplePdf);
    vi.mocked(ocrRecognizePage).mockClear();
    render(<OcrPanel controller={controller} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Apply Searchable Layer/i });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText("Cancel OCR")).toBeNull());
    expect(ocrRecognizePage).not.toHaveBeenCalled();
    expect(controller.replaceWithBytes).not.toHaveBeenCalled();
  });

  it("warns when target page contains existing digital text", async () => {
    // PDF with digital text
    const withText = await insertTextContent(samplePdf, {
      text: "Existing text",
      page: 1,
      x: 50,
      y: 700,
    });

    const mockController = createMockController(withText);
    render(<OcrPanel controller={mockController} onClose={vi.fn()} />);

    const applyBtn = screen.getByRole("button", { name: /Apply Searchable Layer/i });
    await waitFor(() => expect(applyBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/Existing digital text detected/i)).toBeDefined();
    });

    // Check the "Replace existing text" checkbox
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    // Button should now read "Replace & Start OCR"
    const replaceBtn = screen.getByRole("button", { name: /Continue & Start OCR/i });
    expect(replaceBtn).toBeDefined();
  });

  it("executes OCR and applies searchable layer to document", async () => {
    const onClose = vi.fn();
    const mockController = createMockController(samplePdf);
    render(<OcrPanel controller={mockController} onClose={onClose} />);

    const applyBtn = screen.getByRole("button", { name: /Apply Searchable Layer/i });
    await waitFor(() => expect(applyBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(mockController.replaceWithBytes).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.stringContaining("OCR Searchable Layer"),
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("switches to text extraction mode and displays recognized text", async () => {
    const mockController = createMockController(samplePdf);
    render(<OcrPanel controller={mockController} onClose={vi.fn()} />);

    // Switch to text extraction
    fireEvent.click(screen.getByRole("button", { name: /Extract Text Only/i }));

    const recognizeBtn = screen.getByRole("button", { name: /Recognize Text/i });
    await waitFor(() => expect(recognizeBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(recognizeBtn);

    await waitFor(() => {
      expect(screen.getByText("Recognized Text")).toBeDefined();
      expect(screen.getByText(/Copy Text/i)).toBeDefined();
    });
  });

  it("disables OCR button and displays warning when document is encrypted", async () => {
    useWorkspace.getState().set({
      info: {
        pages: 3,
        title: "Secret",
        author: "Me",
        version: "1.7",
        encrypted: true,
      },
    });
    const controller = createMockController(samplePdf);
    render(<OcrPanel controller={controller} onClose={vi.fn()} />);

    expect(
      screen.getByText(/OCR is disabled for password-protected and encrypted documents/i),
    ).toBeDefined();
    const button = screen.getByRole("button", { name: /Apply Searchable Layer/i });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportDialog } from "../../src/features/convert/ExportDialog";
import type { ViewerController } from "../../src/features/viewer/controller";

describe("ExportDialog Hardening (P6.5)", () => {
  let mockController: ViewerController;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,fixture",
    );
    mockController = {
      pdf: {
        numPages: 3,
        getPage: vi.fn().mockImplementation((pageNum: number) =>
          Promise.resolve({
            getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
            render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
            getTextContent: vi.fn().mockResolvedValue({
              items: [
                // Unsorted items to verify top-to-bottom reading order
                { str: "Second Line", transform: [12, 0, 0, 12, 50, 600], width: 60, height: 12 },
                { str: "First Line", transform: [12, 0, 0, 12, 50, 700], width: 55, height: 12 },
                {
                  str: `Page ${pageNum} Title`,
                  transform: [12, 0, 0, 12, 50, 750],
                  width: 70,
                  height: 12,
                },
              ],
            }),
          }),
        ),
      },
    } as unknown as ViewerController;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps cancellation pending until the original page request settles", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(mockController.pdf!.getPage).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const onClose = vi.fn();
    render(<ExportDialog controller={mockController} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel Export/i }));
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    const getTextContent = vi.fn();
    finish({ getTextContent });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeTruthy());
    expect(getTextContent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders format selection and default scope", () => {
    render(<ExportDialog controller={mockController} onClose={vi.fn()} />);

    expect(screen.getByText(/Plain Text \(\.txt\)/i)).toBeDefined();
    expect(screen.getByText(/PNG Image/i)).toBeDefined();
    expect(screen.getByText(/JPEG Image/i)).toBeDefined();
    expect(screen.getByText(/All Pages/i)).toBeDefined();
    expect(screen.getByText(/Current Page/i)).toBeDefined();
    expect(screen.getByText(/Custom Range/i)).toBeDefined();
  });

  it("displays DPI and quality controls when an image format is selected", () => {
    render(<ExportDialog controller={mockController} onClose={vi.fn()} />);

    // Switch to PNG
    fireEvent.click(screen.getByRole("button", { name: /PNG Image/i }));

    expect(screen.getByRole("button", { name: /72 DPI/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /150 DPI/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /300 DPI/i })).toBeDefined();

    // Switch to JPEG to verify quality slider appears
    fireEvent.click(screen.getByRole("button", { name: /JPEG Image/i }));
    expect(screen.getByText(/JPEG Quality/i)).toBeDefined();
  });

  it("switches DPI settings", () => {
    render(<ExportDialog controller={mockController} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /PNG Image/i }));

    const dpi300 = screen.getByRole("button", { name: /300 DPI/i });
    fireEvent.click(dpi300);
    expect(dpi300.className).toContain("active");
  });

  it("dispatches plain text export in reading order, one text line per line", async () => {
    const onClose = vi.fn();
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:mock";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ExportDialog controller={mockController} onClose={onClose} />);

    const exportBtn = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(mockController.pdf?.getPage).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
    const text = await created[0].text();
    expect(text).toContain("--- Page 1 ---\n\nPage 1 Title\nFirst Line\nSecond Line\n");
  });

  it("dispatches image export for selected pages", async () => {
    const onClose = vi.fn();
    render(<ExportDialog controller={mockController} onClose={onClose} />);

    // Select PNG and current page
    fireEvent.click(screen.getByRole("button", { name: /PNG Image/i }));
    fireEvent.click(screen.getByRole("button", { name: /Current Page/i }));

    const exportBtn = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(mockController.pdf?.getPage).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});

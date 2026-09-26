// @vitest-environment happy-dom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompareDialog } from "../../src/features/compare/CompareDialog";
import {
  pageSignatures,
  renderComparisonPage,
  visualDifference,
} from "../../src/features/compare/compare-pdf";
import { loadPdfFromBytes } from "../../src/services/pdf";
import type { ViewerController } from "../../src/features/viewer/controller";
vi.mock("../../src/services/pdf", () => ({ loadPdfFromBytes: vi.fn() }));
vi.mock("../../src/features/compare/compare-pdf", async (original) => ({
  ...(await original<typeof import("../../src/features/compare/compare-pdf")>()),
  pageSignatures: vi.fn(),
  renderComparisonPage: vi.fn(),
  visualDifference: vi.fn(),
}));
vi.mock("../../src/features/viewer/PdfPagePreview", () => ({
  PdfPagePreview: ({ label }: { label: string }) => <span>{label}</span>,
}));
beforeEach(() => {
  vi.mocked(loadPdfFromBytes)
    .mockReset()
    .mockImplementation(
      () =>
        ({ promise: Promise.resolve({ numPages: 2 }), destroy: vi.fn() }) as unknown as ReturnType<
          typeof loadPdfFromBytes
        >,
    );
  vi.mocked(pageSignatures)
    .mockReset()
    .mockResolvedValueOnce([
      { text: "Amount 100", key: "A" },
      { text: "Footer", key: "B" },
    ])
    .mockResolvedValueOnce([
      { text: "Amount 200", key: "X" },
      { text: "Footer", key: "B" },
    ]);
  vi.mocked(renderComparisonPage).mockResolvedValue(document.createElement("canvas"));
  vi.mocked(visualDifference).mockReturnValue("data:image/png;base64,AA==");
});
function setup() {
  const controller = {
    pdf: { numPages: 2, saveDocument: vi.fn().mockResolvedValue(new Uint8Array([1])) },
  } as unknown as ViewerController;
  const rendered = render(<CompareDialog controller={controller} onClose={vi.fn()} />);
  return { ...rendered, controller };
}
function select() {
  fireEvent.change(screen.getByLabelText("Choose revised PDF"), {
    target: { files: [new File(["pdf"], "revision.pdf")] },
  });
}
describe("comparison workflow", () => {
  it("shows synchronized page pairs, changed text and visual overlays", async () => {
    setup();
    select();
    await screen.findByText(/1 changed, 0 added, 0 removed, 1 unchanged/);
    expect(screen.getByText("Original page 1")).toBeTruthy();
    expect(screen.getByText("Revised page 1")).toBeTruthy();
    await screen.findByAltText("Revised page with changed regions highlighted");
    expect(document.querySelector("del")?.textContent).toBe("1");
    expect(document.querySelector("ins")?.textContent).toBe("2");
    fireEvent.change(screen.getByLabelText("Page pair"), { target: { value: "1" } });
    expect(screen.getByText("Original page 2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Only changes"));
    expect(screen.getByText("Original page 1")).toBeTruthy();
  });
  it("cancels while reading source bytes without creating leaked PDF tasks", async () => {
    const { controller } = setup();
    let finish!: (bytes: Uint8Array) => void;
    vi.mocked(controller.pdf!.saveDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    select();
    fireEvent.click(screen.getByRole("button", { name: "Cancel comparison" }));
    finish(new Uint8Array([1]));
    await waitFor(() => expect(screen.getByText("Comparison cancelled.")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadPdfFromBytes).not.toHaveBeenCalled();
  });
  it("reports comparison limits and keeps the active document unchanged", async () => {
    setup();
    vi.mocked(pageSignatures)
      .mockReset()
      .mockRejectedValue(new Error("Comparison page limit exceeded"));
    select();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Original page 1")).toBeNull();
  });
});

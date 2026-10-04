// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { CreatePdfDialog } from "../../src/features/pages/CreatePdfDialog";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => useWorkspace.getState().reset());

async function pdfFile(name = "source.pdf") {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  pdf.addPage([500, 600]);
  return new File([new Uint8Array(await pdf.save())], name, { type: "application/pdf" });
}

function selectFiles(files: File[]) {
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
}

describe("Create PDF error feedback", () => {
  it("shows range errors inside the dialog and retains inputs for a successful retry", async () => {
    const onLoad = vi.fn(),
      onClose = vi.fn();
    render(<CreatePdfDialog initialTab="combine" onLoad={onLoad} onClose={onClose} />);
    selectFiles([await pdfFile()]);
    const range = await screen.findByLabelText("Page range for source.pdf");
    fireEvent.change(range, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Combine & Open" }));
    const dialog = within(screen.getByRole("dialog", { name: "Create PDF" }));
    const alert = await dialog.findByRole("alert");
    expect(alert.textContent).toContain("No pages match");
    expect(onLoad).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(useWorkspace.getState().error).toBe("");

    fireEvent.change(range, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Combine & Open" }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledOnce());
    expect(dialog.queryByRole("alert")).toBeNull();
    const output = await PDFDocument.load(await (onLoad.mock.calls[0][0] as File).arrayBuffer());
    expect(output.getPages().map((page) => page.getSize())).toEqual([{ width: 500, height: 600 }]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports a damaged PDF and allows removing it without losing other files", async () => {
    const onLoad = vi.fn();
    render(<CreatePdfDialog initialTab="combine" onLoad={onLoad} onClose={vi.fn()} />);
    selectFiles([await pdfFile("good.pdf"), new File(["not a PDF"], "damaged.pdf")]);
    await screen.findByText("2. damaged.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Combine & Open" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Failed to parse PDF");
    expect(onLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove file" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Combine & Open" }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows failed image imports locally while retaining supported files", async () => {
    render(<CreatePdfDialog initialTab="combine" onLoad={vi.fn()} onClose={vi.fn()} />);
    selectFiles([new File(["image"], "scan.tiff"), await pdfFile()]);
    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert.textContent).toContain("scan.tiff");
    expect(alert.textContent).toContain("requires the native macOS app");
    expect(screen.getByText("1. source.pdf")).toBeTruthy();
    expect(useWorkspace.getState().error).toBe("");
    selectFiles([await pdfFile("second.pdf")]);
    await screen.findByText("2. second.pdf");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

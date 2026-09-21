// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PrintDialog } from "../../src/features/pages/PrintDialog";
import { useWorkspace } from "../../src/stores/workspace";
import { printDocument } from "../../src/services/native";

vi.mock("../../src/services/native", () => ({
  native: true,
  printDocument: vi.fn(async () => false),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
});

it("clears a rejected range error when retrying with a valid range", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  const onClose = vi.fn();
  render(
    <PrintDialog
      controller={{ pdf: { numPages: 1, saveDocument: async () => bytes } } as never}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByLabelText("Pages:"));
  const input = screen.getByLabelText("Custom page range");
  fireEvent.change(input, { target: { value: "99" } });
  fireEvent.click(screen.getByText("Print", { exact: true }));
  await vi.waitFor(() => expect(useWorkspace.getState().error).toContain("No pages match"));
  expect(printDocument).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.click(screen.getByText("Print", { exact: true }));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(useWorkspace.getState().error).toBe("");
  expect(useWorkspace.getState().status).toBe("Print cancelled");
});

it("prints only the selected edited page through native IPC and reports cancellation", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("First page", { font });
  pdf.addPage().drawText("Edited second page", { font });
  const bytes = await pdf.save();
  const commit = vi.fn();
  const save = vi.fn(async () => {
    expect(commit).toHaveBeenCalledOnce();
    return bytes;
  });
  act(() =>
    useWorkspace.getState().set({
      page: 2,
      info: {
        pages: 2,
        encrypted: false,
        title: "",
        author: "",
        version: "1.7",
      },
    }),
  );
  const onClose = vi.fn();
  render(
    <PrintDialog
      controller={
        { pdf: { numPages: 2, saveDocument: save }, editor: { commitOrRemove: commit } } as never
      }
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByText("Current page", { exact: false }));
  fireEvent.click(screen.getByText("Print", { exact: true }));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const [payload, pages] = vi.mocked(printDocument).mock.calls[0];
  expect(pages).toBe(1);
  expect((await PDFDocument.load(payload)).getPageCount()).toBe(1);
  expect(document.querySelector("iframe")).toBeNull();
  expect(useWorkspace.getState().status).toBe("Print cancelled");
});

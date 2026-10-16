// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { InitialViewDialog } from "../../src/features/document/InitialViewDialog";
import { ImposeDialog } from "../../src/features/pages/ImposeDialog";
import { useWorkspace } from "../../src/stores/workspace";
import { readInitialView } from "../../src/services/pdf/initial-view";

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.restoreAllMocks();
});
async function controller() {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  const bytes = await doc.save();
  return {
    pdf: { numPages: 2, saveDocument: vi.fn(async () => bytes) },
    replaceWithBytes: vi.fn(async () => {}),
  };
}
it("applies initial view with a source revision and surfaces validation errors", async () => {
  const current = await controller();
  const close = vi.fn();
  render(<InitialViewDialog controller={current as never} onClose={close} />);
  const page = await screen.findByLabelText("Opening page");
  fireEvent.change(page, { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply View" }));
  expect((page as HTMLInputElement).checkValidity()).toBe(false);
  expect(current.replaceWithBytes).not.toHaveBeenCalled();
  fireEvent.change(page, { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Opening layout"), { target: { value: "TwoPageRight" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply View" }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  const [bytes, , options] = current.replaceWithBytes.mock.calls[0] as unknown as [
    Uint8Array,
    string,
    { expectedSource: unknown },
  ];
  expect(await readInitialView(bytes)).toMatchObject({ page: 2, layout: "TwoPageRight" });
  expect(options.expectedSource).toBe(current.pdf);
});
it("does not enable initial-view editing when loading fails", async () => {
  const current = await controller();
  current.pdf.saveDocument.mockRejectedValue(new Error("Read failed"));
  render(<InitialViewDialog controller={current as never} onClose={() => {}} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Read failed");
  expect(screen.getByRole("button", { name: "Apply View" })).toHaveProperty("disabled", true);
});
it("exports posters and blocks invalid scales", async () => {
  const current = await controller();
  const close = vi.fn();
  const saved: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    saved.push(blob as Blob);
    return "blob:poster";
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ImposeDialog controller={current as never} onClose={close} />);
  fireEvent.change(screen.getByLabelText("Layout"), { target: { value: "poster" } });
  fireEvent.change(screen.getByLabelText("Poster scale (%)"), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "Save PDF" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Poster scale (%)"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Save PDF" }));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect(saved).toHaveLength(1);
  expect((await PDFDocument.load(await saved[0].arrayBuffer())).getPageCount()).toBeGreaterThan(2);
  expect(current.replaceWithBytes).not.toHaveBeenCalled();
});
it("does not export a poster after its document is replaced", async () => {
  const current = await controller();
  let finish!: (bytes: Uint8Array) => void;
  const bytes = await current.pdf.saveDocument();
  current.pdf.saveDocument.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const save = vi.spyOn(URL, "createObjectURL");
  render(<ImposeDialog controller={current as never} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Layout"), { target: { value: "poster" } });
  fireEvent.click(screen.getByRole("button", { name: "Save PDF" }));
  current.pdf = { ...current.pdf };
  finish(bytes);
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Save PDF" })).toHaveProperty("disabled", false),
  );
  expect(save).not.toHaveBeenCalled();
});

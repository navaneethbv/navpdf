// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  prepressDocument: vi.fn(),
  ENGINE_UNAVAILABLE: "Desktop only.",
}));
vi.mock("../../src/services/engine", () => engine);
vi.mock("../../src/services/native", () => ({ native: true }));

import { PrintProductionDialog } from "../../src/features/pages/PrintProductionDialog";
import { useWorkspace } from "../../src/stores/workspace";

function controller(pages = 6) {
  return {
    pdf: { numPages: pages, saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) },
    replaceWithBytes: vi.fn(async () => {}),
  };
}

const report = (message: string, leftAlone: string[] = []) => ({
  pages: 1,
  changed: 1,
  imagesConverted: 0,
  leftAlone,
  message,
});

beforeEach(() => {
  vi.clearAllMocks();
  act(() => useWorkspace.getState().reset());
});

describe("Print Production dialog", () => {
  it("adds the chosen marks to the named pages and removes them again", async () => {
    engine.prepressDocument.mockResolvedValue({
      bytes: new Uint8Array([1]),
      report: report("Printer marks added to 2 pages."),
    });
    act(() => useWorkspace.getState().set({ document: { name: "Brochure.pdf" } as never }));
    const view = controller();
    render(<PrintProductionDialog controller={view as never} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Colour bar/));
    fireEvent.change(screen.getByLabelText("Line weight"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText(/^Pages/), { target: { value: "2, 4" } });
    fireEvent.click(screen.getByText("Add Marks"));

    expect(await screen.findByText("Printer marks added to 2 pages.")).toBeTruthy();
    const [, edit] = engine.prepressDocument.mock.calls[0];
    expect(edit).toMatchObject({
      kind: "addPrinterMarks",
      pages: [2, 4],
      options: {
        trimMarks: true,
        registrationMarks: true,
        colorBars: true,
        bleedMarks: false,
        weight: 0.5,
        fileName: "Brochure.pdf",
      },
    });
    expect(edit.options.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.replaceWithBytes).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Remove Marks"));
    await vi.waitFor(() => expect(engine.prepressDocument).toHaveBeenCalledTimes(2));
    expect(engine.prepressDocument.mock.calls[1][1]).toEqual({ kind: "removePrinterMarks" });
  });

  it("reports what a colour conversion left alone", async () => {
    engine.prepressDocument.mockResolvedValue({
      bytes: new Uint8Array([1]),
      report: report("3 colours and 0 pictures converted to CMYK.", ["Shadings: 2"]),
    });
    render(<PrintProductionDialog controller={controller() as never} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Convert colours"));
    fireEvent.change(screen.getByLabelText("Convert to"), { target: { value: "cmyk" } });
    fireEvent.click(screen.getByLabelText("Also convert pictures"));
    fireEvent.click(screen.getByText("Convert Colours"));

    expect(await screen.findByText("Shadings: 2")).toBeTruthy();
    expect(engine.prepressDocument.mock.calls[0][1]).toEqual({
      kind: "convertColors",
      target: "cmyk",
      images: false,
      pages: [],
    });
  });

  it("says so without changing the document when there is nothing to fix", async () => {
    engine.prepressDocument.mockResolvedValue({
      bytes: null,
      report: { ...report("No strokes thinner than the limit were found."), changed: 0 },
    });
    const view = controller();
    render(<PrintProductionDialog controller={view as never} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Fix hairlines"));
    fireEvent.click(screen.getByText("Fix Hairlines"));

    expect(await screen.findByText("No strokes thinner than the limit were found.")).toBeTruthy();
    expect(engine.prepressDocument.mock.calls[0][1]).toEqual({
      kind: "fixHairlines",
      threshold: 0.216,
      width: 0.72,
      pages: [],
    });
    expect(view.replaceWithBytes).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps an engine failure or a bad page range in the dialog", async () => {
    engine.prepressDocument.mockRejectedValue(new Error("Page 9 is outside the document."));
    const view = controller();
    render(<PrintProductionDialog controller={view as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Add Marks"));
    expect(await screen.findByText("Page 9 is outside the document.")).toBeTruthy();
    expect(view.replaceWithBytes).not.toHaveBeenCalled();
  });
});

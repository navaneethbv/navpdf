// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeasureTool } from "../../src/features/annotations/MeasureTool";
import { MeasureDialog } from "../../src/features/annotations/MeasureDialog";
import { useWorkspace } from "../../src/stores/workspace";

/** A 400 point square page shown at 1:1 with its top-left corner at (100, 100). */
function pageElement(number: number) {
  const page = document.createElement("div");
  page.className = "page";
  page.dataset.pageNumber = String(number);
  document.body.append(page);
  vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    right: 500,
    bottom: 500,
    width: 400,
    height: 400,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  return page;
}

function measuringController() {
  return {
    setTool: vi.fn(),
    addMeasurement: vi.fn(async () => "1.00 in"),
    pdf: {
      getPage: vi.fn(async () => ({
        rotate: 0,
        getViewport: () => ({
          width: 400,
          height: 400,
          convertToPdfPoint: (x: number, y: number) => [x, 400 - y],
        }),
      })),
    },
  };
}

beforeEach(() => {
  useWorkspace.getState().reset();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const keys = () => screen.getByRole("button", { name: /^Measuring / });

const click = (target: Element, x: number, y: number) =>
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: x, clientY: y });

describe("MeasureTool", () => {
  it("measures a distance between two clicks on the page they were made on", async () => {
    pageElement(3);
    const controller = measuringController();
    act(() => useWorkspace.getState().set({ tool: "measure", measureKind: "distance" }));
    render(<MeasureTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Measure distance" });
    click(overlay, 172, 400);
    await vi.waitFor(() => expect(controller.pdf.getPage).toHaveBeenCalledWith(3));
    expect(document.activeElement).toBe(keys());
    click(overlay, 244, 400);
    await vi.waitFor(() =>
      expect(controller.addMeasurement).toHaveBeenCalledWith({
        page: 3,
        kind: "distance",
        points: [
          [72, 100],
          [144, 100],
        ],
        scale: { pageInches: 1, realValue: 1, unit: "in" },
      }),
    );
    expect(await screen.findByText(/Measured 1\.00 in\./)).toBeTruthy();
  });

  it("collects area corners, ignores double-click repeats and finishes with Enter", async () => {
    pageElement(1);
    const controller = measuringController();
    act(() => useWorkspace.getState().set({ tool: "measure", measureKind: "area" }));
    render(<MeasureTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Measure area" });
    for (const [x, y] of [
      [172, 172],
      [244, 172],
      [244, 172],
      [244, 244],
      [300, 300],
    ]) {
      click(overlay, x, y);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    fireEvent.keyDown(keys(), { key: "Backspace" });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 172, clientY: 244 });
    expect(await screen.findByText(/sq in ·/)).toBeTruthy();
    fireEvent.keyDown(keys(), { key: "Enter" });
    await vi.waitFor(() => expect(controller.addMeasurement).toHaveBeenCalled());
    const [[input]] = controller.addMeasurement.mock.calls as unknown as [[{ points: number[][] }]];
    expect(input.points).toEqual([
      [72, 328],
      [144, 328],
      [144, 256],
    ]);
  });

  it("clears an unfinished measurement, then exits on Escape", async () => {
    pageElement(1);
    const controller = measuringController();
    act(() => useWorkspace.getState().set({ tool: "measure", measureKind: "perimeter" }));
    render(<MeasureTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Measure perimeter" });
    click(overlay, 150, 150);
    await vi.waitFor(() => expect(controller.pdf.getPage).toHaveBeenCalled());
    fireEvent.keyDown(keys(), { key: "Escape" });
    expect(useWorkspace.getState().tool).toBe("measure");
    fireEvent.keyDown(keys(), { key: "Escape" });
    expect(useWorkspace.getState().tool).toBe("select");
    expect(controller.setTool).toHaveBeenCalledWith("select");
    expect(controller.addMeasurement).not.toHaveBeenCalled();
  });
});

describe("MeasureDialog", () => {
  it("stores the kind and scale and starts the measuring tool", () => {
    const controller = { pdf: {}, setTool: vi.fn() };
    const onClose = vi.fn();
    render(<MeasureDialog controller={controller as never} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Area"));
    fireEvent.change(screen.getByLabelText("Inches on the page"), { target: { value: "0.25" } });
    fireEvent.change(screen.getByLabelText("Equal this many"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "m" } });
    expect(screen.getByText("Scale: 0.25 in = 1 m")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Measuring" }));
    expect(useWorkspace.getState()).toMatchObject({
      measureKind: "area",
      measureScale: { pageInches: 0.25, realValue: 1, unit: "m" },
    });
    expect(controller.setTool).toHaveBeenCalledWith("measure");
    expect(onClose).toHaveBeenCalled();
  });

  it("requires a positive scale", () => {
    render(<MeasureDialog controller={{ pdf: {}, setTool: vi.fn() } as never} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Equal this many"), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toMatch(/positive numbers/);
    expect(screen.getByRole("button", { name: "Start Measuring" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

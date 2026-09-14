// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ShapeTool } from "../../src/features/annotations/ShapeTool";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

describe("ShapeTool", () => {
  function setupDom() {
    const page = document.createElement("div");
    page.className = "page";
    page.dataset.pageNumber = "1";
    document.body.append(page);
    const rect = {
      left: 100,
      top: 100,
      right: 500,
      bottom: 500,
      width: 400,
      height: 400,
      x: 100,
      y: 100,
      toJSON: () => {},
    };
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue(rect);
    return {
      page,
      cleanup: () => page.remove(),
    };
  }

  it("renders overlay and cancels on Escape key", () => {
    const controller = {
      setTool: vi.fn(),
      addShape: vi.fn(async () => {}),
      pdf: null,
    };
    useWorkspace.getState().set({ tool: "shape", shapeKind: "Square" });
    render(<ShapeTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Draw square shape" });
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(useWorkspace.getState().tool).toBe("select");
    expect(controller.setTool).toHaveBeenCalledWith("select");
  });

  it("draws a square shape on pointer drag", async () => {
    const { cleanup } = setupDom();
    const pdf = {
      getPage: vi.fn(async () => ({
        rotate: 0,
        getViewport: () => ({
          width: 400,
          height: 400,
          convertToPdfPoint: (x: number, y: number) => [x, 400 - y],
        }),
      })),
    };
    const controller = {
      setTool: vi.fn(),
      addShape: vi.fn(async () => {}),
      pdf,
    };
    useWorkspace.getState().set({ tool: "shape", shapeKind: "Square" });
    render(<ShapeTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Draw square shape" });
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 600,
      bottom: 600,
      width: 600,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerId: 1,
      clientX: 150,
      clientY: 150,
    });
    await vi.waitFor(() => {
      expect(pdf.getPage).toHaveBeenCalledWith(1);
    });

    await vi.waitFor(() => {
      fireEvent.pointerMove(overlay, {
        pointerId: 1,
        clientX: 250,
        clientY: 250,
      });
      expect(document.querySelector(".shape-preview-square")).toBeTruthy();
    });

    fireEvent.pointerUp(overlay, {
      pointerId: 1,
      clientX: 250,
      clientY: 250,
    });
    await vi.waitFor(() => {
      expect(controller.addShape).toHaveBeenCalledWith(
        "Square",
        expect.any(Array),
        expect.any(Array),
      );
      expect(useWorkspace.getState().tool).toBe("select");
      expect(controller.setTool).toHaveBeenCalledWith("select");
    });
    cleanup();
  });

  it("draws an arrow with SVG preview and handles pointer cancel", async () => {
    const { cleanup } = setupDom();
    const pdf = {
      getPage: vi.fn(async () => ({
        rotate: 0,
        getViewport: () => ({
          width: 400,
          height: 400,
          convertToPdfPoint: (x: number, y: number) => [x, 400 - y],
        }),
      })),
    };
    const controller = {
      setTool: vi.fn(),
      addShape: vi.fn(async () => {}),
      pdf,
    };
    useWorkspace.getState().set({ tool: "shape", shapeKind: "Arrow" });
    render(<ShapeTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Draw arrow shape" });
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 600,
      bottom: 600,
      width: 600,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerId: 2,
      clientX: 150,
      clientY: 150,
    });
    await vi.waitFor(() => {
      expect(pdf.getPage).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      fireEvent.pointerMove(overlay, {
        pointerId: 2,
        clientX: 300,
        clientY: 200,
      });
      expect(document.querySelector(".shape-preview-svg")).toBeTruthy();
    });

    fireEvent.pointerCancel(overlay);
    expect(document.querySelector(".shape-preview-svg")).toBeNull();
    cleanup();
  });

  it("ignores tiny drag distance", async () => {
    const { cleanup } = setupDom();
    const pdf = {
      getPage: vi.fn(async () => ({
        rotate: 0,
        getViewport: () => ({
          width: 400,
          height: 400,
          convertToPdfPoint: (x: number, y: number) => [x, 400 - y],
        }),
      })),
    };
    const controller = {
      setTool: vi.fn(),
      addShape: vi.fn(async () => {}),
      pdf,
    };
    useWorkspace.getState().set({ tool: "shape", shapeKind: "Line" });
    render(<ShapeTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Draw line shape" });

    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerId: 3,
      clientX: 150,
      clientY: 150,
    });
    await vi.waitFor(() => {
      expect(pdf.getPage).toHaveBeenCalled();
    });

    fireEvent.pointerUp(overlay, {
      pointerId: 3,
      clientX: 151,
      clientY: 151,
    });
    expect(controller.addShape).not.toHaveBeenCalled();
    cleanup();
  });

  it("handles errors during shape creation", async () => {
    const { cleanup } = setupDom();
    const pdf = {
      getPage: vi.fn(async () => ({
        rotate: 0,
        getViewport: () => ({
          width: 400,
          height: 400,
          convertToPdfPoint: (x: number, y: number) => [x, 400 - y],
        }),
      })),
    };
    const controller = {
      setTool: vi.fn(),
      addShape: vi.fn(async () => {
        throw new Error("Add shape failed");
      }),
      pdf,
    };
    useWorkspace.getState().set({ tool: "shape", shapeKind: "Circle" });
    render(<ShapeTool controller={controller as never} />);
    const overlay = screen.getByRole("application", { name: "Draw circle shape" });

    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerId: 4,
      clientX: 150,
      clientY: 150,
    });
    await vi.waitFor(() => {
      expect(pdf.getPage).toHaveBeenCalled();
    });

    fireEvent.pointerUp(overlay, {
      pointerId: 4,
      clientX: 250,
      clientY: 250,
    });
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toBe("Add shape failed");
    });
    cleanup();
  });
});

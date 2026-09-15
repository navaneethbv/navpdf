// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AnnotationToolbar } from "../../src/features/annotations/AnnotationToolbar";
import { Properties } from "../../src/features/annotations/Properties";
import { SnapshotTool } from "../../src/features/annotations/SnapshotTool";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

const controller = {
  setTool: vi.fn(),
  setColor: vi.fn(),
  addTextMarkup: vi.fn(async () => {}),
  addStickyNote: vi.fn(async () => {}),
  currentPage: vi.fn(() => 1),
  deleteSelected: vi.fn(),
  deleteSelectedAnnotation: vi.fn(async () => {}),
  updateSelectedAnnotation: vi.fn(async () => {}),
  moveSelectedAnnotation: vi.fn(async () => {}),
  resizeSelectedAnnotation: vi.fn(async () => {}),
  undo: vi.fn(),
  redo: vi.fn(),
};

describe("AnnotationToolbar", () => {
  it("activates real highlight, ink, and text tools", () => {
    render(
      <AnnotationToolbar controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTitle("Highlight Text"));
    expect(useWorkspace.getState().tool).toBe("highlight");
    expect(controller.setTool).toHaveBeenCalledWith("highlight");
    fireEvent.click(screen.getByTitle("Pencil / Freehand Ink"));
    expect(useWorkspace.getState().tool).toBe("draw");
    fireEvent.click(screen.getByTitle("Text Box"));
    expect(useWorkspace.getState().tool).toBe("text");
  });

  it("enables standard markup, notes, and shapes", async () => {
    render(
      <AnnotationToolbar controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTitle("Underline Text"));
    fireEvent.click(screen.getByTitle("Strike-through Text"));
    fireEvent.click(screen.getByTitle("Sticky Note / Comment"));
    expect(controller.addTextMarkup).toHaveBeenNthCalledWith(1, "Underline");
    expect(controller.addTextMarkup).toHaveBeenNthCalledWith(2, "StrikeOut");
    expect(useWorkspace.getState().activeModal).toBe("sticky-note");
    for (const [label, kind] of [
      ["Rectangle Shape", "Square"],
      ["Circle / Ellipse", "Circle"],
      ["Line", "Line"],
      ["Arrow", "Arrow"],
    ] as const) {
      const button = screen.getByTitle(new RegExp(`^${label}`), {
        exact: false,
      });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(button);
      expect(useWorkspace.getState().tool).toBe("shape");
      expect(useWorkspace.getState().shapeKind).toBe(kind);
    }
  });

  it("updates ink and highlight colors", () => {
    render(
      <AnnotationToolbar controller={controller as never} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTitle("Green"));
    expect(controller.setColor).toHaveBeenCalledWith("#80d49b");
    expect(useWorkspace.getState().inkColor).toBe("#80d49b");
  });

  it("disables toolbar buttons when editingAllowed is false", () => {
    useWorkspace.getState().set({ editingAllowed: false });
    render(
      <AnnotationToolbar controller={controller as never} onClose={() => {}} />,
    );
    expect((screen.getByTitle("Highlight Text") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("Underline Text") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("Pencil / Freehand Ink") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Editing is restricted for this document.")).toBeTruthy();
  });
});

describe("Properties", () => {
  it("shows highlight controls in highlight mode", () => {
    useWorkspace.getState().set({ tool: "highlight", hasSelection: true });
    render(<Properties controller={controller as never} />);
    expect(screen.getByText("Highlight properties")).toBeTruthy();
    fireEvent.click(screen.getByText("Delete selected"));
    expect(controller.deleteSelected).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Highlight color"), {
      target: { value: "#000000" },
    });
    expect(controller.setColor).toHaveBeenCalledWith("#000000");
  });

  it("shows shape properties when shape tool is active", () => {
    useWorkspace.getState().set({ tool: "shape", shapeKind: "Circle" });
    render(<Properties controller={controller as never} />);
    expect(screen.getByText("Shape properties")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Shape stroke color"), {
      target: { value: "#ff0000" },
    });
    expect(useWorkspace.getState().inkColor).toBe("#ff0000");
    fireEvent.change(screen.getByLabelText("Shape stroke width"), {
      target: { value: "6" },
    });
    expect(useWorkspace.getState().inkWidth).toBe(6);
    fireEvent.change(screen.getByLabelText("Shape opacity"), {
      target: { value: "0.8" },
    });
    expect(useWorkspace.getState().inkOpacity).toBe(0.8);
  });

  it("shows controls for selected shape annotation", () => {
    useWorkspace.getState().set({
      selectedAnnotationId: "shape-1",
      comments: [
        {
          id: "shape-1",
          page: 1,
          type: "Square",
          text: "",
          rect: [10, 20, 100, 120],
          color: [1, 0, 0],
          width: 3,
          opacity: 0.8,
        },
      ],
    });
    render(<Properties controller={controller as never} />);
    expect(screen.getByText("Square on page 1")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Selected annotation color"), {
      target: { value: "#0000ff" },
    });
    expect(controller.updateSelectedAnnotation).toHaveBeenCalledWith({
      color: [0, 0, 1],
    });

    const widthSlider = screen.getByLabelText("Selected annotation width");
    fireEvent.change(widthSlider, {
      target: { value: "4.5" },
    });
    fireEvent.pointerUp(widthSlider);
    expect(controller.updateSelectedAnnotation).toHaveBeenCalledWith({
      width: 4.5,
    });

    const opacitySlider = screen.getByLabelText("Selected annotation opacity");
    fireEvent.change(opacitySlider, {
      target: { value: "0.5" },
    });
    fireEvent.pointerUp(opacitySlider);
    expect(controller.updateSelectedAnnotation).toHaveBeenCalledWith({
      opacity: 0.5,
    });

    fireEvent.click(screen.getByText("Move left"));
    expect(controller.moveSelectedAnnotation).toHaveBeenCalledWith(-8, 0);
    fireEvent.click(screen.getByText("Move right"));
    expect(controller.moveSelectedAnnotation).toHaveBeenCalledWith(8, 0);
    fireEvent.click(screen.getByText("Move up"));
    expect(controller.moveSelectedAnnotation).toHaveBeenCalledWith(0, 8);
    fireEvent.click(screen.getByText("Move down"));
    expect(controller.moveSelectedAnnotation).toHaveBeenCalledWith(0, -8);

    fireEvent.click(screen.getByText("Widen"));
    expect(controller.resizeSelectedAnnotation).toHaveBeenCalledWith(8, 0);
    fireEvent.click(screen.getByText("Narrow"));
    expect(controller.resizeSelectedAnnotation).toHaveBeenCalledWith(-8, 0);
    fireEvent.click(screen.getByText("Taller"));
    expect(controller.resizeSelectedAnnotation).toHaveBeenCalledWith(0, 8);
    fireEvent.click(screen.getByText("Shorter"));
    expect(controller.resizeSelectedAnnotation).toHaveBeenCalledWith(0, -8);

    fireEvent.click(screen.getByText("Delete selected"));
    expect(controller.deleteSelectedAnnotation).toHaveBeenCalled();
  });

  it("shows note text editing for selected Text note", () => {
    useWorkspace.getState().set({
      selectedAnnotationId: "note-1",
      comments: [
        {
          id: "note-1",
          page: 2,
          type: "Text",
          text: "Existing note content",
        },
      ],
    });
    render(<Properties controller={controller as never} />);
    expect(screen.getByText("Text on page 2")).toBeTruthy();
    const textarea = screen.getByLabelText("Selected note text");
    expect((textarea as HTMLTextAreaElement).value).toBe("Existing note content");

    fireEvent.change(textarea, { target: { value: "Updated note text" } });
    fireEvent.blur(textarea);
    expect(controller.updateSelectedAnnotation).toHaveBeenCalledWith({
      contents: "Updated note text",
    });
  });

  it("shows generic deletion for other annotation types", () => {
    useWorkspace.getState().set({
      selectedAnnotationId: "hl-1",
      comments: [
        {
          id: "hl-1",
          page: 1,
          type: "Highlight",
          text: "Highlighted phrase",
        },
      ],
    });
    render(<Properties controller={controller as never} />);
    expect(
      screen.getByText("This annotation can be navigated and deleted here."),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Delete selected"));
    expect(controller.deleteSelectedAnnotation).toHaveBeenCalled();
  });

  it("shows document metadata otherwise", () => {
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 1024 * 1024 },
      info: {
        pages: 9,
        encrypted: true,
        title: "",
        author: "",
        version: "1.5",
      },
    });
    render(<Properties controller={controller as never} />);
    expect(screen.getByText("Password protected")).toBeTruthy();
    expect(screen.getByText(/Unlock it from Password Protect/)).toBeTruthy();
    expect(screen.getByText("d.pdf")).toBeTruthy();
  });
});

describe("SnapshotTool", () => {
  it("captures a dragged region and offers copy and download", async () => {
    const onClose = vi.fn();
    const page = document.createElement("div");
    page.className = "page";
    const canvas = document.createElement("canvas");
    canvas.width = 500;
    canvas.height = 500;
    page.append(canvas);
    document.body.append(page);
    const pageRect = {
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    };
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue(pageRect);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(pageRect);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AA==",
    );

    const { container } = render(<SnapshotTool onClose={onClose} />);
    const overlay = container.querySelector(
      ".snapshot-overlay",
    ) as HTMLElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(overlay, { clientX: 60, clientY: 60 });
    fireEvent.mouseUp(overlay);
    expect(await screen.findByText("Snapshot captured!")).toBeTruthy();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(screen.getByText("Download PNG"));
    expect(useWorkspace.getState().status).toBe("Snapshot downloaded");
    expect(click).toHaveBeenCalled();
    click.mockRestore();

    global.fetch = vi.fn(async () => ({
      blob: async () => new Blob(["test"], { type: "image/png" }),
    })) as never;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: vi.fn(async () => {}),
      },
    });

    fireEvent.click(screen.getByText("Copy to Clipboard"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().status).toBe("Snapshot copied to clipboard");
    });

    page.remove();
    vi.restoreAllMocks();
  });

  it("handles clipboard write failure gracefully", async () => {
    const onClose = vi.fn();
    const page = document.createElement("div");
    page.className = "page";
    const canvas = document.createElement("canvas");
    canvas.width = 500;
    canvas.height = 500;
    page.append(canvas);
    document.body.append(page);
    const pageRect = {
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    };
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue(pageRect);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(pageRect);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AA==",
    );

    const { container } = render(<SnapshotTool onClose={onClose} />);
    const overlay = container.querySelector(".snapshot-overlay") as HTMLElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(pageRect);

    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(overlay, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(overlay);
    expect(await screen.findByText("Snapshot captured!")).toBeTruthy();

    global.fetch = vi.fn(async () => ({
      blob: async () => new Blob(["test"], { type: "image/png" }),
    })) as never;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: vi.fn(async () => {
          throw new Error("Clipboard rejected");
        }),
      },
    });

    fireEvent.click(screen.getByText("Copy to Clipboard"));
    await vi.waitFor(() => {
      expect(useWorkspace.getState().status).toBe("Snapshot ready");
    });
    page.remove();
    vi.restoreAllMocks();
  });

  it("errors when drag is outside rendered page", () => {
    const onClose = vi.fn();
    const { container } = render(<SnapshotTool onClose={onClose} />);
    const overlay = container.querySelector(".snapshot-overlay") as HTMLElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(overlay, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(overlay);
    expect(useWorkspace.getState().error).toBe(
      "Keep the snapshot inside a rendered PDF page.",
    );
  });

  it("ignores tiny drags and closes on request", () => {
    const onClose = vi.fn();
    const { container } = render(<SnapshotTool onClose={onClose} />);
    const overlay = container.querySelector(
      ".snapshot-overlay",
    ) as HTMLElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(overlay, { clientX: 12, clientY: 12 });
    fireEvent.mouseUp(overlay);
    expect(screen.queryByText("Snapshot captured!")).toBeNull();
    fireEvent.click(screen.getByLabelText("Cancel snapshot"));
    expect(onClose).toHaveBeenCalled();
  });
});

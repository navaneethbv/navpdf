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
  deleteSelected: vi.fn(),
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

  it("disables pending M2 tools with honest explanations", () => {
    render(
      <AnnotationToolbar controller={controller as never} onClose={() => {}} />,
    );
    for (const label of [
      "Underline Text",
      "Strike-through Text",
      "Sticky Note / Comment",
      "Rectangle Shape",
      "Circle / Ellipse",
      "Line",
      "Arrow",
    ]) {
      const button = screen.getByTitle(new RegExp(`^${label}`), {
        exact: false,
      });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute("title")).toContain("M2");
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
    expect(screen.getByText("d.pdf")).toBeTruthy();
  });
});

describe("SnapshotTool", () => {
  it("captures a dragged region and offers copy and download", async () => {
    const onClose = vi.fn();
    render(<SnapshotTool onClose={onClose} />);
    const overlay = document.querySelector(
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
  });

  it("ignores tiny drags and closes on request", () => {
    const onClose = vi.fn();
    render(<SnapshotTool onClose={onClose} />);
    const overlay = document.querySelector(
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

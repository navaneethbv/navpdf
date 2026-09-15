// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AnnotationSelectionLayer } from "../../src/features/annotations/AnnotationSelectionLayer";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.clearAllMocks();
});

describe("AnnotationSelectionLayer", () => {
  it("renders null when tool is not select", () => {
    const controller = { pdf: null, container: document.createElement("div") };
    useWorkspace.getState().set({ tool: "highlight" });
    const { container } = render(<AnnotationSelectionLayer controller={controller as never} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders selection boxes for shapes and selects them on click", async () => {
    const frame = document.createElement("div");
    frame.className = "viewer-frame";
    const container = document.createElement("div");
    frame.append(container);
    const page = document.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "1");
    frame.append(page);
    document.body.append(frame);

    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 800,
      width: 800,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
      left: 50,
      top: 50,
      right: 450,
      bottom: 450,
      width: 400,
      height: 400,
      x: 50,
      y: 50,
      toJSON: () => {},
    });

    const pdf = {
      getPage: vi.fn(async () => ({
        rotate: 0,
        getViewport: () => ({
          width: 400,
          height: 400,
          convertToViewportPoint: (x: number, y: number) => [x, 400 - y],
        }),
      })),
    };
    const controller = {
      container,
      pdf,
      selectAnnotation: vi.fn(),
    };

    useWorkspace.getState().set({
      tool: "select",
      comments: [
        {
          id: "s1",
          page: 1,
          type: "Square",
          text: "",
          rect: [50, 50, 150, 150],
        },
      ],
      selectedAnnotationId: "s1",
    });

    render(<AnnotationSelectionLayer controller={controller as never} />);

    await vi.waitFor(() => {
      const box = screen.getByRole("button", {
        name: "Select square on page 1",
      });
      expect(box).toBeTruthy();
      expect(box.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(box);
      expect(controller.selectAnnotation).toHaveBeenCalledWith("s1");
    });

    frame.remove();
  });
});

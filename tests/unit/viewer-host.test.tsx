// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  AnnotationEditorType: { NONE: 0, HIGHLIGHT: 1, FREETEXT: 2, INK: 3 },
  AnnotationMode: { ENABLE: 1 },
  AnnotationEditorParamsType: { HIGHLIGHT_COLOR: 7 },
  GlobalWorkerOptions: { workerSrc: "" },
  PDFDataRangeTransport: class {},
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    on() {}
    dispatch() {}
  },
  PDFFindController: class {
    constructor(options: object) {
      Object.assign(this, options);
    }
    setDocument() {}
  },
  PDFLinkService: class {
    externalLinkEnabled = true;
    constructor(options: object) {
      Object.assign(this, options);
    }
    setViewer() {}
    setDocument() {}
  },
  PDFViewer: class {
    currentScale = 1;
    currentScaleValue: unknown = null;
    constructor(options: object) {
      Object.assign(this, options);
    }
    setDocument() {}
  },
  ScrollMode: { PAGE: 1, VERTICAL: 0 },
  SpreadMode: { ODD: 1, NONE: 0 },
}));

import { ViewerHost } from "../../src/features/viewer/ViewerHost";
import { useWorkspace } from "../../src/stores/workspace";
import type { ViewerController } from "../../src/features/viewer/controller";

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({ busy: false, status: "Ready", error: "" });
});

describe("ViewerHost", () => {
  it("zooms on ctrl+wheel and pans with the hand tool", () => {
    const onReady = vi.fn();
    render(<ViewerHost onReady={onReady} />);
    const controller = onReady.mock.calls[0][0] as ViewerController;
    const zoom = vi.spyOn(controller, "zoom");
    const frame = screen.getByLabelText("PDF document");
    const wheel = new Event("wheel", { bubbles: true, cancelable: true });
    Object.defineProperties(wheel, {
      ctrlKey: { value: true },
      deltaY: { value: -100 },
    });
    frame.dispatchEvent(wheel);
    expect(zoom).toHaveBeenCalled();
    useWorkspace.getState().set({ tool: "hand" });
    fireEvent.pointerDown(frame, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(frame);
    fireEvent.pointerCancel(frame);
  });
  it("creates a controller and reports readiness", () => {
    const onReady = vi.fn();
    render(<ViewerHost onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
    const controller = onReady.mock.calls[0][0] as ViewerController;
    expect(controller.viewer).toBeTruthy();
  });

  it("hides the frame without a document and reflects hand/busy state", () => {
    const { container, rerender } = render(
      <ViewerHost onReady={() => {}} />,
    );
    expect(
      container.querySelector(".viewer-frame.hidden"),
    ).toBeTruthy();
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 10 },
      tool: "hand",
      busy: true,
    });
    rerender(<ViewerHost onReady={() => {}} />);
    expect(
      container.querySelector(".pdf-container.hand-tool"),
    ).toBeTruthy();
    expect(screen.getByLabelText("PDF document")).toBeTruthy();
  });


});

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
  it("retains the document when the visual subtree is removed for recovery", async () => {
    const onReady = vi.fn();
    const mounted = render(<ViewerHost onReady={onReady} />);
    const controller = onReady.mock.calls[0][0] as ViewerController;
    const pdf = { saveDocument: async () => new Uint8Array([37, 80, 68, 70]) };
    controller.pdf = pdf as never;
    mounted.unmount();
    await Promise.resolve();
    expect(controller.pdf).toBe(pdf);
  });

  it("creates a controller and reports readiness", () => {
    const onReady = vi.fn();
    render(<ViewerHost onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
    const controller = onReady.mock.calls[0][0] as ViewerController;
    expect(controller.viewer).toBeTruthy();
  });

  it("hides the frame without a document and reflects hand/busy state", () => {
    const { container, rerender } = render(<ViewerHost onReady={() => {}} />);
    expect(container.querySelector(".viewer-frame.hidden")).toBeTruthy();
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 10 },
      tool: "hand",
      busy: true,
    });
    rerender(<ViewerHost onReady={() => {}} />);
    expect(container.querySelector(".pdf-container.hand-tool")).toBeTruthy();
    expect(screen.getByLabelText("PDF document")).toBeTruthy();
  });

  it("prompts before an external link can leave the document", () => {
    const onReady = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ViewerHost onReady={onReady} />);
    const frame = screen.getByLabelText("PDF document");
    const anchor = document.createElement("a");
    anchor.href = "https://example.org/reference";
    frame.append(anchor);
    const click = fireEvent.click(anchor);
    expect(click).toBe(false);
    expect(screen.getByRole("dialog", { name: "Open external link" })).toBeTruthy();
    expect(screen.getByText("https://example.org/reference")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/allow this host/i));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(open).toHaveBeenCalledWith(
      "https://example.org/reference",
      "_blank",
      "noopener,noreferrer",
    );
    const second = document.createElement("a");
    second.href = "https://example.org/second";
    frame.append(second);
    fireEvent.click(second);
    expect(open).toHaveBeenCalledWith(
      "https://example.org/second",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("shows a blocked message for unsafe external link schemes", () => {
    render(<ViewerHost onReady={() => {}} />);
    const frame = screen.getByLabelText("PDF document");
    const anchor = document.createElement("a");
    anchor.href = "javascript:alert(1)";
    frame.append(anchor);
    fireEvent.click(anchor);
    expect(screen.getByRole("alert").textContent).toMatch(/blocked unsafe URI scheme/i);
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });
});

it("fits the first visible document and preserves later user zoom", () => {
  let resized = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const onReady = vi.fn();
  render(<ViewerHost onReady={onReady} />);
  const controller = onReady.mock.calls[0][0] as ViewerController;
  controller.pdf = {} as never;
  controller.viewer.update = vi.fn();
  const zoom = vi.spyOn(controller, "zoom");
  const frame = screen.getByLabelText("PDF document");
  resized();
  expect(zoom).not.toHaveBeenCalled();
  Object.defineProperties(frame, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  resized();
  expect(zoom).toHaveBeenCalledWith(useWorkspace.getState().local.preferences.defaultZoom);
  zoom.mockClear();
  controller.viewer.currentScaleValue = "1.5";
  controller.viewer.currentScale = 1.5;
  resized();
  expect(zoom).not.toHaveBeenCalled();
  expect(controller.viewer.update).toHaveBeenCalledTimes(2);
  controller.viewer.currentScaleValue = "page-width";
  resized();
  expect(zoom).toHaveBeenLastCalledWith("page-width");
  controller.viewer.currentScaleValue = "page-fit";
  resized();
  expect(zoom).toHaveBeenLastCalledWith("page-fit");
});

describe("ViewerHost viewer tools", () => {
  it("copies an Alt-drag column of text instead of whole lines", () => {
    const onReady = vi.fn();
    render(<ViewerHost onReady={onReady} />);
    const frame = screen.getByLabelText("PDF document");
    const page = document.createElement("div");
    page.className = "page";
    page.innerHTML = '<div class="textLayer"><span>Left side</span><span>Right side</span></div>';
    const [left, right] = page.querySelectorAll("span");
    left.getBoundingClientRect = () =>
      ({ left: 0, top: 10, width: 90, height: 10, right: 90, bottom: 20 }) as DOMRect;
    right.getBoundingClientRect = () =>
      ({ left: 200, top: 10, width: 100, height: 10, right: 300, bottom: 20 }) as DOMRect;
    frame.firstElementChild!.append(page);
    fireEvent.pointerDown(right, {
      altKey: true,
      button: 0,
      pointerId: 4,
      clientX: 190,
      clientY: 0,
    });
    fireEvent.pointerMove(frame, { pointerId: 4, clientX: 320, clientY: 40 });
    fireEvent.pointerUp(frame, { pointerId: 4, clientX: 320, clientY: 40 });
    expect(useWorkspace.getState().status).toMatch(/Column selected/);
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    const setData = vi.fn();
    Object.defineProperty(copy, "clipboardData", { value: { setData } });
    document.dispatchEvent(copy);
    expect(setData).toHaveBeenCalledWith("text/plain", "Right side");
    expect(copy.defaultPrevented).toBe(true);
    // A plain click clears the column, so copying falls back to the normal selection.
    fireEvent.pointerDown(frame, { button: 0, pointerId: 5 });
    setData.mockClear();
    document.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true }));
    expect(setData).not.toHaveBeenCalled();
  });

  it("offers to copy or save the image under a right-click", async () => {
    const onReady = vi.fn();
    const view = render(<ViewerHost onReady={onReady} />);
    const controller = onReady.mock.calls[0][0] as ViewerController;
    view.rerender(<ViewerHost onReady={onReady} controller={controller} />);
    const image = new Blob(["png"], { type: "image/png" });
    const imageAt = vi.spyOn(controller, "imageAt").mockResolvedValue(image);
    const frame = screen.getByLabelText("PDF document");
    const page = document.createElement("div");
    page.className = "page";
    page.dataset.pageNumber = "2";
    frame.firstElementChild!.append(page);
    document.elementsFromPoint = () => [page];
    const write = vi.fn(async () => {});
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly items: Record<string, Blob>) {}
      },
    );
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    fireEvent.contextMenu(page, { clientX: 30, clientY: 40 });
    expect(imageAt).toHaveBeenCalledWith(2, 30, 40);
    fireEvent.click(await screen.findByText("Copy image"));
    expect(write).toHaveBeenCalledWith([{ items: { "image/png": image } }]);
    vi.unstubAllGlobals();
  });

  it("shows the current page size while the pointer is in the lower-left quarter", async () => {
    const onReady = vi.fn();
    const view = render(<ViewerHost onReady={onReady} />);
    const controller = onReady.mock.calls[0][0] as ViewerController;
    Object.assign(controller.viewer, {
      pdfDocument: {
        numPages: 1,
        getPage: async () => ({ view: [0, 0, 612, 792], rotate: 90, userUnit: 1 }),
      },
    });
    useWorkspace.getState().set({ document: { id: "d", name: "d.pdf", size: 10 }, page: 1 });
    view.rerender(<ViewerHost onReady={onReady} controller={controller} />);
    const frame = screen.getByLabelText("PDF document");
    frame.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400 }) as DOMRect;
    fireEvent.pointerMove(frame, { clientX: 300, clientY: 50 });
    expect(screen.queryByLabelText("Page size")).toBeNull();
    fireEvent.pointerMove(frame, { clientX: 50, clientY: 350 });
    expect((await screen.findByLabelText("Page size")).textContent).toBe(
      "11 × 8.5 in (279.4 × 215.9 mm)",
    );
    fireEvent.pointerLeave(frame);
    expect(screen.queryByLabelText("Page size")).toBeNull();
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  AnnotationEditorType: { NONE: 0, HIGHLIGHT: 9, FREETEXT: 3, INK: 15 },
  AnnotationMode: { ENABLE: 1, ENABLE_FORMS: 2 },
  AnnotationEditorParamsType: { HIGHLIGHT_COLOR: 7 },
}));

vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", () => {
  class EventBus {
    private listeners = new Map<string, { handler: (event: unknown) => void; once: boolean }[]>();
    on(name: string, handler: (event: unknown) => void, options?: { once?: boolean }) {
      const list = this.listeners.get(name) ?? [];
      list.push({ handler, once: !!options?.once });
      this.listeners.set(name, list);
    }
    dispatch(name: string, event: unknown = {}) {
      const list = this.listeners.get(name) ?? [];
      this.listeners.set(
        name,
        list.filter((listener) => !listener.once),
      );
      for (const listener of list) listener.handler(event);
    }
  }
  class PDFViewer {
    currentPageNumber = 1;
    currentScale = 1;
    currentScaleValue: string | number = "1";
    pagesRotation = 0;
    pageColors: unknown = null;
    annotationEditorMode: unknown = null;
    pdfDocument: unknown = null;
    shown: unknown[] = [];
    optionalContentConfigPromise: Promise<unknown> = Promise.resolve(null);
    firstPagePromise = Promise.resolve(true);
    eventBus!: EventBus;
    constructor(options: object) {
      Object.assign(this, options);
    }
    setDocument(pdf: { getOptionalContentConfig?: () => Promise<unknown> } | null) {
      this.pdfDocument = pdf;
      this.shown.push(pdf);
      // PDF.js resets the page, rotation and layer state when it shows a document.
      this.currentPageNumber = 1;
      this.pagesRotation = 0;
      this.optionalContentConfigPromise =
        pdf?.getOptionalContentConfig?.() ?? Promise.resolve(null);
      if (pdf) queueMicrotask(() => this.eventBus.dispatch("pagesinit"));
    }
  }
  return {
    EventBus,
    PDFFindController: class {
      setDocument() {}
    },
    PDFLinkService: class {
      setViewer() {}
      setDocument() {}
    },
    PDFViewer,
    ScrollMode: { PAGE: 1, VERTICAL: 0 },
    SpreadMode: { ODD: 1, NONE: 0 },
  };
});

vi.mock("../../src/services/native", () => ({
  native: true,
  markDirty: vi.fn(async () => {}),
  rememberPage: vi.fn(async () => {}),
  commitWorkingRevision: vi.fn(),
}));

const copyTask = { promise: Promise.resolve({}), destroy: vi.fn(async () => {}) };
vi.mock("../../src/services/pdf", () => ({ loadPdfFromBytes: vi.fn(() => copyTask) }));
vi.mock("../../src/features/pages/print-options", () => ({
  preparePrintContent: vi.fn(async () => new Uint8Array([7])),
}));

import { ViewerController } from "../../src/features/viewer/controller";
import { useWorkspace } from "../../src/stores/workspace";
import { preparePrintContent } from "../../src/features/pages/print-options";
import { loadPdfFromBytes } from "../../src/services/pdf";

function layerConfig() {
  return { setVisibility: vi.fn() };
}

function makePdf(config = layerConfig()) {
  return {
    numPages: 6,
    annotationStorage: {} as { onSetModified?: () => void },
    saveDocument: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getOptionalContentConfig: vi.fn(async () => config),
    getPage: vi.fn(async () => ({
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => []),
    })),
    getOutline: vi.fn(async () => null),
    getJSActions: vi.fn(async () => null),
    getFieldObjects: vi.fn(async () => null),
  };
}

type TestViewer = ViewerController["viewer"] & { shown: unknown[] };

let controller: ViewerController;
let viewer: TestViewer;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
  const container = document.createElement("div");
  const pages = document.createElement("div");
  container.append(pages);
  controller = new ViewerController(container, pages);
  viewer = controller.viewer as TestViewer;
  return () => controller.destroy();
});

async function open(pdf = makePdf()) {
  await controller.attach(pdf as never);
  await Promise.resolve();
  return pdf;
}

describe("hiding comments", () => {
  it("shows a comment-free copy at the same place and restores the document", async () => {
    const copy = { numPages: 6, getOptionalContentConfig: vi.fn(async () => layerConfig()) };
    copyTask.promise = Promise.resolve(copy);
    const pdf = await open();
    useWorkspace.getState().set({ layers: [{ id: "4R", name: "Notes", visible: false }] });
    viewer.currentPageNumber = 4;
    viewer.pagesRotation = 90;
    viewer.currentScaleValue = "1.5";

    await controller.setCommentsHidden(true);

    expect(preparePrintContent).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "document");
    expect(loadPdfFromBytes).toHaveBeenCalledWith(new Uint8Array([7]));
    expect(viewer.pdfDocument).toBe(copy);
    expect(viewer.currentPageNumber).toBe(4);
    expect(viewer.pagesRotation).toBe(90);
    const copyLayers = await copy.getOptionalContentConfig.mock.results[0].value;
    expect(copyLayers.setVisibility).toHaveBeenCalledWith("4R", false);
    expect(controller.pdf).toBe(pdf);
    expect(useWorkspace.getState().commentsHidden).toBe(true);

    await controller.setCommentsHidden(false);
    expect(viewer.pdfDocument).toBe(pdf);
    expect(viewer.currentPageNumber).toBe(4);
    expect(copyTask.destroy).toHaveBeenCalledOnce();
    expect(useWorkspace.getState().commentsHidden).toBe(false);
  });

  it("shows comments again before a page-view editor starts", async () => {
    copyTask.promise = Promise.resolve(makePdf());
    const pdf = await open();
    await controller.setCommentsHidden(true);
    controller.setTool("draw");
    await vi.waitFor(() => expect(useWorkspace.getState().tool).toBe("draw"));
    expect(viewer.pdfDocument).toBe(pdf);
    expect(viewer.annotationEditorMode).toEqual({ mode: 15 });
    expect(useWorkspace.getState().commentsHidden).toBe(false);
  });

  it("drops the copy when an edit attaches a new revision", async () => {
    copyTask.promise = Promise.resolve(makePdf());
    await open();
    await controller.setCommentsHidden(true);
    const revision = makePdf();
    await open(revision);
    expect(viewer.pdfDocument).toBe(revision);
    expect(copyTask.destroy).toHaveBeenCalledOnce();
    expect(useWorkspace.getState().commentsHidden).toBe(false);
  });

  it("hides comments in the revision that keeps unsaved page-view edits", async () => {
    copyTask.promise = Promise.resolve(makePdf());
    const pdf = await open();
    const revision = makePdf();
    revision.saveDocument.mockResolvedValue(new Uint8Array([4, 5]));
    vi.spyOn(controller, "replaceWithBytes").mockImplementation(async () => {
      await controller.attach(revision as never);
    });
    pdf.annotationStorage.onSetModified?.();
    await controller.setCommentsHidden(true);
    expect(controller.pdf).toBe(revision);
    expect(preparePrintContent).toHaveBeenCalledWith(new Uint8Array([4, 5]), "document");
    expect(useWorkspace.getState().commentsHidden).toBe(true);
  });

  it("refuses a read-only encrypted document", async () => {
    await open();
    useWorkspace.getState().set({
      info: { pages: 6, encrypted: true, title: "", author: "", version: "" },
    });
    await expect(controller.setCommentsHidden(true)).rejects.toThrow(/password-protected/);
    expect(loadPdfFromBytes).not.toHaveBeenCalled();
  });
});

describe("page colours", () => {
  it("redraws the shown pages only when the colours change", async () => {
    const pdf = await open();
    viewer.currentPageNumber = 3;
    const colors = { foreground: "#ffff00", background: "#000000" };
    controller.setPageColors(colors);
    await vi.waitFor(() => expect(viewer.shown).toHaveLength(2));
    expect(viewer.pageColors).toEqual(colors);
    expect(viewer.pdfDocument).toBe(pdf);
    await vi.waitFor(() => expect(viewer.currentPageNumber).toBe(3));
    controller.setPageColors({ ...colors });
    controller.setPageColors(null);
    await vi.waitFor(() => expect(viewer.shown).toHaveLength(3));
    expect(viewer.pageColors).toBeNull();
  });

  it("commits edits held by the page view instead of redrawing over them", async () => {
    const pdf = await open();
    const replace = vi.spyOn(controller, "replaceWithBytes").mockResolvedValue();
    pdf.annotationStorage.onSetModified?.();
    controller.setPageColors({ foreground: "#ffffff", background: "#000000" });
    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "Page edits kept"),
    );
    expect(viewer.shown).toHaveLength(1);
  });
});

describe("zooming to an area", () => {
  function pageView(scale: () => number) {
    const div = document.createElement("div");
    div.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
    return {
      div,
      get viewport() {
        const factor = scale();
        return {
          convertToPdfPoint: (x: number, y: number) => [x / factor, y / factor],
          convertToViewportPoint: (x: number, y: number) => [x * factor, y * factor],
        };
      },
    };
  }

  it("zooms in around a click and fills the window with a dragged area", async () => {
    await open();
    const view = pageView(() => viewer.currentScale);
    Object.assign(viewer, { getPageView: () => view });
    Object.defineProperty(controller.container, "clientWidth", { value: 840 });
    Object.defineProperty(controller.container, "clientHeight", { value: 640 });
    controller.container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;

    controller.zoomToArea(1, { x: 300, y: 250 }, { x: 301, y: 251 });
    expect(viewer.currentScale).toBeCloseTo(1.25);
    // The clicked point, (201, 201) on the page, stays under the pointer.
    expect(controller.container.scrollLeft).toBeCloseTo(50.25, 0);

    viewer.currentScale = 1;
    controller.zoomToArea(1, { x: 100, y: 50 }, { x: 300, y: 450 }, false);
    // 200 by 400 pixels at 100%: the height limits the zoom to (640 - 40) / 400.
    expect(viewer.currentScale).toBeCloseTo(1.5);

    controller.zoomToArea(1, { x: 200, y: 200 }, { x: 200, y: 200 }, true);
    expect(viewer.currentScale).toBeCloseTo(1.2);
  });
});

describe("background tabs", () => {
  it("parks a document with its histories and shows it again where it was", async () => {
    const pdf = await open();
    const history = controller.history;
    const views = controller.views;
    const layers = [{ id: "4R", name: "Notes", visible: false }];
    useWorkspace.getState().set({ layers });
    viewer.currentPageNumber = 5;
    viewer.pagesRotation = 180;
    viewer.currentScaleValue = "2";
    Object.assign(viewer, {
      _location: { pageNumber: 5, left: 10, top: 700 },
      scrollPageIntoView: vi.fn(),
    });

    const parked = await controller.park();
    expect(parked).toMatchObject({
      pdf,
      history,
      views,
      page: 5,
      rotation: 180,
      scale: "2",
      layers,
    });
    expect(controller.pdf).toBeNull();
    expect(viewer.pdfDocument).toBeNull();
    expect(controller.history).not.toBe(history);

    await open(makePdf());
    const config = layerConfig();
    pdf.getOptionalContentConfig.mockResolvedValue(config);
    await controller.resume(parked!);
    expect(controller.pdf).toBe(pdf);
    expect(controller.history).toBe(history);
    expect(controller.views).toBe(views);
    // The window returns to the same point on the page, not just the same scroll offset.
    expect(viewer.scrollPageIntoView).toHaveBeenCalledWith({
      pageNumber: 5,
      destArray: [null, { name: "XYZ" }, 10, 700, null],
      allowNegativeOffset: true,
    });
    expect(viewer.pagesRotation).toBe(180);
    expect(config.setVisibility).toHaveBeenCalledWith("4R", false);
    expect(useWorkspace.getState()).toMatchObject({ viewRotation: 180, layers });
  });

  it("commits page-view edits before parking so they are drawn when the tab returns", async () => {
    const pdf = await open();
    const replace = vi.spyOn(controller, "replaceWithBytes").mockResolvedValue();
    pdf.annotationStorage.onSetModified?.();
    await controller.park();
    expect(replace).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "Page edits kept");
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  AnnotationEditorType: { NONE: 0, HIGHLIGHT: 1, FREETEXT: 2, INK: 3 },
  AnnotationMode: { ENABLE: 1, ENABLE_FORMS: 2 },
  AnnotationEditorParamsType: { HIGHLIGHT_COLOR: 7 },
}));

vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    on() {}
    dispatch() {}
  },
  PDFFindController: class {
    setDocument() {}
  },
  PDFLinkService: class {
    pdfViewer: { currentPageNumber: number } | null = null;
    setViewer(viewer: { currentPageNumber: number }) {
      this.pdfViewer = viewer;
    }
    setDocument() {}
    get page() {
      return this.pdfViewer?.currentPageNumber ?? 1;
    }
    async goToDestination(dest: [number]) {
      this.pdfViewer!.currentPageNumber = dest[0];
    }
    goToPage(page: number) {
      this.pdfViewer!.currentPageNumber = page;
    }
  },
  PDFViewer: class {
    currentPageNumber = 1;
    optionalContentConfigPromise: Promise<unknown> = Promise.resolve(null);
    firstPagePromise = Promise.resolve(true);
    constructor(options: object) {
      Object.assign(this, options);
    }
    setDocument() {}
  },
  ScrollMode: { PAGE: 1, VERTICAL: 0 },
  SpreadMode: { ODD: 1, NONE: 0 },
}));

vi.mock("../../src/services/native", () => ({
  native: true,
  markDirty: vi.fn(async () => {}),
  rememberPage: vi.fn(async () => {}),
  rememberView: vi.fn(async () => {}),
  commitWorkingRevision: vi.fn(),
}));

vi.mock("../../src/services/pdf", () => ({ loadPdfFromBytes: vi.fn() }));

import { ViewerController } from "../../src/features/viewer/controller";
import { rememberView } from "../../src/services/native";
import { useWorkspace } from "../../src/stores/workspace";

function optionalContent() {
  const groups = new Map([
    ["1R", { name: "Notes", visible: true }],
    ["2R", { name: "", visible: false }],
    ["3R", { name: "Hidden from list", visible: true }],
  ]);
  return {
    [Symbol.iterator]: () => groups.entries(),
    getOrder: () => [{ name: "Group", order: ["2R"] }, "1R", "missing"],
    setVisibility: vi.fn((id: string, visible: boolean) => {
      groups.get(id)!.visible = visible;
    }),
  };
}

function makePdf(numPages = 10) {
  return {
    numPages,
    annotationStorage: {},
    getPage: vi.fn(async (page: number) => ({
      getTextContent: vi.fn(async () => ({
        items: [{ str: `Page ${page}`, hasEOL: true }, { str: "body" }],
      })),
      getAnnotations: vi.fn(async () => []),
    })),
    getOutline: vi.fn(async () => null),
    getJSActions: vi.fn(async () => null),
    getFieldObjects: vi.fn(async () => null),
  };
}

let controller: ViewerController;

beforeEach(() => {
  useWorkspace.getState().reset();
  const container = document.createElement("div");
  const pages = document.createElement("div");
  container.append(pages);
  controller = new ViewerController(container, pages);
  return () => controller.destroy();
});

async function attach(config: unknown = null) {
  controller.viewer.optionalContentConfigPromise = Promise.resolve(config) as never;
  await controller.attach(makePdf() as never);
}

describe("Reader navigation in the viewer controller", () => {
  it("records page commands and link jumps for Previous View and Next View", async () => {
    await attach();
    controller.goTo(4);
    await controller.links.goToDestination([9]);
    controller.links.goToPage(9);
    expect(useWorkspace.getState()).toMatchObject({ canGoBack: true, canGoForward: false });
    controller.goBack();
    expect(controller.viewer.currentPageNumber).toBe(4);
    controller.goBack();
    expect(controller.viewer.currentPageNumber).toBe(1);
    expect(useWorkspace.getState()).toMatchObject({ canGoBack: false, canGoForward: true });
    controller.goForward();
    expect(controller.viewer.currentPageNumber).toBe(4);
    controller.goTo(2);
    expect(useWorkspace.getState().canGoForward).toBe(false);
  });

  it("starts each opened document with empty view history", async () => {
    await attach();
    controller.goTo(5);
    await attach();
    expect(useWorkspace.getState().canGoBack).toBe(false);
  });

  it("lists ordered layers and changes their visibility in the view", async () => {
    const config = optionalContent();
    await attach(config);
    expect(useWorkspace.getState().layers).toEqual([
      { id: "2R", name: "Unnamed layer", visible: false },
      { id: "1R", name: "Notes", visible: true },
    ]);
    await controller.setLayerVisibility("2R", true);
    expect(config.setVisibility).toHaveBeenCalledWith("2R", true);
    expect(useWorkspace.getState().layers[0].visible).toBe(true);
    expect(useWorkspace.getState().dirty).toBe(false);
  });

  it("resets layers to the document's initial visibility", async () => {
    const config = optionalContent();
    await attach(config);
    await controller.setLayerVisibility("2R", true);
    await controller.setLayerVisibility("1R", false);
    const initial = new Map([
      ["1R", { visible: true }],
      ["2R", { visible: false }],
      ["3R", { visible: true }],
    ]);
    (
      controller.pdf as unknown as { getOptionalContentConfig: () => unknown }
    ).getOptionalContentConfig = vi.fn(async () => ({
      [Symbol.iterator]: () => initial.entries(),
    }));
    await controller.resetLayers();
    expect(useWorkspace.getState().layers).toEqual([
      { id: "2R", name: "Unnamed layer", visible: false },
      { id: "1R", name: "Notes", visible: true },
    ]);
  });

  it("remembers a saved file's view and restores page, zoom and layout", async () => {
    vi.useFakeTimers();
    try {
      await attach();
      vi.mocked(rememberView).mockClear();
      useWorkspace.getState().set({
        document: { id: "doc", name: "a.pdf", size: 1 },
        page: 3,
        layout: "single",
      });
      controller.viewer.currentScaleValue = "page-width";
      controller.setLayout("single");
      vi.advanceTimersByTime(900);
      expect(rememberView).toHaveBeenCalledWith("doc", {
        page: 3,
        zoom: "page-width",
        layout: "single",
      });
      vi.mocked(rememberView).mockClear();
      useWorkspace.getState().set({
        document: { id: "imported", name: "b.pdf", size: 1, unsaved: true },
      });
      controller.setLayout("continuous");
      vi.advanceTimersByTime(900);
      expect(rememberView).not.toHaveBeenCalled();
      controller.applyView({ page: 7, zoom: "1.5", layout: "spread" });
      expect(controller.viewer.currentPageNumber).toBe(7);
      expect(controller.viewer.currentScaleValue).toBe("1.5");
      expect(useWorkspace.getState().layout).toBe("spread");
    } finally {
      vi.useRealTimers();
    }
  });

  it("extracts page text for Read Out Loud", async () => {
    await attach();
    await expect(controller.pageText(3)).resolves.toBe("Page 3\n body");
    await expect(controller.pageText(11)).resolves.toBe("");
  });
});

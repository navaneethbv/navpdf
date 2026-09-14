// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  AnnotationEditorType: { NONE: 0, HIGHLIGHT: 1, FREETEXT: 2, INK: 3 },
  AnnotationMode: { ENABLE: 1 },
  AnnotationEditorParamsType: { HIGHLIGHT_COLOR: 7 },
  GlobalWorkerOptions: { workerSrc: "" },
  PDFDataRangeTransport: class {},
  getDocument: vi.fn(),
}));

const busHandlers = new Map<string, (event: never) => void>();

vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    on(name: string, handler: (event: never) => void) {
      busHandlers.set(name, handler);
    }
    dispatch() {}
  },
  PDFFindController: class {
    selected: { pageIdx: number } | null = null;
    pageMatches: number[][] = [];
    pageMatchesLength: number[][] = [];
    _offset: { pageIdx: number | null; matchIdx: number | null; wrapped: boolean } = {
      pageIdx: null,
      matchIdx: null,
      wrapped: false,
    };
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
    async goToDestination() {}
  },
  PDFViewer: class {
    annotationEditorMode: unknown = null;
    currentScaleValue: unknown = null;
    currentScale = 1;
    currentPageNumber = 1;
    scrollMode = 0;
    spreadMode = 0;
    firstPagePromise: Promise<boolean> = Promise.resolve(true);
    constructor(options: object) {
      Object.assign(this, options);
    }
    setDocument() {}
  },
  ScrollMode: { PAGE: 1, VERTICAL: 0 },
  SpreadMode: { ODD: 1, NONE: 0 },
}));

vi.mock("../../src/services/native", () => ({
  native: false,
  markDirty: vi.fn(async () => {}),
  rememberPage: vi.fn(async () => {}),
  commitWorkingRevision: vi.fn(async () => "rev-mock"),
}));

vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: vi.fn(),
}));

import { ViewerController } from "../../src/features/viewer/controller";
import { useWorkspace } from "../../src/stores/workspace";
import { rememberPage } from "../../src/services/native";

function makePdf(numPages = 3) {
  return {
    numPages,
    annotationStorage: {} as Record<string, () => void>,
    getPage: vi.fn(async () => ({
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => []),
    })),
    getOutline: vi.fn(async () => null),
  };
}

let controller: ViewerController;

beforeEach(() => {
  vi.clearAllMocks();
  busHandlers.clear();
  useWorkspace.getState().reset();
  act_sync();
  const container = document.createElement("div");
  const pages = document.createElement("div");
  container.append(pages);
  document.body.append(container);
  controller = new ViewerController(container, pages);
  return () => {
    controller.destroy();
    container.remove();
  };
});

function act_sync() {
  useWorkspace.getState().set({ busy: false, status: "Ready", error: "" });
}

describe("ViewerController bus reactions", () => {
  it("initializes layout on pagesinit and tracks pages, scale, and render", async () => {
    const pdf = makePdf(5);
    await controller.attach(pdf as never);
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 10 },
    });
    busHandlers.get("pagesinit")!(undefined as never);
    busHandlers.get("pagechanging")!({ pageNumber: 3 } as never);
    expect(useWorkspace.getState().page).toBe(3);
    busHandlers.get("scalechanging")!({ scale: 2 } as never);
    expect(useWorkspace.getState().zoom).toBe(200);
    busHandlers.get("textlayerrendered")!({ error: new Error("x") } as never);
    expect(useWorkspace.getState().error).toContain("Text selection");
    busHandlers.get("pagerendered")!(undefined as never);
    expect(useWorkspace.getState().renderedPages).toBeGreaterThanOrEqual(0);
    vi.useFakeTimers();
    busHandlers.get("pagechanging")!({ pageNumber: 2 } as never);
    await vi.advanceTimersByTimeAsync(600);
    expect(rememberPage).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("forwards editor params and mode switches it understands", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    const editor = { updateParams: vi.fn() };
    busHandlers.get("annotationeditoruimanager")!({ uiManager: editor } as never);
    busHandlers.get("switchannotationeditorparams")!({ type: 7, value: "#fff" } as never);
    expect(editor.updateParams).toHaveBeenCalledWith(7, "#fff");
    busHandlers.get("switchannotationeditormode")!({ mode: 1 } as never);
    expect(
      (controller.viewer.annotationEditorMode as { mode: number }).mode,
    ).toBe(1);
    busHandlers.get("switchannotationeditormode")!({ mode: 99 } as never);
    expect(
      (controller.viewer.annotationEditorMode as { mode: number }).mode,
    ).toBe(1);
  });

  it("reports annotation storage failures while marking dirty", async () => {
    const pdf = makePdf();
    vi.mocked(await import("../../src/services/native").then((m) => m.markDirty)).mockRejectedValueOnce(
      new Error("ipc down"),
    );
    await controller.attach(pdf as never);
    const storage = (pdf as { annotationStorage: Record<string, () => void> })
      .annotationStorage;
    storage.onSetModified();
    await vi.waitFor(() => {
      expect(useWorkspace.getState().error).toContain(
        "Native change tracking is unavailable",
      );
    });
    expect(useWorkspace.getState().dirty).toBe(true);
  });

  it("leaves external-link clicks on internal links alone", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    const anchor = document.createElement("a");
    anchor.className = "internalLink";
    anchor.textContent = "internal";
    (controller.container as HTMLDivElement).append(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("ViewerController search results", () => {
  it("builds debounced result contexts from page text", async () => {
    vi.useFakeTimers();
    const pdf = makePdf(2);
    pdf.getPage = vi.fn(async () => ({
      getTextContent: vi.fn(async () => ({
        items: [{ str: "the quick brown river jumps ", hasEOL: false }, { str: "over the lazy river bank", hasEOL: true }],
      })),
      getAnnotations: vi.fn(async () => []),
    }));
    await controller.attach(pdf as never);
    const find = controller.find as unknown as {
      pageMatches: number[][];
      pageMatchesLength: number[][];
    };
    find.pageMatches = [[16, 44]];
    find.pageMatchesLength = [[5, 5]];
    busHandlers.get("updatefindmatchescount")!({
      matchesCount: { total: 2 },
    } as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(useWorkspace.getState().results).toHaveLength(2);
    expect(useWorkspace.getState().results[0].match).toBe("river");
    vi.useRealTimers();
  });

  it("surfaces search context failures", async () => {
    vi.useFakeTimers();
    const pdf = makePdf(1);
    pdf.getPage = vi.fn(async () => {
      throw new Error("no page");
    });
    await controller.attach(pdf as never);
    const find = controller.find as unknown as { pageMatches: number[][] };
    find.pageMatches = [[3]];
    busHandlers.get("updatefindmatchescount")!({
      matchesCount: { total: 1 },
    } as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(useWorkspace.getState().error).toContain("Search context");
    vi.useRealTimers();
  });

  it("selects results through the synchronized cursor", async () => {
    const pdf = makePdf(2);
    await controller.attach(pdf as never);
    const find = controller.find as unknown as {
      selected: { pageIdx: number };
      pageMatches: number[][];
      _offset: { pageIdx: number | null; matchIdx: number | null; wrapped: boolean };
    };
    find.selected = { pageIdx: 0 };
    find.pageMatches = [[10, 30]];
    const goTo = vi.spyOn(controller, "goTo");
    controller.selectResult(1, 1);
    expect(goTo).toHaveBeenCalledWith(1);
    expect(find._offset).toMatchObject({ pageIdx: 0, matchIdx: 0 });
  });

  it("abandons stale generations in comments and results", async () => {
    const pdf = makePdf(2);
    await controller.attach(pdf as never);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    pdf.getPage = vi.fn(async () => {
      await gate;
      return {
        getTextContent: vi.fn(async () => ({ items: [] })),
        getAnnotations: vi.fn(async () => []),
      };
    });
    const pending = controller.readComments();
    await controller.detach();
    release();
    await pending;
    expect(useWorkspace.getState().comments).toEqual([]);
  });
});

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
  rememberView: vi.fn(async () => {}),
  commitWorkingRevision: vi.fn(async () => "rev-mock"),
}));

const batch = vi.hoisted(() => ({
  moveAnnotations: vi.fn(async () => ({ bytes: new Uint8Array([1]), moved: 2, skipped: 0 })),
  deleteAnnotations: vi.fn(async () => ({ bytes: new Uint8Array([2]), deleted: 2 })),
  copyAnnotations: vi.fn(async () => ({
    bytes: new Uint8Array([3]),
    count: 2,
    page: 1,
    text: "a",
  })),
  pasteAnnotations: vi.fn(async () => ({ bytes: new Uint8Array([4]), ids: ["p1", "p2"] })),
  reshapeAnnotation: vi.fn(async () => new Uint8Array([5])),
}));
vi.mock("../../src/services/pdf/comment-batch", () => batch);

const loadPdfFromBytes = vi.fn();
vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: (...args: unknown[]) => loadPdfFromBytes(...args),
}));

import { ViewerController } from "../../src/features/viewer/controller";
import { selectedCommentIds, useWorkspace } from "../../src/stores/workspace";
import { clearCommentClipboard } from "../../src/features/annotations/comment-clipboard";

function makePdf(rotate = 0) {
  return {
    numPages: 2,
    annotationStorage: {},
    saveDocument: vi.fn(async () => new Uint8Array([9])),
    getPage: vi.fn(async () => ({
      rotate,
      getViewport: () => ({ width: 600, height: 800 }),
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => []),
    })),
    getOutline: vi.fn(async () => null),
  };
}

const comments = [
  {
    id: "a",
    page: 1,
    type: "Square",
    text: "A",
    rect: [0, 0, 10, 10] as [number, number, number, number],
  },
  {
    id: "b",
    page: 1,
    type: "Ink",
    text: "B",
    rect: [0, 0, 10, 10] as [number, number, number, number],
  },
  {
    id: "c",
    page: 1,
    type: "Circle",
    text: "C",
    rect: [0, 0, 10, 10] as [number, number, number, number],
  },
  {
    id: "d",
    page: 2,
    type: "Text",
    text: "D",
    rect: [0, 0, 10, 10] as [number, number, number, number],
  },
];

let controller: ViewerController;

beforeEach(async () => {
  vi.clearAllMocks();
  clearCommentClipboard();
  useWorkspace.getState().reset();
  const container = document.createElement("div");
  const pages = document.createElement("div");
  container.append(pages);
  document.body.append(container);
  controller = new ViewerController(container, pages);
  loadPdfFromBytes.mockReturnValue({
    promise: Promise.resolve(makePdf()),
    destroy: vi.fn(async () => {}),
  });
  await controller.attach(makePdf() as never);
  useWorkspace.getState().set({ comments, document: { id: "doc", name: "a.pdf", size: 1 } });
});

describe("Selecting several comments", () => {
  it("adds and removes with toggle and selects a listed range", () => {
    controller.selectAnnotation("a");
    controller.selectAnnotation("c", "toggle");
    expect(selectedCommentIds(useWorkspace.getState())).toEqual(["a", "c"]);
    controller.selectAnnotation("a", "toggle");
    expect(selectedCommentIds(useWorkspace.getState())).toEqual(["c"]);
    controller.selectAnnotation("a", "range");
    expect(selectedCommentIds(useWorkspace.getState())).toEqual(["b", "c", "a"]);
    expect(useWorkspace.getState().selectedAnnotationId).toBe("a");
    controller.selectAnnotation("d");
    expect(selectedCommentIds(useWorkspace.getState())).toEqual(["d"]);
  });

  it("deletes and moves every selected comment as one change", async () => {
    controller.selectAnnotation("a");
    controller.selectAnnotation("b", "toggle");
    await controller.moveSelectedAnnotation(5, -5);
    expect(batch.moveAnnotations).toHaveBeenCalledWith(expect.any(Uint8Array), ["a", "b"], 5, -5);
    expect(selectedCommentIds(useWorkspace.getState())).toEqual(["a", "b"]);
    await controller.deleteSelectedAnnotation();
    expect(batch.deleteAnnotations).toHaveBeenCalledWith(expect.any(Uint8Array), ["a", "b"]);
    expect(useWorkspace.getState().selectedAnnotationId).toBeNull();
  });

  it("moves ink by every stored point even when selected alone", async () => {
    controller.selectAnnotation("b");
    await controller.moveSelectedAnnotation(1, 2);
    expect(batch.moveAnnotations).toHaveBeenCalledWith(expect.any(Uint8Array), ["b"], 1, 2);
  });

  it("nudges up on screen as up on a page turned a quarter", async () => {
    await controller.attach(makePdf(90) as never);
    useWorkspace.getState().set({ comments });
    controller.selectAnnotation("b");
    await controller.nudgeSelected(0, -10);
    expect(batch.moveAnnotations).toHaveBeenCalledWith(expect.any(Uint8Array), ["b"], -10, 0);
  });
});

describe("Copying and pasting comments", () => {
  it("copies the selection and pastes it, stepping each paste further along", async () => {
    controller.selectAnnotation("a");
    controller.selectAnnotation("c", "toggle");
    expect(controller.commentClipboardText()).toBe("A\n\nC\n\n(2 comments from NavPDF)");
    await controller.copySelectedComments();
    expect(batch.copyAnnotations).toHaveBeenCalledWith(expect.any(Uint8Array), ["a", "c"]);
    expect(useWorkspace.getState().commentClipboardCount).toBe(2);
    useWorkspace.getState().set({ page: 1 });
    await controller.pasteComments();
    await controller.pasteComments();
    expect(batch.pasteAnnotations.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      [1, 0],
      [1, 18],
    ]);
    expect(selectedCommentIds(useWorkspace.getState())).toEqual(["p1", "p2"]);
  });

  it("reshapes the selected comment", async () => {
    controller.selectAnnotation("a");
    await controller.reshapeSelectedAnnotation(1, [3, 4]);
    expect(batch.reshapeAnnotation).toHaveBeenCalledWith(expect.any(Uint8Array), "a", 1, [3, 4]);
  });
});

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
  commitWorkingRevision: vi.fn(async () => "rev-mock"),
}));

const mockAddStickyNote = vi.fn(async () => new Uint8Array([1, 2, 3]));
const mockAddShapeAnnotation = vi.fn(async () => new Uint8Array([4, 5, 6]));
const mockAddTextMarkupAnnotations = vi.fn(async () => new Uint8Array([7, 8, 9]));
const mockUpdateAnnotation = vi.fn(async () => new Uint8Array([10, 11, 12]));
const mockDeleteAnnotation = vi.fn(async () => new Uint8Array([13, 14, 15]));

vi.mock("../../src/services/document-commands", async (importOriginal) => {
  const original = (await importOriginal()) as object;
  return {
    ...original,
    addStickyNote: (...args: unknown[]) => mockAddStickyNote(...args),
    addShapeAnnotation: (...args: unknown[]) => mockAddShapeAnnotation(...args),
    addTextMarkupAnnotations: (...args: unknown[]) => mockAddTextMarkupAnnotations(...args),
    updateAnnotation: (...args: unknown[]) => mockUpdateAnnotation(...args),
    deleteAnnotation: (...args: unknown[]) => mockDeleteAnnotation(...args),
  };
});

const loadPdfFromBytes = vi.fn();

vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: (...args: unknown[]) => loadPdfFromBytes(...args),
}));

import { ViewerController } from "../../src/features/viewer/controller";
import { useWorkspace } from "../../src/stores/workspace";

function makePdf(numPages = 3) {
  return {
    numPages,
    annotationStorage: {} as Record<string, () => void>,
    saveDocument: vi.fn(async () => new Uint8Array([numPages])),
    getPage: vi.fn(async () => ({
      rotate: 0,
      getViewport: () => ({ width: 600, height: 800 }),
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
  const container = document.createElement("div");
  const pages = document.createElement("div");
  container.append(pages);
  document.body.append(container);
  controller = new ViewerController(container, pages);
});

describe("ViewerController annotation and comment workflow", () => {
  it("adds sticky notes, shapes, and text markup", async () => {
    const pdf = makePdf(2);
    const candidate = makePdf(2);
    loadPdfFromBytes.mockReturnValue({
      promise: Promise.resolve(candidate),
      destroy: vi.fn(async () => {}),
    });

    await controller.attach(pdf as never);
    useWorkspace.getState().set({ highlightColor: "#ffcc00", inkColor: "#00ccff", inkWidth: 3, inkOpacity: 0.7 });

    await controller.addStickyNote("Note content");
    expect(mockAddStickyNote).toHaveBeenCalled();
    expect(useWorkspace.getState().status).toBe("Sticky note added to document");

    await controller.addShape("Square", [10, 10], [50, 50]);
    expect(mockAddShapeAnnotation).toHaveBeenCalled();
    expect(useWorkspace.getState().status).toBe("Square added to document");

    await controller.addShape("Arrow", [10, 10], [100, 50]);
    expect(mockAddShapeAnnotation).toHaveBeenCalled();
    expect(useWorkspace.getState().status).toBe("Arrow added to document");
  });

  it("updates, moves, resizes, and deletes annotations", async () => {
    const annots = [
      {
        id: "shape-1",
        annotationName: "shape-1",
        subtype: "Square",
        rect: [20, 20, 100, 100],
      },
      {
        id: "line-1",
        annotationName: "line-1",
        subtype: "Line",
        rect: [10, 10, 50, 50],
        lineCoordinates: [10, 10, 50, 50],
      },
    ];
    const pdf = makePdf(2);
    pdf.getPage = vi.fn(async () => ({
      rotate: 0,
      getViewport: () => ({ width: 600, height: 800 }),
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => annots),
    }));
    const candidate = makePdf(2);
    candidate.getPage = vi.fn(async () => ({
      rotate: 0,
      getViewport: () => ({ width: 600, height: 800 }),
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => annots),
    }));
    loadPdfFromBytes.mockReturnValue({
      promise: Promise.resolve(candidate),
      destroy: vi.fn(async () => {}),
    });
    await controller.attach(pdf as never);

    useWorkspace.getState().set({
      selectedAnnotationId: "shape-1",
      comments: [
        {
          id: "shape-1",
          page: 1,
          type: "Square",
          text: "",
          rect: [20, 20, 100, 100],
        },
        {
          id: "line-1",
          page: 1,
          type: "Line",
          text: "",
          rect: [10, 10, 50, 50],
          line: [10, 10, 50, 50],
        },
      ],
    });

    await controller.updateSelectedAnnotation({ width: 4 });
    expect(mockUpdateAnnotation).toHaveBeenCalledWith(expect.any(Uint8Array), {
      id: "shape-1",
      width: 4,
    });

    await controller.moveSelectedAnnotation(10, -5);
    expect(mockUpdateAnnotation).toHaveBeenCalledWith(expect.any(Uint8Array), {
      id: "shape-1",
      rect: [30, 15, 110, 95],
    });

    await controller.resizeSelectedAnnotation(20, 10);
    expect(mockUpdateAnnotation).toHaveBeenCalledWith(expect.any(Uint8Array), {
      id: "shape-1",
      rect: [20, 20, 120, 110],
    });

    // Move line annotation
    useWorkspace.getState().set({ selectedAnnotationId: "line-1" });
    await controller.moveSelectedAnnotation(5, 5);
    expect(mockUpdateAnnotation).toHaveBeenCalledWith(expect.any(Uint8Array), {
      id: "line-1",
      rect: [15, 15, 55, 55],
      line: [15, 15, 55, 55],
    });

    // Resize line annotation
    await controller.resizeSelectedAnnotation(10, 10);
    expect(mockUpdateAnnotation).toHaveBeenCalledWith(expect.any(Uint8Array), {
      id: "line-1",
      rect: [10, 10, 60, 60],
      line: expect.any(Array),
    });

    await controller.deleteSelectedAnnotation();
    expect(mockDeleteAnnotation).toHaveBeenCalledWith(expect.any(Uint8Array), "line-1");
    expect(useWorkspace.getState().selectedAnnotationId).toBeNull();
  });

  it("selects annotations and switches to comments sidebar", async () => {
    const pdf = makePdf(3);
    await controller.attach(pdf as never);
    useWorkspace.getState().set({
      comments: [
        { id: "note-1", page: 2, type: "Text", text: "Target note" },
      ],
    });

    const goTo = vi.spyOn(controller, "goTo");
    controller.selectAnnotation("note-1");

    expect(useWorkspace.getState().selectedAnnotationId).toBe("note-1");
    expect(useWorkspace.getState().sidebar).toBe("comments");
    expect(useWorkspace.getState().page).toBe(2);
    expect(goTo).toHaveBeenCalledWith(2);
  });

  it("exports and imports comments with duplicate detection", async () => {
    const pdf = makePdf(2);
    const candidate = makePdf(2);
    loadPdfFromBytes.mockReturnValue({
      promise: Promise.resolve(candidate),
      destroy: vi.fn(async () => {}),
    });
    await controller.attach(pdf as never);

    useWorkspace.getState().set({
      document: { id: "doc-target", name: "target.pdf", size: 500 },
      comments: [
        { id: "existing-1", page: 1, type: "Text", text: "First note", rect: [10, 10, 40, 40] },
      ],
    });

    const exported = controller.exportComments();
    expect(exported).toContain('"schema": "navpdf-comments"');
    expect(exported).toContain('"documentId": "doc-target"');

    // Trying to re-import the exact same comments triggers duplicate detection
    await expect(controller.importComments(exported)).rejects.toThrow(
      "Every imported comment is already present.",
    );

    // Importing comments with mismatched documentId fails
    const otherDocExchange = JSON.stringify({
      schema: "navpdf-comments",
      version: 1,
      documentId: "doc-other",
      pageCount: 2,
      comments: [{ id: "new-1", page: 1, type: "Text", text: "Other note", rect: [20, 20, 50, 50] }],
    });
    await expect(controller.importComments(otherDocExchange)).rejects.toThrow(
      "These comments belong to a different document.",
    );

    // Importing valid new comments succeeds
    const newCommentsExchange = JSON.stringify({
      schema: "navpdf-comments",
      version: 1,
      documentId: "doc-target",
      pageCount: 2,
      comments: [
        { id: "existing-1", page: 1, type: "Text", text: "First note", rect: [10, 10, 40, 40] },
        { id: "new-note", page: 1, type: "Text", text: "Second note", rect: [50, 50, 80, 80] },
        { id: "new-hl", page: 1, type: "Highlight", text: "Marked", rect: [10, 20, 100, 30] },
        { id: "new-shape", page: 1, type: "Square", text: "", rect: [30, 30, 70, 70] },
      ],
    });

    const count = await controller.importComments(newCommentsExchange);
    expect(count).toBe(3);
    expect(useWorkspace.getState().status).toBe("3 comments imported");
  });

  it("prefers annotationName for stable identity in readComments", async () => {
    const pdf = makePdf(1);
    pdf.getPage = vi.fn(async () => ({
      rotate: 0,
      getViewport: () => ({ width: 600, height: 800 }),
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => [
        {
          id: "pdfjs_internal_id_123",
          annotationName: "navpdf-stable-uuid-456",
          subtype: "Square",
          rect: [10, 10, 50, 50],
          color: [255, 0, 0],
          opacity: 0.8,
          borderStyle: { width: 2 },
        },
      ]),
    }));
    await controller.attach(pdf as never);
    await controller.readComments();

    const comments = useWorkspace.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("navpdf-stable-uuid-456");
    expect(comments[0].type).toBe("Square");
    expect(comments[0].color).toEqual([1, 0, 0]);
    expect(comments[0].opacity).toBe(0.8);
    expect(comments[0].width).toBe(2);
  });
});

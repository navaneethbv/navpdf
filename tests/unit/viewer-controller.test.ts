// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  AnnotationEditorType: { NONE: 0, HIGHLIGHT: 1, FREETEXT: 2, INK: 3 },
  AnnotationMode: { ENABLE: 1, ENABLE_FORMS: 2 },
  AnnotationEditorParamsType: { HIGHLIGHT_COLOR: 7 },
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
    viewer: unknown = null;
    document: unknown = null;
    constructor(options: object) {
      Object.assign(this, options);
    }
    setViewer(viewer: unknown) {
      this.viewer = viewer;
    }
    setDocument(document: unknown) {
      this.document = document;
    }
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
    container: unknown;
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options);
      this.container = options.container;
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
  commitWorkingRevision: vi.fn(async () => ({ revisionId: "rev-mock", pageCount: 2, size: 1 })),
}));

const loadPdfFromBytes = vi.fn();

vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: (...args: unknown[]) => loadPdfFromBytes(...args),
}));

import { ViewerController } from "../../src/features/viewer/controller";
import { useWorkspace } from "../../src/stores/workspace";
import { markDirty, commitWorkingRevision } from "../../src/services/native";

function makePdf(numPages = 3, outline: unknown = null) {
  return {
    numPages,
    annotationStorage: {} as Record<string, () => void>,
    saveDocument: vi.fn(async () => new Uint8Array([numPages])),
    getPage: vi.fn(async () => ({
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => []),
    })),
    getOutline: vi.fn(async () => outline),
  };
}

let controller: ViewerController;

beforeEach(() => {
  vi.clearAllMocks();
  loadPdfFromBytes.mockReset();
  busHandlers.clear();
  useWorkspace.getState().reset();
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

describe("ViewerController lifecycle", () => {
  it("attaches a document and maps outlines with destination-less parents", async () => {
    const outline = [
      {
        title: "Part",
        dest: null,
        items: [{ title: "Ch1", dest: ["r1"], items: [] }],
      },
      { title: "Empty", dest: null, items: [] },
      { title: "Lonely", dest: null },
    ];
    const pdf = makePdf(3, outline);
    await controller.attach(pdf as never);
    expect(controller.pdf).toBe(pdf);
    const bookmarks = useWorkspace.getState().bookmarks;
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].title).toBe("Part");
    expect(bookmarks[0].children[0].title).toBe("Ch1");
  });

  it("reports text extraction failures without breaking attach", async () => {
    const pdf = makePdf();
    pdf.getPage = vi.fn(async () => {
      throw new Error("no text");
    });
    await controller.attach(pdf as never);
    expect(useWorkspace.getState().error).toContain("Text extraction failed");
  });

  it("replaces bytes through a staged revision and marks dirty", async () => {
    const first = makePdf(2);
    await controller.attach(first as never);
    const second = makePdf(4);
    loadPdfFromBytes.mockReturnValue({
      promise: Promise.resolve(second),
      destroy: vi.fn(async () => {}),
    });
    await controller.replaceWithBytes(new Uint8Array([1, 2, 3]), "Pages updated");
    expect(controller.pdf).toBe(second);
    expect(useWorkspace.getState()).toMatchObject({
      dirty: true,
      status: "Pages updated",
      info: null,
    });
    expect(markDirty).toHaveBeenCalledWith(true);
    expect(loadPdfFromBytes).toHaveBeenCalled();
  });

  it("undoes and redoes an adapter revision through the staged proxy boundary", async () => {
    useWorkspace
      .getState()
      .set({ document: { id: "test", name: "test.pdf", size: 1, revisionId: "base" } });
    const first = makePdf(2);
    first.saveDocument.mockResolvedValue(new Uint8Array([0]));
    await controller.attach(first as never);
    controller.seedRevision(new Uint8Array([0]), 2);
    const changed = makePdf(2);
    const undone = makePdf(2);
    const redone = makePdf(2);
    undone.getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () =>
        pageNumber === 1
          ? [{ id: "restored-note", subtype: "Text", contentsObj: { str: "restored" } }]
          : [],
      ),
    }));
    vi.mocked(loadPdfFromBytes)
      .mockImplementationOnce((bytes) => {
        const transferred = bytes as Uint8Array<ArrayBuffer>;
        structuredClone(transferred.buffer, { transfer: [transferred.buffer] });
        return {
          promise: Promise.resolve(changed),
          destroy: vi.fn(async () => {}),
        } as never;
      })
      .mockReturnValueOnce({
        promise: Promise.resolve(undone),
        destroy: vi.fn(async () => {}),
      } as never)
      .mockReturnValueOnce({
        promise: Promise.resolve(redone),
        destroy: vi.fn(async () => {}),
      } as never);

    await controller.replaceWithBytes(new Uint8Array([1]), "Adapter edit");
    expect(commitWorkingRevision).toHaveBeenCalledWith("test", "base", new Uint8Array([1]), 2);
    expect(useWorkspace.getState().canUndo).toBe(true);
    controller.undo();
    await vi.waitFor(() => expect(controller.pdf).toBe(undone));
    expect(useWorkspace.getState().dirty).toBe(false);
    await vi.waitFor(() =>
      expect(useWorkspace.getState().comments).toEqual([
        { id: "restored-note", page: 1, type: "Text", text: "restored" },
      ]),
    );
    controller.redo();
    await vi.waitFor(() => expect(controller.pdf).toBe(redone));
    await vi.waitFor(() => expect(commitWorkingRevision).toHaveBeenCalledTimes(3));
    expect(useWorkspace.getState().dirty).toBe(true);
    await vi.waitFor(() => expect(useWorkspace.getState().comments).toEqual([]));
  });

  it("restores the active document when native revision publication fails", async () => {
    const original = makePdf(2);
    await controller.attach(original as never);
    useWorkspace
      .getState()
      .set({ document: { id: "test", name: "test.pdf", size: 1, revisionId: "base" } });
    const candidate = makePdf(3);
    const destroy = vi.fn(async () => {});
    loadPdfFromBytes.mockReturnValue({ promise: Promise.resolve(candidate), destroy });
    vi.mocked(commitWorkingRevision).mockRejectedValueOnce(new Error("Native write failed"));
    await expect(controller.replaceWithBytes(new Uint8Array([3]), "Edit")).rejects.toThrow(
      "Native write failed",
    );
    expect(controller.pdf).toBe(original);
    expect(useWorkspace.getState().dirty).toBe(false);
    expect(destroy).toHaveBeenCalled();
  });

  it("refreshes the title and author from the replacement revision's metadata", async () => {
    useWorkspace.getState().set({
      info: {
        pages: 2,
        encrypted: false,
        title: "Sanitized title",
        author: "Sanitized author",
        version: "1.7",
      },
    });
    const sanitized = { ...makePdf(2), getMetadata: vi.fn(async () => ({ info: {} })) };
    loadPdfFromBytes.mockReturnValue({
      promise: Promise.resolve(sanitized),
      destroy: vi.fn(async () => {}),
    });
    await controller.replaceWithBytes(new Uint8Array([1]), "Redactions applied", {
      resetHistory: true,
    });
    expect(useWorkspace.getState().info).toMatchObject({
      pages: 2,
      title: "",
      author: "",
      version: "1.7",
    });

    const unreadable = {
      ...makePdf(3),
      getMetadata: vi.fn(async () => {
        throw new Error("no metadata");
      }),
    };
    useWorkspace.getState().set({
      info: { pages: 2, encrypted: false, title: "Kept", author: "Kept", version: "1.7" },
    });
    loadPdfFromBytes.mockReturnValue({
      promise: Promise.resolve(unreadable),
      destroy: vi.fn(async () => {}),
    });
    await controller.replaceWithBytes(new Uint8Array([2]), "Pages updated");
    expect(useWorkspace.getState().info).toMatchObject({ pages: 3, title: "Kept", author: "Kept" });
  });

  it("updates page counts and clamps the current page on replace", async () => {
    useWorkspace.getState().set({
      info: {
        pages: 9,
        encrypted: false,
        title: "",
        author: "",
        version: "1.7",
      },
      page: 9,
    });
    const second = makePdf(2);
    loadPdfFromBytes.mockReturnValue({
      promise: Promise.resolve(second),
      destroy: vi.fn(async () => {}),
    });
    await controller.replaceWithBytes(new Uint8Array([1]), "Deleted pages");
    expect(useWorkspace.getState().info?.pages).toBe(2);
    expect(useWorkspace.getState().page).toBe(2);
  });

  it("detaches and destroys cleanly", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    await controller.detach();
    expect(controller.pdf).toBeNull();
    expect(controller.editor).toBeNull();
  });
});

describe("ViewerController tools and navigation", () => {
  it("maps highlight, ink, text, and select tools to editor modes", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    controller.setTool("highlight");
    expect(useWorkspace.getState().tool).toBe("highlight");
    controller.setTool("draw");
    expect((controller.viewer.annotationEditorMode as { mode: number }).mode).toBe(3);
    controller.setTool("text");
    expect((controller.viewer.annotationEditorMode as { mode: number }).mode).toBe(2);
    controller.setTool("select");
    expect((controller.viewer.annotationEditorMode as { mode: number }).mode).toBe(0);
  });

  it("ignores tool changes without a document", () => {
    controller.setTool("highlight");
    expect(useWorkspace.getState().tool).toBe("select");
  });

  it("forwards color, undo, redo, and delete to the editor", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    const editor = {
      updateParams: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      delete: vi.fn(),
      commitOrRemove: vi.fn(),
    };
    busHandlers.get("annotationeditoruimanager")!({ uiManager: editor } as never);
    controller.setColor("#80d49b");
    expect(editor.updateParams).toHaveBeenCalledWith(7, "#80d49b");
    expect(useWorkspace.getState().highlightColor).toBe("#80d49b");
    controller.undo();
    controller.redo();
    controller.deleteSelected();
    expect(editor.undo).toHaveBeenCalled();
    expect(editor.redo).toHaveBeenCalled();
    expect(editor.delete).toHaveBeenCalled();
  });

  it("tracks editing state from the bus", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    busHandlers.get("editingstateschanged")!({
      details: {
        hasSomethingToUndo: true,
        hasSomethingToRedo: false,
        hasSelectedEditor: true,
      },
    } as never);
    expect(useWorkspace.getState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      hasSelection: true,
    });
  });

  it("zooms within bounds and clamps page navigation", async () => {
    const pdf = makePdf(5);
    await controller.attach(pdf as never);
    controller.zoom(99);
    expect(controller.viewer.currentScale).toBe(5);
    controller.zoom(0.01);
    expect(controller.viewer.currentScale).toBe(0.25);
    controller.zoom("page-fit");
    expect(controller.viewer.currentScaleValue).toBe("page-fit");
    controller.goTo(99);
    expect(controller.viewer.currentPageNumber).toBe(5);
    controller.goTo(-4);
    expect(controller.viewer.currentPageNumber).toBe(1);
  });

  it("applies single and spread layouts", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    controller.setLayout("single");
    expect(useWorkspace.getState().layout).toBe("single");
    controller.setLayout("spread");
    controller.setLayout("continuous");
    expect(useWorkspace.getState().layout).toBe("continuous");
  });

  it("drives find, result selection, and close", async () => {
    const pdf = makePdf(2);
    await controller.attach(pdf as never);
    useWorkspace.getState().set({ searchQuery: "river" });
    controller.search();
    expect(useWorkspace.getState().searchPending).toBe(true);
    controller.closeSearch();
    busHandlers.get("updatefindmatchescount")!({
      matchesCount: { total: 2 },
    } as never);
    expect(useWorkspace.getState().searchCount).toBe(2);
    busHandlers.get("updatefindcontrolstate")!({ state: 3 } as never);
    expect(useWorkspace.getState().searchPending).toBe(true);
  });

  it("reads text and highlight comments page by page", async () => {
    const pdf = makePdf(2);
    pdf.getPage = vi.fn(async (n: number) => ({
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () =>
        n === 1
          ? [
              { id: "a1", subtype: "Text", contentsObj: { str: "note" } },
              { id: "a2", subtype: "Highlight", contentsObj: { str: "" } },
              { id: "a4", subtype: "Underline", contentsObj: { str: "under" } },
              { id: "a5", subtype: "StrikeOut", contentsObj: { str: "strike" } },
              { id: "a3", subtype: "Link" },
            ]
          : [],
      ),
    }));
    await controller.attach(pdf as never);
    await controller.readComments();
    expect(useWorkspace.getState().comments).toHaveLength(4);
    expect(useWorkspace.getState().comments[1].text).toBe("Highlight annotation");
    expect(useWorkspace.getState().comments[2].type).toBe("Underline");
  });

  it("blocks external links in the capture phase", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.textContent = "external";
    (controller.container as HTMLDivElement).append(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

it("restores the current revision and dirty state after a late mutation failure", async () => {
  const previous = makePdf(3);
  await controller.attach(previous as never);
  useWorkspace.getState().set({ dirty: true, page: 2 });
  const candidate = makePdf(4);
  candidate.getOutline.mockRejectedValueOnce(new Error("Outline failed"));
  const destroy = vi.fn(async () => {});
  loadPdfFromBytes.mockReturnValue({ promise: Promise.resolve(candidate), destroy });
  await expect(controller.replaceWithBytes(new Uint8Array([1]), "Changed")).rejects.toThrow(
    "Outline failed",
  );
  expect(controller.pdf).toBe(previous);
  expect(useWorkspace.getState()).toMatchObject({ dirty: true, page: 2 });
  expect(destroy).toHaveBeenCalledOnce();
});

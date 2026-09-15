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
    setDocument() {}
  },
  PDFLinkService: class {
    setViewer() {}
    setDocument() {}
  },
  PDFViewer: class {
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options);
    }
    setDocument() {}
  },
  ScrollMode: { PAGE: 1, VERTICAL: 0 },
  SpreadMode: { ODD: 1, NONE: 0 },
}));

const markDirtyMock = vi.fn(async () => {});

vi.mock("../../src/services/native", () => ({
  native: true,
  markDirty: (...args: unknown[]) => markDirtyMock(...args),
  rememberPage: vi.fn(async () => {}),
  commitWorkingRevision: vi.fn(async () => ({ revisionId: "rev-mock", pageCount: 2, size: 1 })),
}));

vi.mock("../../src/services/pdf", () => ({
  loadPdfFromBytes: vi.fn(),
}));

import { ViewerController } from "../../src/features/viewer/controller";
import { useWorkspace } from "../../src/stores/workspace";

function makePdf() {
  return {
    numPages: 1,
    annotationStorage: {} as Record<string, () => void>,
    saveDocument: vi.fn(async () => new Uint8Array([1])),
    getPage: vi.fn(async () => ({
      getTextContent: vi.fn(async () => ({ items: [] })),
      getAnnotations: vi.fn(async () => []),
    })),
    getOutline: vi.fn(async () => null),
  };
}

describe("ViewerController dirty state survival (DS-02)", () => {
  let controller: ViewerController;

  beforeEach(() => {
    vi.clearAllMocks();
    markDirtyMock.mockClear();
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

  it("keeps dirty after a mode switch when annotation storage was modified", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    controller.seedRevision(new Uint8Array([1]), 1);
    expect(useWorkspace.getState().dirty).toBe(false);

    (pdf.annotationStorage as { onSetModified: () => void }).onSetModified();
    expect(useWorkspace.getState().dirty).toBe(true);

    const handler = busHandlers.get("editingstateschanged");
    expect(handler).toBeDefined();

    handler!({
      details: {
        hasSomethingToUndo: false,
        hasSomethingToRedo: false,
        hasSelectedEditor: false,
      },
    } as never);

    expect(useWorkspace.getState().dirty).toBe(true);
    expect(markDirtyMock).not.toHaveBeenCalledWith(false);
  });

  it("clears dirty only after markSaved", async () => {
    const pdf = makePdf();
    await controller.attach(pdf as never);
    controller.seedRevision(new Uint8Array([1]), 1);
    (pdf.annotationStorage as { onSetModified: () => void }).onSetModified();
    expect(useWorkspace.getState().dirty).toBe(true);

    controller.markSaved(new Uint8Array([1]), 1);
    expect(useWorkspace.getState().dirty).toBe(false);
  });
});

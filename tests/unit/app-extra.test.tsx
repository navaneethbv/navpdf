// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";

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
    async goToDestination() {}
  },
  PDFViewer: class {
    currentScale = 1;
    currentScaleValue: unknown = null;
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

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("../../src/services/native", () => ({
  native: true,
  localState: vi.fn(async () => ({
    preferences: {
      theme: "system",
      defaultZoom: "page-fit",
      layout: "continuous",
      rememberPage: true,
      autosave: true,
      recentFiles: true,
      networkAccess: false,
    },
    recents: [],
    recovery: null,
  })),
  openDocument: vi.fn(async () => null),
  openRecent: vi.fn(async () => null),
  openRecovery: vi.fn(async () => null),
  releaseDocument: vi.fn(async () => {}),
  markDirty: vi.fn(async () => {}),
  discardRecovery: vi.fn(async () => {}),
  rememberPage: vi.fn(async () => {}),
  writeRecovery: vi.fn(async () => {}),
  saveDocument: vi.fn(async () => ({ name: "test.pdf", size: 100 })),
  savePreferences: vi.fn(async () => {}),
  clearRecents: vi.fn(async () => {}),
}));

vi.mock("../../src/services/pdf", () => ({
  loadPdf: vi.fn(),
}));

import App from "../../src/app/App";
import { useWorkspace } from "../../src/stores/workspace";

Object.defineProperty(window, "matchMedia", {
  value: vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
  writable: true,
});

function seedDocument() {
  act(() => {
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 100 },
      info: {
        pages: 4,
        encrypted: false,
        title: "Doc",
        author: "Nav",
        version: "1.7",
      },
      page: 1,
      sidebar: "bookmarks",
    });
  });
}

function menuHandler() {
  const calls = vi.mocked(listen).mock.calls;
  const entry = calls.find(([event]) => event === "menu-action");
  return entry?.[1] as (payload: { payload: string }) => void;
}

beforeEach(() => {
  useWorkspace.getState().reset();
  act(() => {
    useWorkspace.getState().set({
      busy: false,
      status: "Ready",
      error: "",
      sidebar: "pages",
    });
  });
  vi.clearAllMocks();
});

describe("App keyboard and menus", () => {
  it("handles file shortcuts and navigation keys", () => {
    seedDocument();
    render(<App />);
    const key = (keyName: string, extra: object = {}) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: keyName,
          bubbles: true,
          cancelable: true,
          ...extra,
        }),
      );
    key("o", { ctrlKey: true });
    key("s", { ctrlKey: true });
    key("s", { ctrlKey: true, shiftKey: true });
    key("f", { ctrlKey: true });
    key("0", { ctrlKey: true });
    key("+", { ctrlKey: true });
    key("-", { ctrlKey: true });
    key("Escape");
    expect(useWorkspace.getState().sidebar).toBe("search");
  });

  it("warns about unsaved changes before unload", () => {
    seedDocument();
    render(<App />);
    act(() => {
      useWorkspace.getState().set({ dirty: true });
    });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("routes the remaining menu actions", async () => {
    seedDocument();
    render(<App />);
    const menu = menuHandler();
    await act(async () => {
      menu({ payload: "open" });
      menu({ payload: "save" });
      menu({ payload: "save-as" });
      menu({ payload: "redo" });
      menu({ payload: "fit-width" });
      menu({ payload: "zoom-out" });
    });
  });

  it("closes every modal through its close button", () => {
    seedDocument();
    render(<App />);
    for (const modal of [
      "page-workspace",
      "print",
      "create-pdf",
      "fill-sign",
      "ocr",
      "convert",
      "redact",
      "compress",
      "protect",
      "design",
      "assistant",
    ]) {
      act(() => {
        useWorkspace.getState().set({ activeModal: modal });
      });
      const closes = screen.getAllByRole("button", { name: /close/i });
      fireEvent.click(closes[closes.length - 1]);
      expect(useWorkspace.getState().activeModal).toBeNull();
    }
  });

  it("saves through the toolbar callback", () => {
    seedDocument();
    render(<App />);
    fireEvent.click(screen.getByLabelText("Save PDF"));
  });
});

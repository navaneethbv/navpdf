// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { defaultPreferences } from "../../src/types/document";

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

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), isTauri: () => true }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("../../src/services/native", () => ({
  native: true,
  localState: vi.fn(async () => ({
    preferences: { ...defaultPreferences, tourCompleted: true, showStartupTips: false },
    recents: [],
    recoveries: [],
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
  ocrRecognizePage: vi.fn(async () => ({
    pageIndex: 0,
    language: "en-US",
    lines: [],
    fullText: "",
    meanConfidence: 1.0,
  })),
  ocrGetEngineInfo: vi.fn(async () => ({
    engine: "apple_vision",
    name: "Apple Vision Framework",
    supportedLanguages: ["en-US"],
    isAvailable: true,
    offlineOnly: true,
  })),
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
      settingsOpen: false,
      status: "Ready",
      error: "",
      sidebar: "pages",
    });
  });
  vi.clearAllMocks();
});

describe("App keyboard and menus", () => {
  it("applies the system theme preference", () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps the Settings preview in control when system appearance changes", async () => {
    const media = Object.assign(new EventTarget(), { matches: true });
    vi.stubGlobal("matchMedia", () => media);
    render(<App />);
    await act(async () => {});
    act(() => useWorkspace.getState().set({ settingsOpen: true }));
    fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "light" } });
    act(() => media.dispatchEvent(new Event("change")));
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(screen.getByText("Cancel"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

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

  it("handles page navigation, annotation nudging, deletion, and busy input", () => {
    seedDocument();
    render(<App />);
    const key = (keyName: string, extra: object = {}) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...extra }),
      );
    key("Home");
    key("End");
    act(() => useWorkspace.getState().set({ selectedAnnotationId: "annotation-1" }));
    key("ArrowLeft", { shiftKey: true });
    key("ArrowUp");
    key("Delete");
    expect(useWorkspace.getState().selectedAnnotationId).toBe("annotation-1");
    key("Escape");
    expect(useWorkspace.getState().selectedAnnotationId).toBeNull();
    act(() => useWorkspace.getState().set({ busy: true }));
    key("Home");
    expect(useWorkspace.getState().busy).toBe(true);
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

  it("routes organize, tool, view, annotation, and settings menu actions", () => {
    seedDocument();
    render(<App />);
    const menu = menuHandler();
    for (const action of [
      "organize",
      "tools:add-text",
      "tools:add-image",
      "tools:annotations",
      "tools:redact",
    ]) {
      act(() => {
        useWorkspace.getState().set({ activeModal: null });
        menu({ payload: action });
      });
      expect(useWorkspace.getState().activeModal).toBe(
        action === "organize"
          ? "page-workspace"
          : action === "tools:add-text"
            ? "add-text"
            : action === "tools:add-image"
              ? "add-image"
              : action === "tools:annotations"
                ? "annotations"
                : "redact",
      );
    }
    act(() => {
      useWorkspace.getState().set({ activeModal: null });
      menu({ payload: "find" });
      menu({ payload: "fit-page" });
      menu({ payload: "fit-width" });
      menu({ payload: "highlight" });
      menu({ payload: "select" });
      menu({ payload: "settings" });
    });
    expect(useWorkspace.getState().sidebar).toBe("search");
    expect(useWorkspace.getState().settingsOpen).toBe(true);
  });

  it("routes file conversion and view menus while keeping an open dialog intact", () => {
    seedDocument();
    render(<App />);
    const menu = menuHandler();
    for (const action of [
      "create-pdf",
      "import-pdf",
      "combine-pdf",
      "open-recent",
      "office-export",
      "office-pptx",
      "office-xlsx",
      "office-rtf",
      "convert",
      "compress",
      "protect",
      "properties",
      "ocr",
      "forms",
      "fill-sign",
      "edit-objects",
    ]) {
      act(() => {
        useWorkspace.getState().set({ activeModal: null, settingsOpen: false });
        menu({ payload: action });
      });
      expect(useWorkspace.getState().activeModal).toBe(action);
      act(() => menu({ payload: "import-pdf" }));
      expect(useWorkspace.getState().activeModal).toBe(action);
    }
    act(() => useWorkspace.getState().set({ activeModal: null }));
    for (const action of [
      "layout-single",
      "layout-spread",
      "layout-continuous",
      "first-page",
      "last-page",
      "next-page",
      "previous-page",
      "rotate-view",
      "actual-size",
    ]) {
      act(() => menu({ payload: action }));
    }
    for (const [action, sidebar] of [
      ["panel-pages", "pages"],
      ["panel-bookmarks", "bookmarks"],
      ["panel-comments", "comments"],
    ]) {
      act(() => menu({ payload: action }));
      expect(useWorkspace.getState()).toMatchObject({
        sidebar,
        navigationVisible: true,
        propertiesVisible: false,
      });
    }
    act(() => {
      menu({ payload: "read-mode" });
      menu({ payload: "night-mode" });
      menu({ payload: "all-tools" });
      menu({ payload: "quick-tools" });
    });
    expect(useWorkspace.getState()).toMatchObject({
      readMode: true,
      nightMode: true,
      toolMode: "all",
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
      "export-options",
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

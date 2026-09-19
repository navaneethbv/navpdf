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

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("../../src/services/native", () => ({
  native: true,
  localState: vi.fn(async () => ({
    preferences: { ...defaultPreferences },
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
    matches: false,
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
  localStorage.clear();
  vi.clearAllMocks();
});

describe("App shell", () => {
  it("renders the home workspace with toolbar and status", () => {
    render(<App />);
    expect(screen.getByText("Open PDF")).toBeTruthy();
    expect(screen.getByText("NavPDF", { selector: "button.brand" })).toBeTruthy();
    expect(screen.getByText("Network access off")).toBeTruthy();
  });

  it("shows and dismisses the error banner", () => {
    render(<App />);
    act(() => {
      useWorkspace.getState().set({ error: "Something broke" });
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(useWorkspace.getState().error).toBe("");
  });

  it("shows the busy indicator while work runs", () => {
    render(<App />);
    act(() => {
      useWorkspace.getState().set({ busy: true, status: "Opening PDF..." });
    });
    expect(document.querySelector(".busy-indicator")).toBeTruthy();
    expect(screen.getAllByText("Opening PDF...").length).toBeGreaterThan(0);
  });

  it("opens the tool panel and every modal surface", () => {
    render(<App />);
    const modals: [string, string][] = [
      ["toolMode:all", "All Tools"],
      ["page-workspace", "Organize Pages"],
      ["print", "Print Document"],
      ["create-pdf", "Create PDF"],
      ["add-text", "Add Text to Page"],
      ["add-image", "Insert Image"],
      ["decorations", "Document Decorations"],
      ["attachments", "File Attachments"],
      ["forms", "Prepare Form Fields"],
      ["fill-sign", "Fill & Sign"],
      ["ocr", "Optical Character Recognition (OCR)"],
      ["convert", "Export Document"],
      ["office-export", "Export to Office Formats"],
      ["redact", "Redact Sensitive Content"],
      ["compress", "Compress PDF"],
      ["protect", "Password Protect PDF"],
      ["design", "Generate Cover Page"],
      ["assistant", "Find and Cite Passages"],
    ];
    for (const [modal, heading] of modals) {
      act(() => {
        if (modal.startsWith("toolMode:")) {
          useWorkspace.getState().set({ toolMode: "all" });
        } else {
          useWorkspace.getState().set({ toolMode: null, activeModal: modal });
        }
      });
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
      act(() => {
        useWorkspace.getState().set({ toolMode: null, activeModal: null });
      });
    }
  });

  it("shows the annotation toolbar, snapshot overlay, and settings", () => {
    render(<App />);
    seedDocument();
    act(() => {
      useWorkspace.getState().set({ tool: "highlight" });
    });
    expect(screen.getByLabelText("Annotation tools")).toBeTruthy();
    act(() => {
      useWorkspace.getState().set({ tool: "select", activeSnapshot: true });
    });
    expect(screen.getByText("Click and drag across the document to capture a region")).toBeTruthy();
    act(() => {
      useWorkspace.getState().set({ activeSnapshot: false, settingsOpen: true });
    });
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders sidebar and properties with a document", () => {
    seedDocument();
    render(<App />);
    expect(screen.getByText("This PDF has no bookmarks.")).toBeTruthy();
    expect(screen.getByText("Doc")).toBeTruthy();
  });

  it("routes native menu actions to session and controller", async () => {
    seedDocument();
    render(<App />);
    const calls = vi.mocked(listen).mock.calls;
    const menu = calls.find(([event]) => event === "menu-action")?.[1] as (payload: {
      payload: string;
    }) => void;
    expect(menu).toBeTruthy();
    await act(async () => {
      menu({ payload: "find" });
      menu({ payload: "settings" });
      menu({ payload: "home" });
      menu({ payload: "highlight" });
      menu({ payload: "select" });
      menu({ payload: "fit-page" });
      menu({ payload: "zoom-in" });
      menu({ payload: "undo" });
    });
    expect(useWorkspace.getState().sidebar).toBe("search");
    expect(useWorkspace.getState().settingsOpen).toBe(true);
  });

  it("handles keyboard shortcuts and file picker changes", () => {
    render(<App />);
    act(() => {
      useWorkspace.getState().set({ tool: "highlight" });
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "picked.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(input.value).toBe("");
  });
});

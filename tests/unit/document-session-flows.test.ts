// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocumentSession } from "../../src/app/useDocumentSession";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";
import type { ViewerController } from "../../src/features/viewer/controller";

vi.mock("../../src/services/pdf", () => ({ loadPdf: vi.fn() }));
vi.mock("../../src/services/native", () => ({
  native: false,
  localState: vi.fn(async () => ({
    preferences: defaultPreferences,
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

import { loadPdf } from "../../src/services/pdf";
import * as desktop from "../../src/services/native";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let session: ReturnType<typeof useDocumentSession>;
let controller: ViewerController;
const doc = { id: "doc", name: "doc.pdf", size: 100 };

function harness(c: ViewerController | null) {
  function Harness() {
    session = useDocumentSession(c);
    return null;
  }
  return Harness;
}

beforeEach(async () => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
  controller = {
    detach: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    releaseRevision: vi.fn(async () => {}),
    replaceWithBytes: vi.fn(async () => {}),
    goTo: vi.fn(),
    viewer: { firstPagePromise: Promise.resolve() },
  } as unknown as ViewerController;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(harness(controller))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("does nothing without a controller", async () => {
  await act(async () => root.render(createElement(harness(null))));
  await act(async () => {
    expect(await session.load(doc)).toBe(false);
  });
});

it("blocks saving encrypted documents and keeps the original", async () => {
  useWorkspace.getState().set({
    document: doc,
    info: {
      pages: 5,
      encrypted: true,
      title: "",
      author: "",
      version: "1.7",
    },
  });
  (controller as unknown as { pdf: unknown }).pdf = {
    saveDocument: vi.fn(),
    numPages: 5,
  };
  await act(async () => {
    expect(await session.save()).toBe(false);
  });
  expect(desktop.saveDocument).not.toHaveBeenCalled();
  expect(useWorkspace.getState().error).toContain("password-protected");
});

it("reports cancellation when the native save dialog is dismissed", async () => {
  useWorkspace.getState().set({
    document: doc,
    info: {
      pages: 2,
      encrypted: false,
      title: "",
      author: "",
      version: "1.7",
    },
  });
  (controller as unknown as { pdf: unknown }).pdf = {
    saveDocument: vi.fn(async () => new Uint8Array([1])),
    numPages: 2,
    editor: undefined,
  };
  vi.mocked(desktop.saveDocument).mockResolvedValueOnce(null);
  await act(async () => {
    expect(await session.save()).toBe(false);
  });
  expect(useWorkspace.getState().status).toBe("Save cancelled");
});

it("goes home by detaching, destroying, and releasing the document", async () => {
  const destroy = vi.fn(async () => {});
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({
      numPages: 3,
      getMetadata: async () => ({ info: {} }),
    }),
    destroy,
  } as never);
  await act(async () => {
    expect(await session.load(doc)).toBe(true);
  });
  await act(async () => {
    session.home();
  });
  await act(async () => {});
  expect(controller.detach).toHaveBeenCalled();
  expect(destroy).toHaveBeenCalled();
  expect(desktop.releaseDocument).toHaveBeenCalledWith(doc.id);
  expect(useWorkspace.getState().document).toBeNull();
});

it("recovers an autosaved copy as dirty and prompts Save As", async () => {
  useWorkspace.getState().reset();
  await act(async () => root.render(createElement(harness(controller))));
  vi.mocked(desktop.openRecovery).mockResolvedValueOnce({
    id: "recovery",
    name: "recovery.pdf",
    size: 50,
  });
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({
      numPages: 1,
      getMetadata: async () => ({ info: {} }),
    }),
    destroy: vi.fn(async () => {}),
  } as never);
  await act(async () => {
    session.recover();
  });
  await act(async () => {});
  expect(useWorkspace.getState().dirty).toBe(true);
  expect(useWorkspace.getState().status).toContain("Recovery opened");
});

it("asks for confirmation before replacing a dirty document", async () => {
  useWorkspace.getState().set({ document: doc, dirty: true });
  act(() => {
    session.home();
  });
  expect(session.confirm).not.toBeNull();
  act(() => {
    session.cancelConfirm();
  });
  expect(session.confirm).toBeNull();
  expect(useWorkspace.getState().document).toEqual(doc);
});

it("saves through save-and-continue before running the deferred action", async () => {
  useWorkspace.getState().set({
    document: doc,
    dirty: true,
    info: {
      pages: 2,
      encrypted: false,
      title: "",
      author: "",
      version: "1.7",
    },
  });
  (controller as unknown as { pdf: unknown }).pdf = {
    saveDocument: vi.fn(async () => new Uint8Array([1])),
    numPages: 2,
  };
  vi.mocked(desktop.saveDocument).mockResolvedValueOnce({
    name: "doc.pdf",
    size: 10,
  });
  act(() => {
    session.home();
  });
  expect(session.confirm).not.toBeNull();
  await act(async () => {
    await session.saveAndContinue();
  });
  expect(session.confirm).toBeNull();
  expect(useWorkspace.getState().document).toBeNull();
});

it("opens a picked file through the dirty guard", async () => {
  const next = { id: "next", name: "next.pdf", size: 10 };
  useWorkspace.getState().set({ document: doc, dirty: false });
  vi.mocked(desktop.openDocument).mockResolvedValueOnce(next);
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({
      numPages: 1,
      getMetadata: async () => ({ info: {} }),
    }),
    destroy: vi.fn(async () => {}),
  } as never);
  await act(async () => {
    session.open(new File(["x"], "next.pdf"));
  });
  await act(async () => {});
  expect(desktop.openDocument).toHaveBeenCalled();
});

it("opens recents with the remembered page when enabled", async () => {
  useWorkspace.getState().set({ document: doc, dirty: false });
  vi.mocked(desktop.openRecent).mockResolvedValueOnce({
    id: "r1",
    name: "r1.pdf",
    size: 10,
  });
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({
      numPages: 4,
      getMetadata: async () => ({ info: {} }),
    }),
    destroy: vi.fn(async () => {}),
  } as never);
  await act(async () => {
    session.recent("r1", 3);
  });
  await vi.waitFor(() => {
    expect(desktop.openRecent).toHaveBeenCalledWith("r1");
  });
  expect(controller.goTo).toHaveBeenCalledWith(3);
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocumentSession } from "../../src/app/useDocumentSession";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";
import type { ViewerController } from "../../src/features/viewer/controller";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
  isTauri: () => true,
}));

vi.mock("../../src/services/pdf", () => ({ loadPdf: vi.fn() }));
vi.mock("../../src/services/native", () => ({
  native: true,
  localState: vi.fn(async () => ({
    preferences: defaultPreferences,
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
}));

import { loadPdf } from "../../src/services/pdf";
import * as desktop from "../../src/services/native";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let session: ReturnType<typeof useDocumentSession>;
let controller: ViewerController;
const doc = { id: "doc", name: "doc.pdf", size: 100 };

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useWorkspace.getState().reset();
  useWorkspace.getState().set({ busy: false, status: "Ready", error: "" });
  controller = {
    detach: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    releaseRevision: vi.fn(async () => {}),
    goTo: vi.fn(),
    viewer: { firstPagePromise: Promise.resolve() },
  } as unknown as ViewerController;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    session = useDocumentSession(controller);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

function loadedDocument(numPages = 2) {
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({
      numPages,
      getMetadata: async () => ({ info: {} }),
    }),
    destroy: vi.fn(async () => {}),
  } as never);
}

it("keeps ownership when reloading the same document id", async () => {
  loadedDocument();
  useWorkspace.getState().set({ document: doc });
  await act(async () => {
    expect(await session.load(doc)).toBe(true);
  });
  expect(desktop.releaseDocument).not.toHaveBeenCalledWith(doc.id);
  expect(controller.releaseRevision).toHaveBeenCalled();
});

it("keeps edits in the workspace when saving fails", async () => {
  loadedDocument();
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
  vi.mocked(desktop.saveDocument).mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    expect(await session.save()).toBe(false);
  });
  expect(useWorkspace.getState()).toMatchObject({
    dirty: true,
    status: "Save failed; changes are still in this workspace",
  });
});

it("restores the dirty guard when a pending editor save fails", async () => {
  loadedDocument();
  useWorkspace.getState().set({
    document: doc,
    dirty: false,
    info: {
      pages: 2,
      encrypted: false,
      title: "",
      author: "",
      version: "1.7",
    },
  });
  // Committing the pending editor marks the document dirty, as PDF.js storage does.
  const commitOrRemove = vi.fn(() => useWorkspace.getState().set({ dirty: true }));
  (controller as unknown as { editor: unknown }).editor = { commitOrRemove };
  (controller as unknown as { pdf: unknown }).pdf = {
    saveDocument: vi.fn(async () => new Uint8Array([1])),
    numPages: 2,
  };
  vi.mocked(desktop.saveDocument).mockRejectedValueOnce(new Error("disk full"));

  await act(async () => {
    expect(await session.save()).toBe(false);
  });

  expect(commitOrRemove).toHaveBeenCalled();
  expect(useWorkspace.getState()).toMatchObject({
    dirty: true,
    status: "Save failed; changes are still in this workspace",
  });
  expect(desktop.markDirty).toHaveBeenCalledWith(true);
});

it("writes recovery copies on the autosave interval", async () => {
  loadedDocument();
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
    saveDocument: vi.fn(async () => new Uint8Array([1, 2, 3])),
    numPages: 2,
  };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11000);
  });
  expect(desktop.writeRecovery).toHaveBeenCalled();
});

it("autosaves without marking the workspace busy and restores the previous status", async () => {
  useWorkspace.getState().set({ document: doc, dirty: true, status: "Highlight added" });
  let finish: (bytes: Uint8Array) => void = () => {};
  (controller as unknown as { pdf: unknown }).pdf = {
    saveDocument: vi.fn(() => new Promise<Uint8Array>((resolve) => (finish = resolve))),
    numPages: 2,
  };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(useWorkspace.getState()).toMatchObject({
    busy: false,
    status: "Saving recovery copy...",
  });
  await act(async () => {
    finish(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(desktop.writeRecovery).toHaveBeenCalled();
  expect(useWorkspace.getState()).toMatchObject({ busy: false, status: "Highlight added" });
});

it("skips an autosave tick while another operation is busy", async () => {
  useWorkspace.getState().set({ document: doc, dirty: true, busy: true });
  const saveDocument = vi.fn(async () => new Uint8Array([1]));
  (controller as unknown as { pdf: unknown }).pdf = { saveDocument, numPages: 2 };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11000);
  });
  expect(saveDocument).not.toHaveBeenCalled();
  expect(useWorkspace.getState().busy).toBe(true);
});

it("discards recovery and closes on a native close request", async () => {
  useWorkspace.getState().set({ document: doc });
  const calls = vi.mocked(listen).mock.calls;
  const close = calls.find(([event]) => event === "close-requested")?.[1] as () => void;
  expect(close).toBeTruthy();
  await act(async () => {
    close();
  });
  expect(desktop.discardRecovery).toHaveBeenCalledWith(doc.id);
  expect(invoke).toHaveBeenCalledWith("close_window");
});

it("ignores close requests while busy", async () => {
  useWorkspace.getState().set({ busy: true });
  const calls = vi.mocked(listen).mock.calls;
  const close = calls.find(([event]) => event === "close-requested")?.[1] as () => void;
  await act(async () => {
    close();
  });
  expect(desktop.discardRecovery).not.toHaveBeenCalled();
});

it("cancels an in-flight open from the dirty guard", async () => {
  useWorkspace.getState().set({ document: doc, dirty: true });
  act(() => {
    session.open();
  });
  expect(session.confirm).not.toBeNull();
  act(() => {
    session.cancelConfirm();
  });
  expect(loadPdf).not.toHaveBeenCalled();
});

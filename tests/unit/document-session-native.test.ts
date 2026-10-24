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
  invoke: vi.fn(async () => []),
  isTauri: () => true,
}));

vi.mock("../../src/services/pdf", () => ({ loadPdf: vi.fn() }));
vi.mock("../../src/services/native", () => ({
  native: true,
  setBackgroundDirty: vi.fn(),
  sourceStatus: vi.fn(async () => ({ changed: false, missing: false })),
  localState: vi.fn(async () => ({
    preferences: defaultPreferences,
    recents: [],
    recoveries: [],
  })),
  openDocument: vi.fn(async () => null),
  openDocumentFromToken: vi.fn(),
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
    park: vi.fn(async () => ({
      pdf: { numPages: 2, saveDocument: vi.fn(async () => new Uint8Array([9])) },
    })),
    resume: vi.fn(async () => {}),
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

function pendingAutosave() {
  const writes: Array<() => void> = [];
  vi.mocked(desktop.writeRecovery).mockImplementationOnce(
    () => new Promise<void>((resolve) => writes.push(resolve)),
  );
  const pdf = { saveDocument: vi.fn(async () => new Uint8Array([1])), numPages: 2 };
  (controller as unknown as { pdf: unknown }).pdf = pdf;
  return { pdf, finish: () => writes.shift()?.() };
}

it("saves after an in-flight autosave instead of dropping the request", async () => {
  useWorkspace.getState().set({ document: doc, dirty: true });
  const { finish } = pendingAutosave();
  (controller as unknown as { editor: null; markSaved: () => void }).editor = null;
  (controller as unknown as { markSaved: () => void }).markSaved = vi.fn();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(desktop.writeRecovery).toHaveBeenCalledOnce();
  let saved: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    saved = session.save();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(desktop.saveDocument).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await vi.advanceTimersByTimeAsync(0);
  });
  await expect(saved).resolves.toBe(true);
  expect(desktop.saveDocument).toHaveBeenCalledOnce();
  expect(useWorkspace.getState().dirty).toBe(false);
});

it("closes after an in-flight autosave and discards the recovery copy last", async () => {
  useWorkspace.getState().set({ document: doc, dirty: false });
  const { finish } = pendingAutosave();
  useWorkspace.getState().set({ dirty: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  // The user discarded the changes elsewhere; the window close must still complete.
  useWorkspace.getState().set({ dirty: false });
  const calls = vi.mocked(listen).mock.calls;
  const close = calls.find(([event]) => event === "close-requested")?.[1] as () => void;
  await act(async () => {
    close();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(invoke).not.toHaveBeenCalledWith("close_window");
  await act(async () => {
    finish();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(desktop.discardRecovery).toHaveBeenCalledWith(doc.id);
  expect(invoke).toHaveBeenCalledWith("close_window");
  const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
  expect(order(desktop.writeRecovery)).toBeLessThan(order(desktop.discardRecovery));
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

it("opens another PDF in a new tab without asking to discard edits", async () => {
  loadedDocument();
  const next = { id: "next", name: "next.pdf", size: 10 };
  vi.mocked(desktop.openDocument).mockResolvedValueOnce(next);
  useWorkspace.getState().set({ document: doc, dirty: true });
  await act(async () => {
    session.open();
  });
  await vi.waitFor(() => expect(useWorkspace.getState().document).toEqual(next));
  expect(session.confirm).toBeNull();
  expect(controller.park).toHaveBeenCalledOnce();
  expect(useWorkspace.getState().tabs).toEqual([
    { id: "doc", name: "doc.pdf", dirty: true },
    { id: "next", name: "next.pdf", dirty: false },
  ]);
  // The dirty document keeps its handle and a recovery copy, and quitting still asks.
  expect(desktop.releaseDocument).not.toHaveBeenCalledWith("doc");
  expect(desktop.writeRecovery).toHaveBeenCalledWith(doc, new Uint8Array([9]), 2);
  expect(desktop.setBackgroundDirty).toHaveBeenLastCalledWith(true);
});

it("opens a queued native request in a new tab and dismisses its token", async () => {
  loadedDocument();
  const request = { token: "queued", error: null };
  let queued = true;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "pending_open_requests") return queued ? [request] : [];
    if (command === "dismiss_open_request") queued = false;
  });
  const next = { id: "next", name: "next.pdf", size: 10 };
  vi.mocked(desktop.openDocumentFromToken).mockResolvedValueOnce(next);
  useWorkspace
    .getState()
    .set({ document: doc, dirty: true, activeModal: null, settingsOpen: false });
  const onOpen = vi.mocked(listen).mock.calls.find(([event]) => event === "open-token")?.[1];
  await act(async () => onOpen?.({ payload: {} } as never));
  await vi.waitFor(() => expect(queued).toBe(false));
  expect(session.confirm).toBeNull();
  expect(useWorkspace.getState().document).toEqual(next);
  expect(useWorkspace.getState().tabs.map((tab) => [tab.id, tab.dirty])).toEqual([
    ["doc", true],
    ["next", false],
  ]);
});

it("shows the dirty document again when a new tab's document cannot be opened", async () => {
  vi.mocked(loadPdf).mockRejectedValueOnce(new Error("Invalid PDF structure"));
  const next = { id: "next", name: "next.pdf", size: 10 };
  vi.mocked(desktop.openDocument).mockResolvedValueOnce(next);
  useWorkspace.getState().set({ document: doc, dirty: true });
  await act(async () => {
    session.open();
  });
  await vi.waitFor(() => expect(controller.resume).toHaveBeenCalledOnce());
  expect(useWorkspace.getState()).toMatchObject({ document: doc, dirty: true });
  expect(desktop.releaseDocument).toHaveBeenCalledWith("next");
  expect(desktop.releaseDocument).not.toHaveBeenCalledWith("doc");
  expect(desktop.setBackgroundDirty).toHaveBeenLastCalledWith(false);
});

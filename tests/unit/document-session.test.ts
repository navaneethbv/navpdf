// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocumentSession } from "../../src/app/useDocumentSession";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";
import { loadPdf } from "../../src/services/pdf";
import * as desktop from "../../src/services/native";
import type { ViewerController } from "../../src/features/viewer/controller";

vi.mock("../../src/services/pdf", () => ({ loadPdf: vi.fn() }));
vi.mock("../../src/services/native", () => ({
  native: false,
  openRecovery: vi.fn(async () => null),
  localState: vi.fn(async () => ({
    preferences: defaultPreferences,
    recents: [],
    recoveries: [],
  })),
  openDocument: vi.fn(async () => null),
  releaseDocument: vi.fn(async () => {}),
  markDirty: vi.fn(async () => {}),
  discardRecovery: vi.fn(async () => {}),
  saveDocument: vi.fn(async () => ({ name: "test.pdf", size: 100 })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let session: ReturnType<typeof useDocumentSession>;
const previous = { id: "previous", name: "previous.pdf", size: 100 };
const next = { id: "candidate", name: "candidate.pdf", size: 100 };
let controller: ViewerController;

beforeEach(async () => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
  useWorkspace.getState().set({ document: previous, busy: false });
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
  function Harness() {
    session = useDocumentSession(controller);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("preserves the open document and ends loading when a new PDF is damaged", async () => {
  vi.mocked(loadPdf).mockImplementation(
    async () =>
      ({
        promise: Promise.reject(new Error("Invalid PDF structure")),
        destroy: vi.fn(async () => {}),
      }) as unknown as Awaited<ReturnType<typeof loadPdf>>,
  );
  await act(async () => expect(await session.load(next)).toBe(false));
  expect(useWorkspace.getState()).toMatchObject({
    document: previous,
    busy: false,
    status: "Unable to open PDF",
    error: "This PDF appears to be damaged. The current document is unchanged.",
  });
  expect(controller.detach).not.toHaveBeenCalled();
  expect(desktop.releaseDocument).toHaveBeenCalledWith(next.id);
  expect(desktop.releaseDocument).not.toHaveBeenCalledWith(previous.id);
});

it("cancels a password retry without showing its stale password error", async () => {
  let rejectTask: (reason: Error) => void = () => {};
  const promise = new Promise<never>((_, reject) => {
    rejectTask = reject;
  });
  vi.mocked(loadPdf).mockImplementation(async (_descriptor, onPassword) => {
    onPassword(vi.fn(), 2);
    return {
      promise,
      destroy: vi.fn(async () => rejectTask(new Error("Incorrect Password"))),
    } as unknown as Awaited<ReturnType<typeof loadPdf>>;
  });
  let loading: Promise<boolean>;
  await act(async () => {
    loading = session.load(next);
  });
  expect(session.password?.reason).toBe(2);
  await act(async () => {
    session.cancelPassword();
    expect(await loading).toBe(false);
  });
  expect(session.password).toBeNull();
  expect(useWorkspace.getState()).toMatchObject({
    document: previous,
    busy: false,
    error: "",
    status: "Opening cancelled",
  });
});

it("reports Ready after late range progress while attaching the viewer", async () => {
  const candidate = {
    promise: Promise.resolve({
      numPages: 12,
      getMetadata: async () => ({ info: {} }),
    }),
    destroy: vi.fn(async () => {}),
    onProgress: () => {},
  };
  vi.mocked(loadPdf).mockResolvedValue(candidate as unknown as Awaited<ReturnType<typeof loadPdf>>);
  vi.mocked(controller.attach).mockImplementation(async () =>
    candidate.onProgress({ percent: 77 }),
  );
  await act(async () => expect(await session.load(next)).toBe(true));
  expect(useWorkspace.getState()).toMatchObject({
    document: next,
    busy: false,
    status: "Ready",
  });
});

it("R1: preserves dirty state and recovery guard if discard-and-open is cancelled", async () => {
  useWorkspace.getState().set({ dirty: true });
  act(() => {
    session.open();
  });
  expect(session.confirm).not.toBeNull();
  vi.mocked(desktop.openDocument).mockResolvedValueOnce(null);
  await act(async () => {
    session.discardAndContinue();
  });
  // Active document remains dirty because replacement never committed
  expect(useWorkspace.getState().dirty).toBe(true);
  expect(useWorkspace.getState().document).toEqual(previous);
});

it("R2: preserves previous document and rolls back if candidate attachment fails", async () => {
  const candidatePdf = {
    numPages: 5,
    getMetadata: async () => ({ info: {} }),
  };
  const candidateTask = {
    promise: Promise.resolve(candidatePdf),
    destroy: vi.fn(async () => {}),
  };
  vi.mocked(loadPdf).mockResolvedValue(
    candidateTask as unknown as Awaited<ReturnType<typeof loadPdf>>,
  );
  vi.mocked(controller.attach).mockRejectedValueOnce(new Error("Viewer initialization failed"));
  await act(async () => {
    expect(await session.load(next)).toBe(false);
  });
  expect(useWorkspace.getState().document).toEqual(previous);
  expect(desktop.releaseDocument).toHaveBeenCalledWith(next.id);
  expect(desktop.releaseDocument).not.toHaveBeenCalledWith(previous.id);
  expect(candidateTask.destroy).toHaveBeenCalled();
});

it("R3: updates document name and saved size after Save As", async () => {
  const dummyPdf = {
    saveDocument: vi.fn(async () => new Uint8Array([1, 2, 3, 4, 5])),
    numPages: 10,
  };
  (controller as unknown as { pdf: unknown }).pdf = dummyPdf;
  // Trigger save through session
  vi.mocked(desktop.saveDocument).mockResolvedValueOnce({
    name: "renamed.pdf",
    size: 54321,
  });
  // Simulate controller and pdf availability
  useWorkspace.getState().set({ dirty: true });
  await act(async () => {
    await session.save(true);
  });
  expect(useWorkspace.getState()).toMatchObject({
    dirty: false,
    document: { id: "previous", name: "renamed.pdf", size: 54321 },
  });
});

it("keeps candidate bookmarks and an imported document's unsaved guard after open", async () => {
  const bookmarks = [{ title: "Chapter", destination: "chapter", children: [] }];
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({ numPages: 2, getMetadata: async () => ({ info: {} }) }),
    destroy: vi.fn(async () => {}),
  } as unknown as Awaited<ReturnType<typeof loadPdf>>);
  vi.mocked(controller.attach).mockImplementation(async () => {
    useWorkspace.getState().set({ bookmarks });
  });
  await act(async () => expect(await session.load({ ...next, unsaved: true })).toBe(true));
  expect(useWorkspace.getState()).toMatchObject({ bookmarks, dirty: true });
  expect(desktop.markDirty).toHaveBeenCalledWith(true);
});

it("keeps a committed candidate active when retiring the previous handle fails", async () => {
  const candidate = {
    promise: Promise.resolve({ numPages: 2, getMetadata: async () => ({ info: {} }) }),
    destroy: vi.fn(async () => {}),
  };
  vi.mocked(loadPdf).mockResolvedValue(candidate as unknown as Awaited<ReturnType<typeof loadPdf>>);
  vi.mocked(desktop.releaseDocument).mockRejectedValueOnce(new Error("Cleanup failed"));
  await act(async () => expect(await session.load(next)).toBe(true));
  expect(useWorkspace.getState().document).toEqual(next);
  expect(candidate.destroy).not.toHaveBeenCalled();
  expect(useWorkspace.getState().busy).toBe(false);
});

it("retains the recovery file until the recovered copy is saved", async () => {
  vi.mocked(desktop.openRecovery).mockResolvedValueOnce(next);
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({ numPages: 2, getMetadata: async () => ({ info: {} }) }),
    destroy: vi.fn(async () => {}),
  } as unknown as Awaited<ReturnType<typeof loadPdf>>);
  await act(async () => session.recover("candidate-recovery"));
  expect(desktop.openRecovery).toHaveBeenCalledWith("candidate-recovery");
  expect(useWorkspace.getState().document).toEqual(next);
  expect(useWorkspace.getState().dirty).toBe(true);
  expect(desktop.discardRecovery).not.toHaveBeenCalledWith("candidate-recovery");
});

function candidateTask() {
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({ numPages: 2, getMetadata: async () => ({ info: {} }) }),
    destroy: vi.fn(async () => {}),
  } as unknown as Awaited<ReturnType<typeof loadPdf>>);
}

it("keeps signature, form and comment findings from attach across the store reset", async () => {
  candidateTask();
  const comment = { id: "c1", page: 1, kind: "Text", contents: "Check", author: "" };
  vi.mocked(controller.attach).mockImplementation(async () => {
    useWorkspace.getState().set({
      pageLabels: ["i", "ii"],
      editingAllowed: false,
      hasDigitalSignature: true,
      formNotice: "XFA forms are not supported.",
      comments: [comment] as never,
    });
  });
  await act(async () => expect(await session.load(next)).toBe(true));
  expect(useWorkspace.getState()).toMatchObject({
    document: next,
    pageLabels: ["i", "ii"],
    editingAllowed: false,
    hasDigitalSignature: true,
    formNotice: "XFA forms are not supported.",
    comments: [comment],
  });
});

it("discards only the replaced document's recovery copy when another document opens", async () => {
  candidateTask();
  await act(async () => expect(await session.load(next)).toBe(true));
  expect(desktop.discardRecovery).toHaveBeenCalledWith(previous.id);
  expect(desktop.discardRecovery).not.toHaveBeenCalledWith(next.id);
  expect(desktop.discardRecovery).toHaveBeenCalledTimes(1);
});

it("leaves a clean document clean when saving fails", async () => {
  useWorkspace.getState().set({ dirty: false });
  (controller as unknown as { pdf: unknown }).pdf = {
    saveDocument: vi.fn(async () => new Uint8Array([1])),
    numPages: 2,
  };
  vi.mocked(desktop.saveDocument).mockRejectedValueOnce(new Error("disk full"));
  await act(async () => expect(await session.save()).toBe(false));
  expect(useWorkspace.getState()).toMatchObject({
    dirty: false,
    status: "Save failed. The document is unchanged.",
  });
  expect(desktop.markDirty).toHaveBeenCalledWith(false);
});

it("closes the unsaved-changes prompt before a protected save asks how to protect", async () => {
  useWorkspace.getState().set({
    dirty: true,
    info: {
      pages: 2,
      encrypted: false,
      protectedSource: true,
      title: "",
      author: "",
      version: "1.7",
    },
  });
  (controller as unknown as { pdf: unknown }).pdf = { saveDocument: vi.fn(), numPages: 2 };
  act(() => {
    session.home();
  });
  expect(session.confirm).not.toBeNull();
  await act(async () => {
    await session.saveAndContinue();
  });
  expect(session.confirm).toBeNull();
  expect(useWorkspace.getState()).toMatchObject({ activeModal: "protect", document: previous });
  expect(desktop.saveDocument).not.toHaveBeenCalled();
});

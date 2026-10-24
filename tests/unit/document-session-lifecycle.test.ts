// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentSession } from "../../src/app/useDocumentSession";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences, type Preferences } from "../../src/types/document";
import type { ViewerController } from "../../src/features/viewer/controller";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), isTauri: () => true }));
vi.mock("../../src/services/pdf", () => ({ loadPdf: vi.fn() }));
vi.mock("../../src/services/native", () => ({
  native: true,
  setBackgroundDirty: vi.fn(),
  localState: vi.fn(),
  releaseDocument: vi.fn(async () => {}),
  markDirty: vi.fn(async () => {}),
  discardRecovery: vi.fn(async () => {}),
  rememberPage: vi.fn(async () => {}),
  writeRecovery: vi.fn(async () => {}),
  sourceStatus: vi.fn(async () => ({ changed: false, missing: false })),
  reopenDocument: vi.fn(),
  reopenSession: vi.fn(async () => ({ documents: [], skipped: 0 })),
}));

import { loadPdf } from "../../src/services/pdf";
import * as desktop from "../../src/services/native";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let session: ReturnType<typeof useDocumentSession>;
let controller: ViewerController;
const original = { id: "doc", name: "report.pdf", size: 100 };
const reopened = { id: "doc-2", name: "report.pdf", size: 120 };

async function mount(preferences: Partial<Preferences> = {}) {
  vi.mocked(desktop.localState).mockResolvedValue({
    preferences: { ...defaultPreferences, ...preferences },
    recents: [],
    recoveries: [],
  });
  controller = {
    detach: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    releaseRevision: vi.fn(async () => {}),
    park: vi.fn(async () => ({
      pdf: { numPages: 2, saveDocument: vi.fn(async () => new Uint8Array([9])) },
    })),
    resume: vi.fn(async () => {}),
    seedRevision: vi.fn(),
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
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useWorkspace.getState().reset();
  vi.mocked(loadPdf).mockResolvedValue({
    promise: Promise.resolve({
      numPages: 3,
      getMetadata: async () => ({ info: {} }),
      saveDocument: async () => new Uint8Array([1]),
    }),
    destroy: vi.fn(async () => {}),
  } as never);
  vi.mocked(desktop.reopenDocument).mockResolvedValue(reopened);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

function openOriginal(patch: Partial<ReturnType<typeof useWorkspace.getState>> = {}) {
  useWorkspace.getState().set({ document: original, page: 2, ...patch });
}

describe("revert", () => {
  it("asks first, then opens the saved file at the same page and releases the edited copy", async () => {
    await mount();
    openOriginal({ dirty: true });
    act(() => session.revert());
    expect(session.revertPending).toBe(true);
    act(() => session.cancelRevert());
    expect(desktop.reopenDocument).not.toHaveBeenCalled();
    act(() => session.revert());
    await act(async () => session.confirmRevert());
    expect(desktop.reopenDocument).toHaveBeenCalledWith("doc");
    expect(controller.goTo).toHaveBeenCalledWith(2);
    expect(useWorkspace.getState()).toMatchObject({
      document: reopened,
      dirty: false,
      status: "Reverted to the last saved version",
    });
    expect(desktop.discardRecovery).toHaveBeenCalledWith("doc");
    expect(desktop.releaseDocument).toHaveBeenCalledWith("doc");
  });

  it("reports a document with no saved file and keeps it open", async () => {
    await mount();
    openOriginal({ dirty: true });
    vi.mocked(desktop.reopenDocument).mockRejectedValueOnce(
      new Error("This document has no saved file to go back to."),
    );
    act(() => session.revert());
    await act(async () => session.confirmRevert());
    expect(useWorkspace.getState()).toMatchObject({
      document: original,
      dirty: true,
      error: "This document has no saved file to go back to.",
    });
  });
});

describe("files changed on disk", () => {
  it("reloads a document without unsaved edits once its file changes", async () => {
    await mount();
    openOriginal();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(desktop.sourceStatus).toHaveBeenCalledWith("doc");
    expect(desktop.reopenDocument).not.toHaveBeenCalled();
    vi.mocked(desktop.sourceStatus).mockResolvedValueOnce({ changed: true, missing: false });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(desktop.reopenDocument).toHaveBeenCalledWith("doc");
    expect(useWorkspace.getState()).toMatchObject({
      document: reopened,
      status: "Reloaded report.pdf because it changed on disk",
    });
  });

  it("asks before replacing unsaved edits and reports each change once", async () => {
    await mount();
    openOriginal({ dirty: true });
    vi.mocked(desktop.sourceStatus).mockResolvedValue({ changed: true, missing: false });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(session.externalChange).toBe("report.pdf");
    expect(desktop.reopenDocument).not.toHaveBeenCalled();
    act(() => session.keepExternalChange());
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(session.externalChange).toBeNull();
    expect(desktop.sourceStatus).toHaveBeenCalledTimes(1);
    expect(useWorkspace.getState().dirty).toBe(true);
  });

  it("reloads on request from the prompt", async () => {
    await mount();
    openOriginal({ dirty: true });
    vi.mocked(desktop.sourceStatus).mockResolvedValueOnce({ changed: true, missing: false });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await act(async () => session.reloadExternalChange());
    expect(useWorkspace.getState()).toMatchObject({
      document: reopened,
      status: "Reloaded the version on disk",
    });
  });

  it("warns once when the file disappears and stops watching when the preference is off", async () => {
    await mount();
    openOriginal();
    vi.mocked(desktop.sourceStatus).mockResolvedValue({ changed: false, missing: true });
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(useWorkspace.getState().error).toMatch(/report\.pdf was moved or deleted/);
    expect(desktop.sourceStatus).toHaveBeenCalledTimes(1);

    useWorkspace.getState().set({
      document: { ...original, id: "other" },
      local: {
        ...useWorkspace.getState().local,
        preferences: { ...defaultPreferences, reloadChangedFiles: false },
      },
    });
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(desktop.sourceStatus).toHaveBeenCalledTimes(1);
  });
});

describe("reopening the last session", () => {
  it("opens the first document at its page when the preference is on", async () => {
    vi.mocked(desktop.reopenSession).mockResolvedValue({
      documents: [
        { descriptor: original, page: 3 },
        { descriptor: reopened, page: 1 },
      ],
      skipped: 1,
    });
    await mount({ reopenSession: true });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(desktop.reopenSession).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(controller.resume).toHaveBeenCalledOnce());
    // Both documents open in tabs, in session order, and the first is shown at its page.
    expect(useWorkspace.getState().tabs.map((tab) => tab.id)).toEqual(["doc", "doc-2"]);
    expect(useWorkspace.getState().document).toEqual(original);
    expect(controller.goTo).toHaveBeenCalledWith(3);
    expect(desktop.releaseDocument).not.toHaveBeenCalled();
    expect(useWorkspace.getState().status).toMatch(/1 document\(s\) from the last session/);
  });

  it("does nothing when the preference is off", async () => {
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(desktop.reopenSession).not.toHaveBeenCalled();
  });
});

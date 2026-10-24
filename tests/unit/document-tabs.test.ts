// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentSession } from "../../src/app/useDocumentSession";
import { neighborTab, placeTab, stepTab } from "../../src/app/document-tabs";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";
import type { ViewerController } from "../../src/features/viewer/controller";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), isTauri: () => true }));
vi.mock("../../src/services/pdf", () => ({ loadPdf: vi.fn() }));
vi.mock("../../src/services/native", () => ({
  native: true,
  setBackgroundDirty: vi.fn(),
  localState: vi.fn(async () => ({ preferences: defaultPreferences, recents: [], recoveries: [] })),
  openDocument: vi.fn(),
  releaseDocument: vi.fn(async () => {}),
  markDirty: vi.fn(async () => {}),
  discardRecovery: vi.fn(async () => {}),
  rememberPage: vi.fn(async () => {}),
  writeRecovery: vi.fn(async () => {}),
  sourceStatus: vi.fn(async () => ({ changed: false, missing: false })),
  reopenSession: vi.fn(async () => ({ documents: [], skipped: 0 })),
}));

import { loadPdf } from "../../src/services/pdf";
import * as desktop from "../../src/services/native";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let host: HTMLDivElement;
let session: ReturnType<typeof useDocumentSession>;
let controller: ViewerController & { shownPdf: unknown };
const docs = ["a", "b", "c"].map((id) => ({ id, name: `${id}.pdf`, size: 10 }));

beforeEach(async () => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
  let parks = 0;
  controller = {
    shownPdf: null,
    detach: vi.fn(async () => {}),
    attach: vi.fn(async function (this: { shownPdf: unknown }, pdf: unknown) {
      controller.shownPdf = pdf;
    }),
    releaseRevision: vi.fn(async () => {}),
    seedRevision: vi.fn(),
    goTo: vi.fn(),
    park: vi.fn(async () => {
      parks++;
      return {
        pdf: { numPages: 1, saveDocument: async () => new Uint8Array([parks]) },
        revisionTask: { destroy: vi.fn(async () => {}) },
        id: parks,
      };
    }),
    resume: vi.fn(async () => {}),
    viewer: { firstPagePromise: Promise.resolve() },
  } as unknown as ViewerController & { shownPdf: unknown };
  vi.mocked(loadPdf).mockImplementation(
    async () =>
      ({
        promise: Promise.resolve({ numPages: 1, getMetadata: async () => ({ info: {} }) }),
        destroy: vi.fn(async () => {}),
      }) as never,
  );
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

/** Opens a, b and c in tabs, leaving c shown, and marks a as edited before b opened. */
async function openThree() {
  for (const [index, descriptor] of docs.entries()) {
    vi.mocked(desktop.openDocument).mockResolvedValueOnce(descriptor);
    await act(async () => session.open());
    await vi.waitFor(() => expect(useWorkspace.getState().document).toEqual(descriptor));
    if (index === 0) useWorkspace.getState().set({ dirty: true, page: 4, zoom: 150 });
  }
}

const ids = () => useWorkspace.getState().tabs.map((tab) => tab.id);

describe("tab helpers", () => {
  it("places, steps through and picks neighbours of tabs", () => {
    const tabs = docs.map(({ id, name }) => ({ id, name, dirty: false }));
    expect(placeTab(tabs, "b", { id: "b2", name: "b.pdf", size: 1 }).map((tab) => tab.id)).toEqual([
      "a",
      "b2",
      "c",
    ]);
    expect(placeTab(tabs, null, { id: "d", name: "d.pdf", size: 1 }, true).at(-1)).toEqual({
      id: "d",
      name: "d.pdf",
      dirty: true,
    });
    expect(stepTab(tabs, "c", 1)).toBe("a");
    expect(stepTab(tabs, "a", -1)).toBe("c");
    expect(stepTab([tabs[0]], "a", 1)).toBeNull();
    expect(neighborTab(tabs, "b")).toBe("c");
    expect(neighborTab(tabs, "c")).toBe("b");
    expect(neighborTab([tabs[0]], "a")).toBeNull();
  });
});

describe("document tabs", () => {
  it("keeps each document's own state while another tab is shown", async () => {
    await openThree();
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(useWorkspace.getState().tabs[0]).toEqual({ id: "a", name: "a.pdf", dirty: true });
    expect(desktop.writeRecovery).toHaveBeenCalledWith(docs[0], new Uint8Array([1]), 1);
    expect(desktop.setBackgroundDirty).toHaveBeenLastCalledWith(true);

    await act(async () => session.switchTab("a"));
    expect(controller.resume).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(useWorkspace.getState()).toMatchObject({ document: docs[0], dirty: true, page: 4 });
    expect(desktop.markDirty).toHaveBeenLastCalledWith(true);
    // a is shown again, so no background tab has unsaved changes.
    expect(desktop.setBackgroundDirty).toHaveBeenLastCalledWith(false);
    expect(ids()).toEqual(["a", "b", "c"]);

    await act(async () => session.stepTabs(-1));
    expect(useWorkspace.getState().document).toEqual(docs[2]);
    expect(useWorkspace.getState().dirty).toBe(false);
  });

  it("closes a clean background tab and shows a dirty one before closing it", async () => {
    await openThree();
    await act(async () => session.closeBackground("b"));
    expect(ids()).toEqual(["a", "c"]);
    expect(desktop.releaseDocument).toHaveBeenCalledWith("b");
    expect(desktop.discardRecovery).toHaveBeenCalledWith("b");

    await act(async () => expect(await session.closeBackground("a")).toBe(false));
    expect(useWorkspace.getState().document).toEqual(docs[0]);
    expect(desktop.releaseDocument).not.toHaveBeenCalledWith("a");
  });

  it("shows the neighbouring tab after the shown one closes", async () => {
    await openThree();
    await act(async () => session.switchTab("b"));
    await act(async () => session.home());
    await vi.waitFor(() => expect(useWorkspace.getState().document).toEqual(docs[2]));
    expect(ids()).toEqual(["a", "c"]);
    expect(desktop.releaseDocument).toHaveBeenCalledWith("b");
  });

  it("asks about unsaved background tabs before closing the window", async () => {
    await openThree();
    const close = vi.mocked(listen).mock.calls.find(([event]) => event === "close-requested")?.[1];
    await act(async () => close?.({} as never));
    expect(session.unsavedTabs).toEqual(["a.pdf"]);
    act(() => session.cancelClose());
    expect(session.unsavedTabs).toBeNull();

    await act(async () => close?.({} as never));
    await act(async () => session.reviewUnsaved());
    await vi.waitFor(() => expect(useWorkspace.getState().document).toEqual(docs[0]));

    await act(async () => session.switchTab("c"));
    await act(async () => close?.({} as never));
    await act(async () => session.discardUnsavedAndClose());
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("close_window"));
    for (const id of ["a", "b", "c"]) expect(desktop.discardRecovery).toHaveBeenCalledWith(id);
  });
});

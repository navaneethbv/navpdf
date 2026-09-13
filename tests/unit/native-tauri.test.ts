// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}));

import {
  clearRecents,
  discardRecovery,
  localState,
  markDirty,
  openDocument,
  openRecent,
  openRecovery,
  readRange,
  releaseDocument,
  rememberPage,
  saveDocument,
  savePreferences,
  writeRecovery,
} from "../../src/services/native";

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "open_document":
        return { id: "n1", name: "native.pdf", size: 100 };
      case "read_range":
        return new Uint8Array([7, 8, 9]).buffer;
      case "save_document":
        return { name: "saved.pdf", size: 9 };
      case "local_state":
        return { preferences: {}, recents: [], recovery: null };
      case "open_recovery":
        return { id: "rec", name: "rec.pdf", size: 10 };
      case "open_recent":
        return { id: "r", name: "r.pdf", size: 10 };
      default:
        return undefined;
    }
  });
});

describe("native service Tauri paths", () => {
  it("opens, reads, saves, and releases through IPC", async () => {
    const descriptor = await openDocument();
    expect(descriptor).toMatchObject({ id: "n1", name: "native.pdf" });
    const bytes = await readRange("n1", 0, 3);
    expect([...bytes]).toEqual([7, 8, 9]);
    expect(invoke).toHaveBeenCalledWith("read_range", {
      id: "n1",
      begin: 0,
      end: 3,
    });
    const result = await saveDocument(descriptor!, new Uint8Array([1]), 1, true);
    expect(result).toMatchObject({ name: "saved.pdf", size: 9 });
    expect(invoke).toHaveBeenCalledWith(
      "save_document",
      new Uint8Array([1]),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-save-as": "true" }),
      }),
    );
    await releaseDocument("n1");
    expect(invoke).toHaveBeenCalledWith("close_document", { id: "n1" });
  });

  it("syncs local state, preferences, recents, dirty flags, and pages", async () => {
    await localState();
    expect(invoke).toHaveBeenCalledWith("local_state");
    await savePreferences({} as never);
    expect(invoke).toHaveBeenCalledWith("save_preferences", {
      preferences: {},
    });
    await clearRecents();
    expect(invoke).toHaveBeenCalledWith("clear_recents");
    await markDirty(true);
    expect(invoke).toHaveBeenCalledWith("mark_dirty", { dirty: true });
    await rememberPage("n1", 5);
    expect(invoke).toHaveBeenCalledWith("remember_page", { id: "n1", page: 5 });
  });

  it("writes and opens recovery copies through IPC", async () => {
    await writeRecovery(
      { id: "n1", name: "n.pdf", size: 1 },
      new Uint8Array([1, 2]),
      2,
    );
    expect(invoke).toHaveBeenCalledWith(
      "write_recovery",
      new Uint8Array([1, 2]),
      expect.objectContaining({ headers: expect.anything() }),
    );
    await expect(openRecovery()).resolves.toMatchObject({ id: "rec" });
    await expect(openRecent("r")).resolves.toMatchObject({ id: "r" });
    await discardRecovery();
    expect(invoke).toHaveBeenCalledWith("discard_recovery");
  });
});

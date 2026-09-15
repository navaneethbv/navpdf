// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { defaultPreferences } from "../../src/types/document";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("native unavailable in tests");
  }),
  isTauri: () => false,
}));

describe("native service browser fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("opens a File and reads back bounded ranges", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "sample.pdf", {
      type: "application/pdf",
    });
    const descriptor = await openDocument(file);
    expect(descriptor?.name).toBe("sample.pdf");
    const head = await readRange(descriptor!.id, 0, 3);
    expect([...head]).toEqual([1, 2, 3]);
    await releaseDocument(descriptor!.id);
    await expect(readRange(descriptor!.id, 0, 1)).rejects.toThrow(
      /no longer available/,
    );
  });

  it("returns null when no file is provided outside Tauri", async () => {
    await expect(openDocument()).resolves.toBeNull();
  });

  it("rejects files larger than 1 GB", async () => {
    const file = new File(["x"], "big.pdf");
    Object.defineProperty(file, "size", { value: 1024 ** 3 + 1 });
    await expect(openDocument(file)).rejects.toThrow(/smaller than 1 GB/);
  });

  it("downloads edited bytes through an anchor element", async () => {
    const file = new File([new Uint8Array([9, 9])], "doc.pdf");
    const descriptor = await openDocument(file);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const result = await saveDocument(
      descriptor!,
      new Uint8Array([1, 2, 3]),
      2,
      false,
    );
    expect(result?.name).toBe("doc-edited.pdf");
    expect(result?.size).toBe(3);
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("persists preferences to localStorage with network access off", async () => {
    await savePreferences({ ...defaultPreferences, theme: "dark" });
    const state = await localState();
    expect(state.preferences.theme).toBe("dark");
    expect(state.preferences.networkAccess).toBe(false);
    expect(state.recents).toEqual([]);
    expect(state.recoveries).toEqual([]);
  });

  it("returns defaults when nothing is stored", async () => {
    const state = await localState();
    expect(state.preferences).toEqual(defaultPreferences);
  });

  it("no-ops native-only calls without throwing", async () => {
    await expect(markDirty(true)).resolves.toBeUndefined();
    await expect(rememberPage("x", 3)).resolves.toBeUndefined();
    await expect(clearRecents()).resolves.toBeUndefined();
    await expect(discardRecovery()).resolves.toBeUndefined();
    await expect(
      writeRecovery({ id: "x", name: "x", size: 1 }, new Uint8Array([1]), 1),
    ).resolves.toBeUndefined();
    await expect(openRecent("x")).rejects.toThrow();
    await expect(openRecovery()).rejects.toThrow();
  });
});

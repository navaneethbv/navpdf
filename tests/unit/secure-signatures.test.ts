// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchSignatureLibrary,
  persistOrStageSignature,
  removeSignature,
  hasLegacyPlaintextSignatures,
  getLegacyPlaintextSignatures,
  migrateLegacySignatures,
  clearSessionSignatures,
  getSessionSignatures,
} from "../../src/services/signature-store";
import * as nativeModule from "../../src/services/native";

describe("signature store service", () => {
  beforeEach(() => {
    clearSessionSignatures();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stages session-only signatures in memory without writing to native storage", async () => {
    const saveSpy = vi.spyOn(nativeModule, "saveSignature");
    const { signature, error } = await persistOrStageSignature(
      "My Session Sig",
      "signature",
      "data:image/png;base64,sample",
      true,
    );
    expect(error).toBeNull();
    expect(signature.sessionOnly).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();

    const sessionSigs = getSessionSignatures();
    expect(sessionSigs).toHaveLength(1);
    expect(sessionSigs[0].name).toBe("My Session Sig");

    const library = await fetchSignatureLibrary();
    expect(library.signatures).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "My Session Sig" })]),
    );

    await removeSignature(signature.id, true);
    expect(getSessionSignatures()).toHaveLength(0);
  });

  it("calls native save and load for persistent signatures", async () => {
    const mockSig = {
      id: "native-123",
      name: "Permanent Sig",
      type: "signature" as const,
      dataUrl: "data:image/png;base64,native",
      createdAt: 1000,
      storage: "secure" as const,
    };
    vi.spyOn(nativeModule, "saveSignature").mockResolvedValue(mockSig);
    vi.spyOn(nativeModule, "loadSignatures").mockResolvedValue({
      assets: [mockSig],
      warnings: ["One saved signature could not be read."],
    });
    const deleteSpy = vi.spyOn(nativeModule, "deleteSignature").mockResolvedValue();

    const { signature, error } = await persistOrStageSignature(
      "Permanent Sig",
      "signature",
      "data:image/png;base64,native",
      false,
    );
    expect(error).toBeNull();
    expect(signature.id).toBe("native-123");

    const library = await fetchSignatureLibrary();
    expect(library.signatures).toHaveLength(1);
    expect(library.signatures[0].id).toBe("native-123");

    await removeSignature("native-123", false);
    expect(deleteSpy).toHaveBeenCalledWith("native-123");
  });

  it("detects legacy plaintext signatures and migrates them safely", async () => {
    expect(hasLegacyPlaintextSignatures()).toBe(false);

    const legacyData = [
      {
        id: "leg-1",
        name: "Old Initials",
        type: "initials",
        dataUrl: "data:image/png;base64,old",
        createdAt: 500,
      },
    ];
    localStorage.setItem("navpdf-signatures", JSON.stringify(legacyData));
    expect(hasLegacyPlaintextSignatures()).toBe(true);
    expect(getLegacyPlaintextSignatures()).toHaveLength(1);

    const migrateSpy = vi.spyOn(nativeModule, "migrateSignatures").mockResolvedValue(legacyData);

    const result = await migrateLegacySignatures(true);
    expect(result.count).toBe(1);
    expect(result.error).toBeNull();
    expect(migrateSpy).toHaveBeenCalledWith([
      expect.objectContaining(legacyData[0]),
    ]);
    expect(localStorage.getItem("navpdf-signatures")).toBeNull();
  });

  it("discards legacy plaintext signatures when user declines migration", async () => {
    localStorage.setItem("navpdf-signatures", JSON.stringify([{ id: "1", name: "Sig" }]));
    expect(hasLegacyPlaintextSignatures()).toBe(true);

    const result = await migrateLegacySignatures(false);
    expect(result.count).toBe(0);
    expect(localStorage.getItem("navpdf-signatures")).toBeNull();
  });

  it("handles native storage failure gracefully without crashing", async () => {
    vi.spyOn(nativeModule, "loadSignatures").mockRejectedValue(new Error("Keychain locked"));

    const library = await fetchSignatureLibrary();
    expect(library.error).toContain("Keychain locked");
    expect(library.signatures).toEqual([]);
  });
});

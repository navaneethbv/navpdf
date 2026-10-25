// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
let desktop = true;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => desktop,
}));

async function engine() {
  vi.resetModules();
  return import("../../src/services/engine");
}

const staged: Uint8Array[] = [];

beforeEach(() => {
  desktop = true;
  staged.length = 0;
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args: unknown) => {
    switch (command) {
      case "engine_stage":
        staged.push(args as Uint8Array);
        return `stage-${staged.length}`;
      case "engine_take":
        return new Uint8Array([9, 8, 7]).buffer;
      case "engine_redact":
        return { outputId: "out-1", report: { removedGlyphs: 3 } };
      case "engine_compress":
        return { outputId: null, report: { useful: false } };
      case "engine_inspect_page":
        return { page: 2, mediaBox: [0, 0, 612, 792], objects: [] };
      case "engine_edit":
        return { outputId: "out-2", report: { applied: true } };
      case "engine_save_protected":
        return { name: "copy.pdf", size: 10, replacedSource: false };
      case "engine_unlock":
        return "out-3";
      case "engine_choose_certificate":
        return { subject: "CN=Synthetic Signer" };
      case "engine_save_signed":
        return { name: "signed.pdf", size: 20 };
      case "engine_verify_signatures":
        return [];
      case "engine_signed_revision":
        return "revision-1";
      case "trust_list":
      case "trust_signature_certificate":
      case "trust_remove":
        return [{ fingerprint: "AA" }];
      case "trust_import":
        return null;
      case "engine_tags":
        return { tagged: false, nodes: [], truncated: false };
      case "engine_untagged":
        return { tagged: false, pages: [], truncated: false };
      case "engine_pdfa_validate":
        return { level: "PDF/A-2b", passed: true, findings: [], declared: null, notChecked: [] };
      case "engine_standards":
        return { pdfa: null, pdfua: null, pdfx: null, outputIntents: [] };
      case "engine_standards_edit":
        return { outputId: "out-pdfa", report: { message: "Converted" } };
      case "engine_tag_edit":
        return { outputId: "out-tags", report: { message: "Added 3 tags." } };
      default:
        return undefined;
    }
  });
});

describe("engine service", () => {
  it("stages input bytes and retrieves staged outputs", async () => {
    const service = await engine();
    const bytes = new Uint8Array([1, 2, 3]);
    const request = {
      regions: [{ page: 1, rect: [1, 2, 3, 4] as [number, number, number, number] }],
      terms: ["SYNTHETIC"],
      options: {
        removeMetadata: true,
        removeAttachments: true,
        removeScripts: true,
        removeComments: false,
        removeBookmarks: false,
        removeHiddenContent: true,
      },
      acknowledgeSignatures: false,
    };
    const redacted = await service.redactDocument("doc", bytes, request, "job");
    expect(staged[0]).toBe(bytes);
    expect(invoke).toHaveBeenCalledWith("engine_redact", {
      inputId: "stage-1",
      documentId: "doc",
      jobId: "job",
      request,
    });
    expect(invoke).toHaveBeenCalledWith("engine_take", { id: "out-1" });
    expect([...redacted.bytes!]).toEqual([9, 8, 7]);
    expect(redacted.report).toEqual({ removedGlyphs: 3 });

    const compressed = await service.compressDocument(bytes, "small", "job-2");
    expect(compressed.bytes).toBeNull();
    expect(invoke).toHaveBeenCalledWith("engine_compress", {
      inputId: "stage-2",
      jobId: "job-2",
      preset: "small",
    });
  });

  it("inspects, edits with staged pixels, protects, unlocks and cancels", async () => {
    const service = await engine();
    const page = await service.inspectPage(new Uint8Array([1]), 2);
    expect(page.page).toBe(2);
    const rgba = new Uint8Array([255, 0, 0, 255]);
    const edited = await service.editPage(
      new Uint8Array([1]),
      2,
      { type: "replaceImage", objectId: "abc:1", width: 1, height: 1 },
      rgba,
    );
    expect(staged[2]).toBe(rgba);
    expect(invoke).toHaveBeenCalledWith("engine_edit", {
      inputId: "stage-2",
      page: 2,
      request: { type: "replaceImage", objectId: "abc:1", width: 1, height: 1 },
      imageId: "stage-3",
    });
    expect(edited.bytes).not.toBeNull();

    const saved = await service.saveProtectedCopy("doc", new Uint8Array([1]), 4, {
      userPassword: "synthetic-open",
      ownerPassword: "",
      permissions: {
        print: true,
        printHighQuality: true,
        copy: true,
        modify: true,
        annotate: true,
        fillForms: true,
        assemble: true,
        accessibility: true,
      },
    });
    expect(saved?.name).toBe("copy.pdf");
    expect(invoke).toHaveBeenCalledWith(
      "engine_save_protected",
      expect.objectContaining({ documentId: "doc", expectedPages: 4 }),
    );
    const unlocked = await service.unlockDocument("doc", "synthetic-open");
    expect(invoke).toHaveBeenCalledWith("engine_unlock", {
      documentId: "doc",
      password: "synthetic-open",
    });
    expect(unlocked).toHaveLength(3);
    await service.cancelEngineJob("job-9");
    expect(invoke).toHaveBeenCalledWith("engine_cancel", { jobId: "job-9" });
    expect(service.newJobId()).toMatch(/[0-9a-f-]{36}/);
  });

  it("chooses certificates, signs copies, checks signatures and releases keys", async () => {
    const service = await engine();
    expect((await service.chooseCertificate("synthetic-p12"))?.subject).toBe("CN=Synthetic Signer");
    expect(invoke).toHaveBeenCalledWith("engine_choose_certificate", { password: "synthetic-p12" });
    const request = { reason: "", location: "", certification: "none" as const };
    const bytes = new Uint8Array([1]);
    const signed = await service.saveSignedCopy("doc", bytes, 2, request);
    expect(signed?.name).toBe("signed.pdf");
    expect(staged[0]).toBe(bytes);
    expect(invoke).toHaveBeenCalledWith("engine_save_signed", {
      inputId: "stage-1",
      documentId: "doc",
      expectedPages: 2,
      request,
    });
    expect(await service.verifySignatures("doc")).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("engine_verify_signatures", { documentId: "doc" });
    await service.forgetCertificate();
    expect(invoke).toHaveBeenCalledWith("engine_forget_certificate");

    expect([...(await service.signedRevision("doc", "Signature1"))]).toEqual([9, 8, 7]);
    expect(invoke).toHaveBeenCalledWith("engine_signed_revision", {
      documentId: "doc",
      field: "Signature1",
    });
    expect(invoke).toHaveBeenCalledWith("engine_take", { id: "revision-1" });
    expect(await service.trustedCertificates()).toEqual([{ fingerprint: "AA" }]);
    expect(await service.importTrustedCertificate()).toBeNull();
    expect(await service.trustSignatureCertificate("doc", "AA")).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("trust_signature_certificate", {
      documentId: "doc",
      fingerprint: "AA",
    });
    await service.untrustCertificate("AA");
    expect(invoke).toHaveBeenCalledWith("trust_remove", { fingerprint: "AA" });
  });

  it("stages documents for PDF/A checks, standards and conversion", async () => {
    const service = await engine();
    const bytes = new Uint8Array([1]);
    expect((await service.validatePdfa(bytes, "2b")).passed).toBe(true);
    expect(invoke).toHaveBeenCalledWith("engine_pdfa_validate", {
      inputId: expect.any(String),
      level: "2b",
    });
    expect((await service.readStandards(bytes)).outputIntents).toEqual([]);
    const converted = await service.editStandards(bytes, { action: "convert", level: "3b" });
    expect(invoke).toHaveBeenCalledWith("engine_standards_edit", {
      inputId: expect.any(String),
      edit: { action: "convert", level: "3b" },
    });
    expect(converted.report.message).toBe("Converted");
    expect(invoke).toHaveBeenCalledWith("engine_take", { id: "out-pdfa" });
  });

  it("stages documents for tag listing, untagged content and tag edits", async () => {
    const service = await engine();
    const bytes = new Uint8Array([1]);
    expect((await service.readTags(bytes)).tagged).toBe(false);
    expect(invoke).toHaveBeenCalledWith("engine_tags", { inputId: expect.any(String) });
    expect((await service.findUntagged(bytes)).pages).toEqual([]);
    const edited = await service.editTags(bytes, { action: "autotag" });
    expect(invoke).toHaveBeenCalledWith("engine_tag_edit", {
      inputId: expect.any(String),
      edit: { action: "autotag" },
    });
    expect(invoke).toHaveBeenCalledWith("engine_take", { id: "out-tags" });
    expect(edited.report.message).toBe("Added 3 tags.");
    expect([...edited.bytes!]).toEqual([9, 8, 7]);
  });

  it("refuses engine work outside the desktop app", async () => {
    desktop = false;
    const service = await engine();
    await expect(service.inspectPage(new Uint8Array([1]), 1)).rejects.toThrow(
      service.ENGINE_UNAVAILABLE,
    );
    await expect(service.unlockDocument("doc", "pw")).rejects.toThrow(service.ENGINE_UNAVAILABLE);
    await expect(service.chooseCertificate("pw")).rejects.toThrow(service.ENGINE_UNAVAILABLE);
    await expect(service.verifySignatures("doc")).rejects.toThrow(service.ENGINE_UNAVAILABLE);
    await service.cancelEngineJob("job");
    await service.forgetCertificate();
    expect(invoke).not.toHaveBeenCalled();
  });
});

import { invoke } from "@tauri-apps/api/core";
import { native } from "./native";
import type {
  CertificateSummary,
  CompressionPreset,
  CompressionReport,
  EditReport,
  EditRequest,
  EngineResult,
  PageObjects,
  ProtectedSave,
  ProtectionRequest,
  RedactionReport,
  RedactionRequest,
  SignatureInfo,
  SignedSave,
  SignRequest,
} from "../types/engine";

export const ENGINE_UNAVAILABLE =
  "This tool uses NavPDF's local PDF engine, which runs only in the desktop app.";

interface Outcome<R> {
  outputId: string | null;
  report: R;
}

function requireEngine() {
  if (!native) throw new Error(ENGINE_UNAVAILABLE);
}

/** Stages bytes natively so commands receive an opaque id instead of a large payload. */
async function stage(bytes: Uint8Array): Promise<string> {
  return invoke<string>("engine_stage", bytes);
}

async function take(id: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await invoke<ArrayBuffer>("engine_take", { id }));
}

async function resolve<R>(outcome: Outcome<R>): Promise<EngineResult<R>> {
  return {
    bytes: outcome.outputId ? await take(outcome.outputId) : null,
    report: outcome.report,
  };
}

export function newJobId() {
  return crypto.randomUUID();
}

export async function cancelEngineJob(jobId: string) {
  if (native) await invoke("engine_cancel", { jobId });
}

export async function redactDocument(
  documentId: string,
  bytes: Uint8Array,
  request: RedactionRequest,
  jobId: string,
): Promise<EngineResult<RedactionReport>> {
  requireEngine();
  const inputId = await stage(bytes);
  return resolve(
    await invoke<Outcome<RedactionReport>>("engine_redact", {
      inputId,
      documentId,
      jobId,
      request,
    }),
  );
}

export async function compressDocument(
  bytes: Uint8Array,
  preset: CompressionPreset,
  jobId: string,
): Promise<EngineResult<CompressionReport>> {
  requireEngine();
  const inputId = await stage(bytes);
  return resolve(
    await invoke<Outcome<CompressionReport>>("engine_compress", {
      inputId,
      jobId,
      preset,
    }),
  );
}

export async function inspectPage(bytes: Uint8Array, page: number): Promise<PageObjects> {
  requireEngine();
  const inputId = await stage(bytes);
  return invoke<PageObjects>("engine_inspect_page", { inputId, page });
}

export async function editPage(
  bytes: Uint8Array,
  page: number,
  request: EditRequest,
  rgba?: Uint8Array,
): Promise<EngineResult<EditReport>> {
  requireEngine();
  const inputId = await stage(bytes);
  const imageId = rgba ? await stage(rgba) : null;
  return resolve(
    await invoke<Outcome<EditReport>>("engine_edit", {
      inputId,
      page,
      request,
      imageId,
    }),
  );
}

/** Opens the native Save As picker; resolves to null when the picker is cancelled. */
export async function saveProtectedCopy(
  documentId: string,
  bytes: Uint8Array,
  expectedPages: number,
  request: ProtectionRequest,
): Promise<ProtectedSave | null> {
  requireEngine();
  const inputId = await stage(bytes);
  return invoke<ProtectedSave | null>("engine_save_protected", {
    inputId,
    documentId,
    expectedPages,
    request,
  });
}

export async function unlockDocument(
  documentId: string,
  password: string,
): Promise<Uint8Array<ArrayBuffer>> {
  requireEngine();
  return take(await invoke<string>("engine_unlock", { documentId, password }));
}

/** Opens the native certificate picker; resolves to null when the picker is cancelled. */
export async function chooseCertificate(password: string): Promise<CertificateSummary | null> {
  requireEngine();
  return invoke<CertificateSummary | null>("engine_choose_certificate", { password });
}

/** Releases the decrypted signing key held by the native process. */
export async function forgetCertificate() {
  if (native) await invoke("engine_forget_certificate");
}

/** Signs a copy with the chosen certificate and opens the Save As picker; null when cancelled. */
export async function saveSignedCopy(
  documentId: string,
  bytes: Uint8Array,
  expectedPages: number,
  request: SignRequest,
): Promise<SignedSave | null> {
  requireEngine();
  const inputId = await stage(bytes);
  return invoke<SignedSave | null>("engine_save_signed", {
    inputId,
    documentId,
    expectedPages,
    request,
  });
}

/** Checks the certificate signatures in the file as it was opened. */
export async function verifySignatures(documentId: string): Promise<SignatureInfo[]> {
  requireEngine();
  return invoke<SignatureInfo[]>("engine_verify_signatures", { documentId });
}

/** Prunes unreferenced objects, renumbers objects, and compresses streams. */
export async function pruneDocument(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  requireEngine();
  const inputId = await stage(bytes);
  const outputId = await invoke<string>("engine_prune", { inputId });
  return take(outputId);
}

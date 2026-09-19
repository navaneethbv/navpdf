import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocumentDescriptor, LocalState, Preferences, SaveResult } from "../types/document";
import { defaultPreferences } from "../types/document";
import type { OcrEngineInfo, OcrOptions, OcrPageResult } from "../types/operations";
import { downloadBytes, safeFileName } from "../utils/download";
export const native = isTauri();
export const isNative = () => isTauri();
const files = new Map<string, File>();
export async function openDocument(file?: File): Promise<DocumentDescriptor | null> {
  if (!file) return native ? invoke<DocumentDescriptor | null>("open_document") : null;
  if (file.size > 1024 ** 3) throw new Error("Choose a PDF smaller than 1 GB.");
  if (native) {
    const name = JSON.stringify(file.name).replaceAll(
      /[^\x20-\x7e]/g,
      (char) => String.raw`\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`,
    );
    return invoke<DocumentDescriptor>("import_document", new Uint8Array(await file.arrayBuffer()), {
      headers: { "x-document-name": name },
    });
  }
  const id = crypto.randomUUID();
  files.set(id, file);
  return { id, name: file.name, size: file.size };
}
export async function openDocumentFromToken(token: string): Promise<DocumentDescriptor> {
  if (!native) throw new Error("Operating-system open events require the native application.");
  return invoke<DocumentDescriptor>("open_document_from_token", { token });
}
export async function openExternalUrl(url: string): Promise<void> {
  if (native) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
export async function openRecent(id: string) {
  return invoke<DocumentDescriptor>("open_recent", { id });
}
export async function readRange(
  id: string,
  begin: number,
  end: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (native) {
    const result = await invoke<ArrayBuffer>("read_range", { id, begin, end });
    return new Uint8Array(result);
  }
  const file = files.get(id);
  if (!file) throw new Error("This document is no longer available.");
  return new Uint8Array(await file.slice(begin, end).arrayBuffer());
}
export async function releaseDocument(id: string) {
  if (native) await invoke("close_document", { id });
  else files.delete(id);
}
export async function saveDocument(
  descriptor: DocumentDescriptor,
  bytes: Uint8Array<ArrayBuffer>,
  pages: number,
  saveAs: boolean,
): Promise<SaveResult | null> {
  if (native)
    return invoke<SaveResult | null>("save_document", bytes, {
      headers: {
        "x-document-id": descriptor.id,
        "x-page-count": String(pages),
        "x-save-as": String(saveAs),
      },
    });
  const name = safeFileName(
    descriptor.name.replace(/\.pdf$/i, "-edited.pdf"),
    "document-edited.pdf",
  );
  await downloadBytes(bytes, name);
  return { name, size: bytes.length };
}
export async function localState(): Promise<LocalState> {
  if (native) return invoke("local_state");
  const raw = localStorage.getItem("navpdf-preferences");
  let stored: unknown;
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = undefined;
    }
  }
  return {
    preferences:
      stored && typeof stored === "object"
        ? { ...defaultPreferences, ...(stored as Partial<Preferences>), networkAccess: false }
        : defaultPreferences,
    recents: [],
    recoveries: [],
  };
}
export async function savePreferences(preferences: Preferences) {
  if (native) await invoke("save_preferences", { preferences });
  else localStorage.setItem("navpdf-preferences", JSON.stringify(preferences));
}
export async function clearRecents() {
  if (native) await invoke("clear_recents");
}
export async function markDirty(dirty: boolean) {
  if (native) await invoke("mark_dirty", { dirty });
}
export async function rememberPage(id: string, page: number) {
  if (native) await invoke("remember_page", { id, page });
}
export async function writeRecovery(
  descriptor: DocumentDescriptor,
  bytes: Uint8Array<ArrayBuffer>,
  pages: number,
) {
  if (native)
    await invoke("write_recovery", bytes, {
      headers: {
        "x-document-id": descriptor.id,
        "x-page-count": String(pages),
      },
    });
}
export async function openRecovery(id: string) {
  return invoke<DocumentDescriptor>("open_recovery", { id });
}
/** Removes one document's recovery copy; other documents' entries are kept. */
export async function discardRecovery(id: string) {
  if (native) await invoke("discard_recovery", { id });
}

export async function printDocument(bytes: Uint8Array<ArrayBuffer>, pages: number) {
  return invoke<boolean>("print_document", bytes, {
    headers: { "x-page-count": String(pages) },
  });
}

/** Where a saved signature lives: memory only, OS-protected storage, or unprotected storage. */
export type SignatureStorage = "session" | "secure" | "legacy";

export interface SavedSignature {
  id: string;
  name: string;
  type: "signature" | "initials";
  dataUrl: string;
  createdAt: number;
  storage: SignatureStorage;
  sessionOnly?: boolean;
}

export interface SignatureLibraryListing {
  assets: SavedSignature[];
  /** Notes about saved signatures that could not be read; never contains paths. */
  warnings: string[];
}

type StoredSignature = Omit<SavedSignature, "storage" | "sessionOnly">;

const withStorage = (asset: StoredSignature, storage: SignatureStorage): SavedSignature => ({
  ...asset,
  storage,
});

// The browser preview keeps signatures in plain localStorage, which is never OS-protected.
const PREVIEW_SIGNATURES = "navpdf-signatures-store";

function previewSignatures(): StoredSignature[] {
  try {
    const raw = localStorage.getItem(PREVIEW_SIGNATURES);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredSignature[]) : [];
  } catch {
    return [];
  }
}

function writePreviewSignatures(items: StoredSignature[]) {
  try {
    localStorage.setItem(PREVIEW_SIGNATURES, JSON.stringify(items));
  } catch {
    // Storage can be full or blocked in the preview; the signature stays usable this session.
  }
}

export async function loadSignatures(): Promise<SignatureLibraryListing> {
  if (native) {
    const listing = await invoke<{ assets: StoredSignature[]; warnings: string[] }>(
      "load_signatures",
    );
    return {
      assets: listing.assets.map((asset) => withStorage(asset, "secure")),
      warnings: listing.warnings,
    };
  }
  return {
    assets: previewSignatures().map((asset) => withStorage(asset, "legacy")),
    warnings: [],
  };
}

export async function saveSignature(
  name: string,
  type: "signature" | "initials",
  dataUrl: string,
): Promise<SavedSignature> {
  if (native) {
    const saved = await invoke<StoredSignature>("save_signature", {
      request: { name, type, dataUrl },
    });
    return withStorage(saved, "secure");
  }
  const sig: StoredSignature = {
    id: crypto.randomUUID(),
    name,
    type,
    dataUrl,
    createdAt: Math.floor(Date.now() / 1000),
  };
  writePreviewSignatures([sig, ...previewSignatures()]);
  return withStorage(sig, "legacy");
}

export async function deleteSignature(id: string): Promise<void> {
  if (native) {
    await invoke("delete_signature", { id });
    return;
  }
  writePreviewSignatures(previewSignatures().filter((s) => s.id !== id));
}

export async function migrateSignatures(items: SavedSignature[]): Promise<SavedSignature[]> {
  const stored: StoredSignature[] = items.map(({ id, name, type, dataUrl, createdAt }) => ({
    id,
    name,
    type,
    dataUrl,
    createdAt,
  }));
  if (native) {
    const migrated = await invoke<StoredSignature[]>("migrate_signatures", { items: stored });
    return migrated.map((asset) => withStorage(asset, "secure"));
  }
  writePreviewSignatures([...stored, ...previewSignatures()]);
  return stored.map((asset) => withStorage(asset, "legacy"));
}

export interface CommitRevisionResult {
  revisionId: string;
  pageCount: number;
  size: number;
}

export interface RevisionStatus {
  currentRevisionId: string;
  savedRevisionId: string;
  pageCount: number;
  isDirty: boolean;
}

export async function commitWorkingRevision(
  id: string,
  baseRevisionId: string,
  bytes: Uint8Array<ArrayBuffer>,
  pages: number,
): Promise<CommitRevisionResult> {
  if (native) {
    return invoke<CommitRevisionResult>("commit_working_revision", bytes, {
      headers: {
        "x-document-id": id,
        "x-base-revision-id": baseRevisionId,
        "x-page-count": String(pages),
      },
    });
  }
  return {
    revisionId: `web-rev-${Date.now()}`,
    pageCount: pages,
    size: bytes.length,
  };
}

export async function getRevision(id: string): Promise<RevisionStatus | null> {
  if (native) {
    return invoke<RevisionStatus>("get_revision", { id });
  }
  return null;
}

export async function ocrRecognizePage(
  imageBytes: Uint8Array,
  options: OcrOptions,
): Promise<OcrPageResult> {
  if (native) {
    return invoke<OcrPageResult>("ocr_recognize_page", imageBytes, {
      headers: { "x-ocr-options": JSON.stringify(options) },
    });
  }
  throw new Error("OCR requires the native macOS application.");
}

export async function ocrGetEngineInfo(): Promise<OcrEngineInfo> {
  if (native) return invoke<OcrEngineInfo>("ocr_get_engine_info");
  throw new Error("OCR requires the native macOS application.");
}

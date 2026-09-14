import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DocumentDescriptor,
  LocalState,
  Preferences,
  SaveResult,
} from "../types/document";
import { defaultPreferences } from "../types/document";
import type {
  OcrEngineInfo,
  OcrOptions,
  OcrPageResult,
} from "../types/operations";
import { downloadBytes, safeFileName } from "../utils/download";
export const native = isTauri();
const files = new Map<string, File>();
export async function openDocument(
  file?: File,
): Promise<DocumentDescriptor | null> {
  if (!file) return native ? invoke<DocumentDescriptor | null>("open_document") : null;
  if (file.size > 1024 ** 3) throw new Error("Choose a PDF smaller than 1 GB.");
  if (native) {
    const name = JSON.stringify(file.name).replace(/[^\x20-\x7e]/g, (char) =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
    return invoke<DocumentDescriptor>("import_document", new Uint8Array(await file.arrayBuffer()), {
      headers: { "x-document-name": name },
    });
  }
  const id = crypto.randomUUID();
  files.set(id, file);
  return { id, name: file.name, size: file.size };
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
  downloadBytes(bytes, name);
  return { name, size: bytes.length };
}
export async function localState(): Promise<LocalState> {
  if (native) return invoke("local_state");
  const raw = localStorage.getItem("navpdf-preferences");
  return {
    preferences: raw
      ? { ...defaultPreferences, ...JSON.parse(raw), networkAccess: false }
      : defaultPreferences,
    recents: [],
    recovery: null,
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
export async function openRecovery() {
  return invoke<DocumentDescriptor>("open_recovery");
}
export async function discardRecovery() {
  if (native) await invoke("discard_recovery");
}

export async function printDocument(bytes: Uint8Array<ArrayBuffer>, pages: number) {
  return invoke<boolean>("print_document", bytes, {
    headers: { "x-page-count": String(pages) },
  });
}

export interface SavedSignature {
  id: string;
  name: string;
  type: "signature" | "initials";
  dataUrl: string;
  createdAt: number;
  sessionOnly?: boolean;
}

export async function loadSignatures(): Promise<SavedSignature[]> {
  if (native) return invoke<SavedSignature[]>("load_signatures");
  try {
    const raw = localStorage.getItem("navpdf-signatures-store");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveSignature(
  name: string,
  type: "signature" | "initials",
  dataUrl: string,
): Promise<SavedSignature> {
  if (native) {
    return invoke<SavedSignature>("save_signature", {
      request: { name, type, dataUrl },
    });
  }
  const sig: SavedSignature = {
    id: crypto.randomUUID(),
    name,
    type,
    dataUrl,
    createdAt: Math.floor(Date.now() / 1000),
  };
  try {
    const current = await loadSignatures();
    const next = [sig, ...current];
    localStorage.setItem("navpdf-signatures-store", JSON.stringify(next));
  } catch {
    // ignore
  }
  return sig;
}

export async function deleteSignature(id: string): Promise<void> {
  if (native) {
    await invoke("delete_signature", { id });
    return;
  }
  try {
    const current = await loadSignatures();
    const next = current.filter((s) => s.id !== id);
    localStorage.setItem("navpdf-signatures-store", JSON.stringify(next));
  } catch {
    // ignore
  }
}

export async function migrateSignatures(
  items: SavedSignature[],
): Promise<SavedSignature[]> {
  if (native) return invoke<SavedSignature[]>("migrate_signatures", { items });
  try {
    const current = await loadSignatures();
    const next = [...items, ...current];
    localStorage.setItem("navpdf-signatures-store", JSON.stringify(next));
    return items;
  } catch {
    return items;
  }
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
    return invoke<OcrPageResult>("ocr_recognize_page", {
      imageBytes: Array.from(imageBytes),
      options,
    });
  }
  throw new Error("OCR requires the native macOS application.");
}

export async function ocrGetEngineInfo(): Promise<OcrEngineInfo> {
  if (native) return invoke<OcrEngineInfo>("ocr_get_engine_info");
  throw new Error("OCR requires the native macOS application.");
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DocumentDescriptor,
  LocalState,
  Preferences,
  SaveResult,
} from "../types/document";
import { defaultPreferences } from "../types/document";
import { downloadBytes, safeFileName } from "../utils/download";
export const native = isTauri();
const files = new Map<string, File>();
export async function openDocument(
  file?: File,
): Promise<DocumentDescriptor | null> {
  if (native) return invoke<DocumentDescriptor | null>("open_document");
  if (!file) return null;
  if (file.size > 1024 ** 3) throw new Error("Choose a PDF smaller than 1 GB.");
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

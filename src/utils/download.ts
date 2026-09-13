/**
 * Hand a generated file to the user as a download.
 *
 * Revoking the object URL synchronously after `click()` cancels the download
 * in WebKit, which is the engine the packaged app runs on. The URL is kept
 * alive long enough for the browser to start reading it, then released so the
 * blob does not leak for the life of the session.
 */
export const REVOKE_DELAY_MS = 30_000;

/** Strip directory separators so a generated name cannot escape its folder. */
export function safeFileName(name: string, fallback = "download"): string {
  const base = name.split(/[\\/]/).pop()?.replace(/^\.+/, "").trim() ?? "";
  return base || fallback;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFileName(fileName);
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** Convenience wrapper for the byte payloads the PDF pipeline produces. */
export function downloadBytes(
  bytes: Uint8Array,
  fileName: string,
  type = "application/pdf",
): void {
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type }), fileName);
}

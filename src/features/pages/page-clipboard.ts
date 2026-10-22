// Pages copied or cut in the page workspace, kept as a small PDF so they can be pasted into this
// or another open document. The clipboard lives in memory only: it is never written to disk,
// the system clipboard or the serializable workspace store.

export interface PageClipboard {
  bytes: Uint8Array;
  pages: number;
}

let clipboard: PageClipboard | null = null;

export function setPageClipboard(bytes: Uint8Array, pages: number) {
  if (!Number.isInteger(pages) || pages < 1) throw new Error("Choose pages to copy.");
  clipboard = { bytes, pages };
}

export function getPageClipboard(): PageClipboard | null {
  return clipboard;
}

export function clearPageClipboard() {
  clipboard = null;
}

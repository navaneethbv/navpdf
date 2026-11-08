// An image copied or cut in Edit Existing Content, kept as a one-page PDF holding only it, so it
// can be pasted into this or another open document. It lives in memory only.

let clip: { bytes: Uint8Array; source: string } | null = null;
const pastes = new Map<string, number>();

/** Keep a copied image; `documentId` and `page` say where it was copied from. */
export function setImageClipboard(bytes: Uint8Array, documentId: string, page: number) {
  clip = { bytes, source: `${documentId}:${page}` };
  pastes.clear();
}

export function getImageClipboard() {
  return clip?.bytes ?? null;
}

/**
 * The offset for the next paste on a page: the image's own place on another page, and 18 points
 * further down and to the right for each copy already pasted, or on the page it came from.
 */
export function nextImagePasteOffset(documentId: string, page: number) {
  const key = `${documentId}:${page}`;
  const count = pastes.get(key) ?? (clip?.source === key ? 1 : 0);
  pastes.set(key, count + 1);
  return 18 * count;
}

export function clearImageClipboard() {
  clip = null;
  pastes.clear();
}

// Comments copied in any tab, kept as a small PDF so they can be pasted into this or another open
// document. The copy lives in memory only. The system clipboard receives the comments' text, and
// a paste is taken as a comment paste only while that text is still what the clipboard holds.

import type { CommentClip } from "../../services/pdf/comment-batch";

interface StoredClip {
  clip: CommentClip;
  /** The text written to the system clipboard when the comments were copied. */
  marker: string;
  /** How many times the clip was pasted on each page, to step each paste further along. */
  pastes: Map<string, number>;
}

let stored: StoredClip | null = null;

/** The text placed on the system clipboard for copied comments: their text and a count. */
export function clipboardText(count: number, texts: string[]) {
  const label = `${count} comment${count === 1 ? "" : "s"} from NavPDF`;
  const text = texts
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n\n");
  return text ? `${text}\n\n(${label})` : `(${label})`;
}

/** Keep copied comments; `marker` is the text written to the system clipboard with them. */
export function setCommentClipboard(clip: CommentClip, marker: string) {
  stored = { clip, marker, pastes: new Map() };
}

export function getCommentClipboard(): CommentClip | null {
  return stored?.clip ?? null;
}

/**
 * Whether a paste with this system clipboard text should paste the copied comments. An
 * unreadable clipboard (null) counts as a match, since only NavPDF wrote to it then.
 */
export function pastesComments(systemText: string | null) {
  if (!stored) return false;
  return systemText === null || systemText === stored.marker;
}

/** The offset for the next paste on a page: 0, then 18 points further each time. */
export function nextPasteOffset(documentId: string, page: number) {
  if (!stored) return 0;
  const key = `${documentId}:${page}`;
  const count = stored.pastes.get(key) ?? 0;
  stored.pastes.set(key, count + 1);
  return count * 18;
}

export function clearCommentClipboard() {
  stored = null;
}

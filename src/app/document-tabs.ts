// Pure helpers for document tabs. The documents themselves are kept by the session hook.

import type { DocumentDescriptor } from "../types/document";
import { DOCUMENT_STATE_KEYS, type DocumentState, type DocumentTab } from "../stores/workspace";

/**
 * Puts a newly shown document in the tab list: in place of `previousId` when it replaced that
 * document, as in Revert, or at the end when it opened in a new tab.
 */
export function placeTab(
  tabs: DocumentTab[],
  previousId: string | null,
  descriptor: DocumentDescriptor,
  dirty = false,
): DocumentTab[] {
  const tab = { id: descriptor.id, name: descriptor.name, dirty };
  const index = tabs.findIndex((entry) => entry.id === previousId || entry.id === descriptor.id);
  if (index < 0) return [...tabs, tab];
  return tabs.map((entry, position) => (position === index ? tab : entry));
}

/** The tab to show after closing `id`: the one to its right, else the one to its left. */
export function neighborTab(tabs: DocumentTab[], id: string) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return null;
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
}

/** The tab `step` places after `id`, wrapping around. */
export function stepTab(tabs: DocumentTab[], id: string, step: number) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0 || tabs.length < 2) return null;
  return tabs[(index + step + tabs.length) % tabs.length].id;
}

/** The per-document part of the workspace, kept with a tab while another is shown. */
export function documentState(state: DocumentState): DocumentState {
  return Object.fromEntries(DOCUMENT_STATE_KEYS.map((key) => [key, state[key]])) as DocumentState;
}

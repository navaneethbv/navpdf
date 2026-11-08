import { savePreferences } from "../../services/native";
import { useWorkspace } from "../../stores/workspace";
import type { Preferences } from "../../types/document";

/** The most tools that can be pinned to the toolbar. */
export const MAX_PINNED_TOOLS = 12;

/** The pinned list with `id` added at the end or taken out. */
export function togglePinned(pinned: readonly string[], id: string): string[] {
  if (pinned.includes(id)) return pinned.filter((item) => item !== id);
  if (pinned.length >= MAX_PINNED_TOOLS)
    throw new Error(`Pin at most ${MAX_PINNED_TOOLS} tools. Unpin one first.`);
  return [...pinned, id];
}

/** The pinned list with `id` moved one place earlier (-1) or later (1). */
export function movePinned(pinned: readonly string[], id: string, step: -1 | 1): string[] {
  const index = pinned.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= pinned.length) return [...pinned];
  const next = [...pinned];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Saves a new pinned list with the other preferences. */
export async function savePinned(pinned: string[]) {
  const local = useWorkspace.getState().local;
  const preferences: Preferences = { ...local.preferences, pinnedTools: pinned };
  await savePreferences(preferences);
  useWorkspace.getState().set({ local: { ...useWorkspace.getState().local, preferences } });
}

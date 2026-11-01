import type { WorkspaceAPI } from "trimble-connect-workspace-api";
import { clearAnnotations, markupSignature, type OwnedMarkup } from "./annotations";

/** Storage keys for markups drawn by this extension, so a reload can remove what it left behind. */
export const SELECTION_MARKUPS = "soi.ownedMarkups";
export const PICK_MARKUPS = "soi.ownedPickMarkups";
export const SELECTION_LABELS = "soi.ownedSelectionLabels";
export const PICK_LABELS = "soi.ownedPickLabels";

export function saveOwned(key: string, owned: OwnedMarkup[]) {
  try {
    localStorage.setItem(key, JSON.stringify(owned));
  } catch {
    // Storage unavailable: leftovers after a reload then have to be removed by hand.
  }
}

function loadOwned(key: string): OwnedMarkup[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Removes markups a previous session of this extension drew. A markup is removed only if both its
 * id and its content still match, so user markups that reuse an id after a page reload are kept.
 */
export async function removeLeftovers(api: WorkspaceAPI, key: string): Promise<void> {
  const stored = loadOwned(key);
  if (!stored.length) return;
  const [texts, dims, lines] = await Promise.all([
    api.markup.getTextMarkups(),
    api.markup.getMeasurementMarkups(),
    api.markup.getLineMarkups(),
  ]);
  const live = new Map([...texts, ...dims, ...lines].map((m) => [m.id, markupSignature(m)]));
  const ids = stored.filter((o) => live.get(o.id) === o.signature).map((o) => o.id);
  await clearAnnotations(api, ids);
  saveOwned(key, []);
}

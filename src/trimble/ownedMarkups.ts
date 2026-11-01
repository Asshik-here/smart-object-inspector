import { useEffect, useState } from "react";
import type { WorkspaceAPI } from "trimble-connect-workspace-api";
import { addWorkspaceEventHandler } from "./connection";
import { clearAnnotations, markupSignature, type OwnedMarkup } from "./markups";

/** Storage keys for markups drawn by this extension, so a reload can remove what it left behind. */
export const SELECTION_MARKUPS = "soi.ownedMarkups";
export const PICK_MARKUPS = "soi.ownedPickMarkups";
export const SELECTION_LABELS = "soi.ownedSelectionLabels";
export const PICK_LABELS = "soi.ownedPickLabels";

function saveOwned(key: string, owned: OwnedMarkup[]) {
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
async function removeLeftovers(api: WorkspaceAPI, key: string): Promise<void> {
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

/**
 * Markups this extension owns under one storage key. Work is serialized: each `replace` removes the
 * layer's previous markups and then draws the new ones, so fast updates never interleave, and the
 * ids are remembered so a later session can remove what a closed one left behind.
 */
export class MarkupLayer {
  private ids: number[] = [];
  private queue: Promise<unknown>;

  constructor(
    readonly api: WorkspaceAPI,
    private readonly key: string,
  ) {
    this.queue = removeLeftovers(api, key).catch((err) =>
      console.warn("[SmartObjectInspector] leftover cleanup failed", err),
    );
  }

  /** After earlier work: removes this layer's markups, then runs `draw`, which adds and returns new ones. */
  replace<T extends { owned: OwnedMarkup[] }>(draw: () => Promise<T | null>): Promise<T | null> {
    const run = this.queue.then(async () => {
      const previous = this.ids;
      this.ids = [];
      await clearAnnotations(this.api, previous);
      saveOwned(this.key, []);
      const result = await draw();
      if (result) {
        this.ids = result.owned.map((o) => o.id);
        saveOwned(this.key, result.owned);
      }
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  clear(): Promise<unknown> {
    return this.replace(async () => null).catch(() => undefined);
  }
}

/** A markup layer for the component's lifetime; cleared when the extension closes or unmounts. */
export function useMarkupLayer(api: WorkspaceAPI | null, key: string): MarkupLayer | null {
  const [layer, setLayer] = useState<MarkupLayer | null>(null);
  useEffect(() => {
    if (!api) return;
    const created = new MarkupLayer(api, key);
    setLayer(created);
    const unsubscribe = addWorkspaceEventHandler((event) => {
      if (event === "extension.closing") created.clear();
    });
    return () => {
      unsubscribe();
      created.clear();
      setLayer(null);
    };
  }, [api, key]);
  return layer;
}

import type {
  Box3,
  File as ModelFile,
  ModelObjectIds,
  ObjectProperties,
  WorkspaceAPI,
} from "trimble-connect-workspace-api";
import { addWorkspaceEventHandler } from "./connection";

/** Everything the extension reads about one model object. */
export interface ObjectData {
  runtimeId: number;
  props?: ObjectProperties;
  box?: Box3;
  /** IFC GlobalId; absent for non-IFC models. */
  guid?: string;
}

type Kind = "props" | "box" | "guid";

/**
 * Cached, batched access to per-object viewer data. Every viewer call crosses the iframe boundary,
 * and several features (annotations, picking, the inspector) need the same objects; each object is
 * fetched once per kind, and objects missing from the cache are requested in one call per model.
 * Concurrent requests share the in-flight call. Cleared when models are loaded, unloaded or reset.
 */
export class ObjectDataCache {
  private entries = new Map<string, Promise<unknown>>();
  private models = new Map<string, Promise<ModelFile | undefined>>();

  constructor(private readonly api: WorkspaceAPI) {}

  clear() {
    this.entries.clear();
    this.models.clear();
  }

  /** Data for the given objects of one model. `guid` is only fetched when asked for. */
  async get(modelId: string, ids: number[], kinds: Kind[] = ["props", "box"]): Promise<ObjectData[]> {
    const [props, boxes, guids] = await Promise.all([
      kinds.includes("props") ? this.fetch("props", modelId, ids) : undefined,
      kinds.includes("box") ? this.fetch("box", modelId, ids) : undefined,
      kinds.includes("guid") ? this.fetch("guid", modelId, ids) : undefined,
    ]);
    return ids.map((runtimeId, i) => ({
      runtimeId,
      props: props?.[i] as ObjectProperties | undefined,
      box: boxes?.[i] as Box3 | undefined,
      guid: guids?.[i] as string | undefined,
    }));
  }

  /** The loaded model's file (name, type), cached per model. */
  loadedModel(modelId: string): Promise<ModelFile | undefined> {
    let model = this.models.get(modelId);
    if (!model) {
      model = this.api.viewer.getLoadedModel(modelId).catch((err) => {
        this.models.delete(modelId);
        throw err;
      });
      this.models.set(modelId, model);
    }
    return model;
  }

  private fetch(kind: Kind, modelId: string, ids: number[]): Promise<unknown[]> {
    const key = (id: number) => `${kind}|${modelId}|${id}`;
    const missing = [...new Set(ids.filter((id) => !this.entries.has(key(id))))];
    if (missing.length) {
      const batch = this.request(kind, modelId, missing);
      for (const id of missing) {
        const entry = batch.then((byId) => byId.get(id));
        this.entries.set(key(id), entry);
        // A failed request isn't cached, so the next selection retries it.
        entry.catch(() => this.entries.delete(key(id)));
      }
    }
    return Promise.all(ids.map((id) => this.entries.get(key(id))));
  }

  private async request(kind: Kind, modelId: string, ids: number[]): Promise<Map<number, unknown>> {
    const { viewer } = this.api;
    if (kind === "props") {
      const list = await viewer.getObjectProperties(modelId, ids);
      return new Map(list.map((p) => [p.id, p]));
    }
    if (kind === "box") {
      const list = await viewer.getObjectBoundingBoxes(modelId, ids);
      return new Map(list.map((b) => [b.id, b.boundingBox]));
    }
    try {
      const external = await viewer.convertToObjectIds(modelId, ids);
      return new Map(ids.map((id, i) => [id, external[i] ?? undefined]));
    } catch {
      // Non-IFC models have no external ids; the call throws instead of returning blanks.
      return new Map();
    }
  }
}

export interface ModelObjectData extends ObjectData {
  modelId: string;
}

/**
 * Data for up to `limit` objects of a selection, all models fetched in parallel. `truncated` tells
 * whether objects beyond the limit were left out.
 */
export async function selectionData(
  api: WorkspaceAPI,
  selection: ModelObjectIds[],
  limit: number,
  kinds?: Kind[],
): Promise<{ objects: ModelObjectData[]; truncated: boolean }> {
  let remaining = limit;
  let truncated = false;
  const batches: { modelId: string; ids: number[] }[] = [];
  for (const entry of selection) {
    const ids = entry.objectRuntimeIds ?? [];
    const take = ids.slice(0, Math.max(0, remaining));
    truncated ||= take.length < ids.length;
    remaining -= take.length;
    if (take.length) batches.push({ modelId: entry.modelId, ids: take });
  }
  const cache = objectData(api);
  const results = await Promise.all(batches.map((b) => cache.get(b.modelId, b.ids, kinds)));
  const objects = results.flatMap((list, i) => list.map((o) => ({ ...o, modelId: batches[i].modelId })));
  return { objects, truncated };
}

const caches = new WeakMap<WorkspaceAPI, ObjectDataCache>();

/** The shared cache for a connection, cleared automatically when the loaded models change. */
export function objectData(api: WorkspaceAPI): ObjectDataCache {
  let cache = caches.get(api);
  if (!cache) {
    const created = new ObjectDataCache(api);
    addWorkspaceEventHandler((event) => {
      if (event === "viewer.onModelStateChanged" || event === "viewer.onModelReset") created.clear();
    });
    caches.set(api, created);
    cache = created;
  }
  return cache;
}

import { useEffect } from "react";
import type { HierarchyType, ModelObjectIds, WorkspaceAPI } from "trimble-connect-workspace-api";
import { addWorkspaceEventHandler } from "./connection";
import { selectionKey } from "./useWorkspace";

/** HierarchyType is a non-const enum in the typings but isn't exported at runtime; use its values. */
const HIERARCHIES: [string, HierarchyType][] = [
  ["SpatialHierarchy", 1 as HierarchyType],
  ["Containment", 3 as HierarchyType],
  ["ElementAssembly", 4 as HierarchyType],
  ["Group", 5 as HierarchyType],
];

function post(name: string, data: unknown) {
  fetch(`/__debug/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  }).catch(() => undefined);
}

async function settle<T>(promise: Promise<T>): Promise<T | { error: string }> {
  try {
    return await promise;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function collect(api: WorkspaceAPI, selection: ModelObjectIds[]) {
  const models = [];
  for (const entry of selection) {
    const ids = (entry.objectRuntimeIds ?? []).slice(0, 20);
    if (!ids.length) continue;
    const hierarchy: Record<string, unknown> = {};
    for (const [name, type] of HIERARCHIES) {
      hierarchy[`${name}.children`] = await settle(api.viewer.getHierarchyChildren(entry.modelId, ids, type, false));
      hierarchy[`${name}.parents`] = await settle(api.viewer.getHierarchyParents(entry.modelId, ids, type, false));
    }
    models.push({
      modelId: entry.modelId,
      runtimeIds: ids,
      properties: await settle(api.viewer.getObjectProperties(entry.modelId, ids)),
      boundingBoxes: await settle(api.viewer.getObjectBoundingBoxes(entry.modelId, ids)),
      externalIds: await settle(api.viewer.convertToObjectIds(entry.modelId, ids)),
      hierarchy,
    });
  }
  return { time: new Date().toISOString(), selection, models };
}

/**
 * Development aid: writes the raw API data for each selection, and every pick event, to
 * ./debug/*.json through the local dev server. Disabled in production builds.
 */
type Collected = Awaited<ReturnType<typeof collect>>;

const toJson = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);

/** Prints every selected object's full getObjectProperties response as formatted JSON. */
function printToConsole(data: Collected) {
  const objects = data.models.flatMap((m) => (Array.isArray(m.properties) ? m.properties : []));
  console.groupCollapsed(`[SOI] Selection: ${objects.length} object(s) — expand to see the JSON`);
  for (const o of objects) {
    console.log(`%c${o.product?.name ?? o.class ?? "Object"} (runtime id ${o.id})`, "font-weight:bold");
    console.log(toJson(o));
  }
  console.groupEnd();
}

declare global {
  interface Window {
    /** Console helpers for development: `soi.show()` prints the current selection again. */
    soi?: {
      api: WorkspaceAPI;
      last: Collected | null;
      show: () => Promise<void>;
      /** Last selection as a JSON string: properties only, or everything with `json(true)`. */
      json: (full?: boolean) => string;
    };
  }
}

export function useDebugDump(api: WorkspaceAPI | null, selection: ModelObjectIds[]) {
  const key = selectionKey(selection);

  // Console helper: in the extension's console context, run `soi.show()` or use `soi.api` directly.
  useEffect(() => {
    if (!import.meta.env.DEV || !api) return;
    const helper = {
      api,
      last: null as Collected | null,
      show: async () => {
        const current = await api.viewer.getSelection();
        const data = await collect(api, current);
        helper.last = data;
        printToConsole(data);
      },
      json: (full = false) => {
        const data = window.soi?.last ?? null;
        if (!data) return "No selection yet";
        return toJson(full ? data : data.models.flatMap((m) => (Array.isArray(m.properties) ? m.properties : [])));
      },
    };
    window.soi = helper;
    return () => {
      delete window.soi;
    };
  }, [api]);

  useEffect(() => {
    if (!import.meta.env.DEV || !api || !key) return;
    let cancelled = false;
    collect(api, selection).then((data) => {
      if (cancelled) return;
      post("selection", data);
      if (window.soi) window.soi.last = data;
      printToConsole(data);
    });
    return () => {
      cancelled = true;
    };
    // `key` captures the identity of `selection`.
  }, [api, key]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const picks: unknown[] = [];
    return addWorkspaceEventHandler((event, payload) => {
      if (event !== "viewer.onPicked" && event !== "viewer.onToolChanged") return;
      picks.push({ time: new Date().toISOString(), event, data: payload?.data });
      post("picks", picks.slice(-50));
    });
  }, []);

  // Camera events plus a getCamera() snapshot, to check how the viewer reports its orientation.
  useEffect(() => {
    if (!import.meta.env.DEV || !api) return;
    const events: unknown[] = [];
    let count = 0;
    let timer: number | undefined;
    const flush = () =>
      api.viewer
        .getCamera()
        .then((snapshot) => post("camera", { eventsReceived: count, getCamera: snapshot, lastEvents: events }))
        .catch((err) => post("camera", { eventsReceived: count, getCameraError: String(err), lastEvents: events }));
    flush();
    const unsubscribe = addWorkspaceEventHandler((event, payload) => {
      if (event !== "viewer.onCameraChanged") return;
      count++;
      events.push({ time: new Date().toISOString(), data: payload?.data });
      if (events.length > 5) events.shift();
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 400);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [api]);
}

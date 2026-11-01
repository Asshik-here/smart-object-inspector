import { useEffect, useRef, useState } from "react";
import type { ModelObjectIds, ObjectProperties, WorkspaceAPI } from "trimble-connect-workspace-api";
import { objectData } from "./objectData";

/** What the panel shows about the first selected object. */
export interface ProbeResult {
  modelId: string;
  runtimeId: number;
  properties: ObjectProperties | null;
  externalId: string | null;
  fileName: string | null;
  fileType: string | null;
  errors: string[];
}

export interface ProbeState {
  loading: boolean;
  result: ProbeResult | null;
}

function firstObject(selection: ModelObjectIds[]): { modelId: string; runtimeId: number } | null {
  for (const entry of selection) {
    const runtimeId = entry.objectRuntimeIds?.[0];
    if (runtimeId !== undefined) return { modelId: entry.modelId, runtimeId };
  }
  return null;
}

const describe = (label: string, err: unknown) => `${label}: ${err instanceof Error ? err.message : String(err)}`;

/** Properties, IFC GUID and source file of the first selected object, via the shared object cache. */
export function useSelectionProbe(api: WorkspaceAPI | null, selection: ModelObjectIds[]): ProbeState {
  const [state, setState] = useState<ProbeState>({ loading: false, result: null });
  const requestId = useRef(0);
  const target = firstObject(selection);
  const key = target ? `${target.modelId}:${target.runtimeId}` : "";

  useEffect(() => {
    const id = ++requestId.current;
    if (!api || !target) {
      setState({ loading: false, result: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    const { modelId, runtimeId } = target;
    const cache = objectData(api);

    Promise.allSettled([cache.get(modelId, [runtimeId], ["props", "guid"]), cache.loadedModel(modelId)]).then(
      ([data, file]) => {
        // A newer selection superseded this request.
        if (id !== requestId.current) return;
        const object = data.status === "fulfilled" ? data.value[0] : undefined;
        const errors: string[] = [];
        if (data.status === "rejected") errors.push(describe("Object data", data.reason));
        if (file.status === "rejected") errors.push(describe("Model file", file.reason));
        setState({
          loading: false,
          result: {
            modelId,
            runtimeId,
            properties: object?.props ?? null,
            externalId: object?.guid ?? null,
            fileName: file.status === "fulfilled" ? file.value?.name ?? null : null,
            fileType: file.status === "fulfilled" ? file.value?.type ?? null : null,
            errors,
          },
        });
      },
    );
    // `key` captures the identity of `target`.
  }, [api, key]);

  return state;
}

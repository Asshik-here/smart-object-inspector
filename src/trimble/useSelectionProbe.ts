import { useEffect, useRef, useState } from "react";
import type { ModelObjectIds, ObjectProperties, WorkspaceAPI } from "trimble-connect-workspace-api";

/** Raw API responses for one object, kept unprocessed so the real structure can be inspected. */
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

/** Fetches properties, external ID and source file for the first selected object. */
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

    Promise.allSettled([
      api.viewer.getObjectProperties(modelId, [runtimeId]),
      api.viewer.convertToObjectIds(modelId, [runtimeId]),
      api.viewer.getLoadedModel(modelId),
    ]).then(([props, ids, file]) => {
      // A newer selection superseded this request.
      if (id !== requestId.current) return;
      const errors: string[] = [];
      if (props.status === "rejected") errors.push(describe("getObjectProperties", props.reason));
      if (ids.status === "rejected") errors.push(describe("convertToObjectIds", ids.reason));
      if (file.status === "rejected") errors.push(describe("getLoadedModel", file.reason));
      setState({
        loading: false,
        result: {
          modelId,
          runtimeId,
          properties: props.status === "fulfilled" ? props.value?.[0] ?? null : null,
          externalId: ids.status === "fulfilled" ? ids.value?.[0] ?? null : null,
          fileName: file.status === "fulfilled" ? file.value?.name ?? null : null,
          fileType: file.status === "fulfilled" ? file.value?.type ?? null : null,
          errors,
        },
      });
    });
    // `key` captures the identity of `target`.
  }, [api, key]);

  return state;
}

import { useEffect, useRef, useState } from "react";
import type { ModelObjectIds, WorkspaceAPI } from "trimble-connect-workspace-api";
import { drawAnnotations, type AnnotationOptions, type AnnotationResult, type IfcBarIndex } from "./annotations";
import { SELECTION_MARKUPS, useMarkupLayer } from "./ownedMarkups";
import { selectionKey } from "./useWorkspace";

const DEBOUNCE_MS = 200;
/** Circuit breaker: more redraws than this within the window means something is looping. */
const MAX_REDRAWS = 8;
const REDRAW_WINDOW_MS = 3000;

export interface AnnotationState {
  busy: boolean;
  error: string | null;
  result: AnnotationResult | null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Keeps 3D markups (dimensions + labels) in sync with the viewer selection while `enabled`. */
export function useAnnotations(
  api: WorkspaceAPI | null,
  selection: ModelObjectIds[],
  enabled: boolean,
  options: AnnotationOptions,
  ifc: IfcBarIndex | null,
): AnnotationState {
  const [state, setState] = useState<AnnotationState>({ busy: false, error: null, result: null });
  const layer = useMarkupLayer(api, SELECTION_MARKUPS);
  const generation = useRef(0);
  const redraws = useRef<number[]>([]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Redraw only when the selected IDs change, not when an identical selection is re-sent.
  const key = selectionKey(selection);

  useEffect(() => {
    if (!layer) return;
    const gen = ++generation.current;
    const current = selectionRef.current;
    const shouldDraw = enabled && key !== "";
    const isCurrent = () => gen === generation.current;

    const run = () => {
      if (shouldDraw) {
        const now = Date.now();
        redraws.current = [...redraws.current.filter((t) => now - t < REDRAW_WINDOW_MS), now];
        if (redraws.current.length > MAX_REDRAWS) {
          redraws.current = [];
          setState({ busy: false, error: "Redrawing stopped: the viewer kept re-triggering it. Reselect to retry.", result: null });
          return;
        }
      }
      layer
        // A newer selection makes this draw redundant: skip it and let the newer one draw.
        .replace(() => (shouldDraw && isCurrent() ? drawAnnotations(layer.api, current, options, ifc) : Promise.resolve(null)))
        .then((result) => {
          if (isCurrent()) setState({ busy: false, error: null, result });
        })
        .catch((err) => {
          if (isCurrent()) setState({ busy: false, error: errorText(err), result: null });
        });
    };

    setState((s) => ({ ...s, busy: shouldDraw }));
    const timer = window.setTimeout(run, shouldDraw ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
    // `options` is memoized by the caller, so it only changes when a setting changes.
  }, [layer, key, enabled, options, ifc]);

  return state;
}

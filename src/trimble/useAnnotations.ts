import { useEffect, useRef, useState } from "react";
import type { ModelObjectIds, WorkspaceAPI } from "trimble-connect-workspace-api";
import {
  clearAnnotations,
  drawAnnotations,
  type AnnotationOptions,
  type AnnotationResult,
  type IfcBarIndex,
} from "./annotations";
import { addWorkspaceEventHandler } from "./connection";
import { removeLeftovers, saveOwned, SELECTION_MARKUPS } from "./ownedMarkups";
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

/**
 * Keeps 3D markups (dimensions + labels) in sync with the viewer selection while `enabled`.
 * Markup operations are serialized so a fast selection change can't interleave remove/add calls.
 */
export function useAnnotations(
  api: WorkspaceAPI | null,
  selection: ModelObjectIds[],
  enabled: boolean,
  options: AnnotationOptions,
  ifc: IfcBarIndex | null,
): AnnotationState {
  const [state, setState] = useState<AnnotationState>({ busy: false, error: null, result: null });
  const ownedIds = useRef<number[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const redraws = useRef<number[]>([]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Redraw only when the selected IDs change, not when an identical selection is re-sent.
  const key = selectionKey(selection);

  // Runs before any drawing because it is the first task queued once the API is available.
  useEffect(() => {
    if (!api) return;
    queue.current = queue.current.then(() =>
      removeLeftovers(api, SELECTION_MARKUPS).catch((err) => console.warn("[SmartObjectInspector] leftover cleanup failed", err)),
    );
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const gen = ++generation.current;
    const current = selectionRef.current;
    const shouldDraw = enabled && key !== "";

    const run = () => {
      if (shouldDraw) {
        const now = Date.now();
        redraws.current = [...redraws.current.filter((t) => now - t < REDRAW_WINDOW_MS), now];
        if (redraws.current.length > MAX_REDRAWS) {
          setState({ busy: false, error: "Redrawing stopped: the viewer kept re-triggering it. Reselect to retry.", result: null });
          redraws.current = [];
          return;
        }
      }
      queue.current = queue.current.then(async () => {
        const previous = ownedIds.current;
        ownedIds.current = [];
        try {
          await clearAnnotations(api, previous);
          saveOwned(SELECTION_MARKUPS, []);
          if (!shouldDraw || gen !== generation.current) {
            setState((s) => ({ ...s, busy: false, result: shouldDraw ? s.result : null }));
            return;
          }
          const result = await drawAnnotations(api, current, options, ifc);
          ownedIds.current = result.markupIds;
          saveOwned(SELECTION_MARKUPS, result.owned);
          // A newer selection arrived while drawing; its run will clear these markups.
          if (gen === generation.current) setState({ busy: false, error: null, result });
        } catch (err) {
          if (gen === generation.current) {
            setState({ busy: false, error: err instanceof Error ? err.message : String(err), result: null });
          }
        }
      });
    };

    setState((s) => ({ ...s, busy: shouldDraw }));
    const timer = window.setTimeout(run, shouldDraw ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
    // `options` is memoized by the caller, so it only changes when a setting changes.
  }, [api, key, enabled, options, ifc]);

  // Remove our markups when the extension closes or the component unmounts.
  useEffect(() => {
    if (!api) return;
    const cleanup = () => {
      const ids = ownedIds.current;
      ownedIds.current = [];
      clearAnnotations(api, ids)
        .then(() => saveOwned(SELECTION_MARKUPS, []))
        .catch(() => undefined);
    };
    const unsubscribe = addWorkspaceEventHandler((event) => {
      if (event === "extension.closing") cleanup();
    });
    return () => {
      unsubscribe();
      cleanup();
    };
  }, [api]);

  return state;
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelObjectIds, PointPickedDetail, WorkspaceAPI } from "trimble-connect-workspace-api";
import { addWorkspaceEventHandler } from "./connection";
import { PICK_MARKUPS, useMarkupLayer } from "./ownedMarkups";
import { drawPickedChain, type PickedChainOptions, type PickedChainResult, type PickedPoint } from "./pickedChain";

const REDRAW_DEBOUNCE_MS = 150;

export interface PickChainState {
  active: boolean;
  picks: PickedPoint[];
  result: PickedChainResult | null;
  error: string | null;
  roundTo: number;
  start: () => void;
  finish: () => void;
  undo: () => void;
  clear: () => void;
  setRoundTo: (mm: number) => void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * "Dimension by picking": activates the viewer's documented `picking` tool, collects one
 * `viewer.onPicked` point per bar, and keeps a dimension chain through those points up to date.
 */
export function usePickChain(
  api: WorkspaceAPI | null,
  selection: ModelObjectIds[],
  drawing: Omit<PickedChainOptions, "roundTo">,
): PickChainState {
  const { labelTemplate, style, valueText } = drawing;
  const [active, setActive] = useState(false);
  const [picks, setPicks] = useState<PickedPoint[]>([]);
  const [result, setResult] = useState<PickedChainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Picks land on the bar surface, up to a bar radius (~5 mm) off-centre; 10 mm rounding absorbs that.
  const [roundTo, setRoundTo] = useState(10);
  const activeRef = useRef(false);
  const layer = useMarkupLayer(api, PICK_MARKUPS);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Collect picks while the tool is active; stop if the user switches to another tool.
  useEffect(() => {
    return addWorkspaceEventHandler((event, payload) => {
      if (!activeRef.current) return;
      if (event === "viewer.onToolChanged") {
        const next = (payload?.data as { new?: string } | undefined)?.new;
        if (next && next !== "picking") {
          activeRef.current = false;
          setActive(false);
        }
        return;
      }
      if (event !== "viewer.onPicked") return;
      const detail = payload?.data as PointPickedDetail | undefined;
      if (!detail?.position || detail.objectRuntimeId === undefined) return;
      setPicks((prev) => {
        const last = prev[prev.length - 1];
        // The same click can be reported twice; ignore an identical repeat.
        if (
          last &&
          last.objectRuntimeId === detail.objectRuntimeId &&
          Math.abs(last.position.x - detail.position.x) < 1e-6 &&
          Math.abs(last.position.y - detail.position.y) < 1e-6
        ) {
          return prev;
        }
        return [...prev, { position: detail.position, modelId: detail.modelId, objectRuntimeId: detail.objectRuntimeId }];
      });
    });
  }, []);

  // Redraw the chain whenever the picks or settings change.
  useEffect(() => {
    if (!layer) return;
    const timer = window.setTimeout(() => {
      const options = { roundTo, labelTemplate, style, valueText };
      layer
        .replace(() => (picks.length < 2 ? Promise.resolve(null) : drawPickedChain(layer.api, picks, selectionRef.current, options)))
        .then((drawn) => {
          setResult(drawn);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    }, REDRAW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [layer, picks, roundTo, labelTemplate, style, valueText]);

  const start = useCallback(() => {
    if (!api) return;
    setPicks([]);
    setError(null);
    activeRef.current = true;
    setActive(true);
    api.viewer
      .activateTool("picking", {
        instruction: {
          title: "Dimension by picking",
          text: "Click each bar once, in any order. Press Finish in Smart Object Inspector when done.",
        },
      })
      .catch((err) => {
        activeRef.current = false;
        setActive(false);
        setError(`Could not start the picking tool: ${errorText(err)}`);
      });
  }, [api]);

  const finish = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    api?.viewer.activateTool("reset").catch(() => undefined);
  }, [api]);

  const undo = useCallback(() => setPicks((prev) => prev.slice(0, -1)), []);

  const clear = useCallback(() => {
    finish();
    setPicks([]);
  }, [finish]);

  // Don't leave the viewer in picking mode when the extension closes (the layer removes the markups).
  useEffect(() => {
    if (!api) return;
    const cleanup = () => {
      if (activeRef.current) api.viewer.activateTool("reset").catch(() => undefined);
    };
    const unsubscribe = addWorkspaceEventHandler((event) => {
      if (event === "extension.closing") cleanup();
    });
    return () => {
      unsubscribe();
      cleanup();
    };
  }, [api]);

  return { active, picks, result, error, roundTo, start, finish, undo, clear, setRoundTo };
}

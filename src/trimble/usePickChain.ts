import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelObjectIds, PointPickedDetail, WorkspaceAPI } from "trimble-connect-workspace-api";
import {
  clearAnnotations,
  drawPickedChain,
  type DimensionStyle,
  type ValueText,
  type PickedChainResult,
  type PickedPoint,
} from "./annotations";
import { addWorkspaceEventHandler } from "./connection";
import { PICK_MARKUPS, removeLeftovers, saveOwned } from "./ownedMarkups";

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
  labelTemplate: string,
  style: DimensionStyle,
  valueText: ValueText,
): PickChainState {
  const [active, setActive] = useState(false);
  const [picks, setPicks] = useState<PickedPoint[]>([]);
  const [result, setResult] = useState<PickedChainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Picks land on the bar surface, up to a bar radius (~5 mm) off-centre; 10 mm rounding absorbs that.
  const [roundTo, setRoundTo] = useState(10);
  const activeRef = useRef(false);
  const ownedIds = useRef<number[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    if (!api) return;
    queue.current = queue.current.then(() => removeLeftovers(api, PICK_MARKUPS).catch(() => undefined));
  }, [api]);

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

  // Redraw the chain whenever the picks or rounding change.
  useEffect(() => {
    if (!api) return;
    const timer = window.setTimeout(() => {
      queue.current = queue.current.then(async () => {
        const previous = ownedIds.current;
        ownedIds.current = [];
        try {
          await clearAnnotations(api, previous);
          saveOwned(PICK_MARKUPS, []);
          if (picks.length < 2) {
            setResult(null);
            return;
          }
          const drawn = await drawPickedChain(api, picks, selectionRef.current, roundTo, labelTemplate, style, valueText);
          ownedIds.current = drawn.owned.map((o) => o.id);
          saveOwned(PICK_MARKUPS, drawn.owned);
          setResult(drawn);
          setError(null);
        } catch (err) {
          setError(errorText(err));
        }
      });
    }, REDRAW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [api, picks, roundTo, labelTemplate, style, valueText]);

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

  // Leave the viewer tidy when the extension closes.
  useEffect(() => {
    if (!api) return;
    const cleanup = () => {
      if (activeRef.current) api.viewer.activateTool("reset").catch(() => undefined);
      const ids = ownedIds.current;
      ownedIds.current = [];
      clearAnnotations(api, ids)
        .then(() => saveOwned(PICK_MARKUPS, []))
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

  return { active, picks, result, error, roundTo, start, finish, undo, clear, setRoundTo };
}

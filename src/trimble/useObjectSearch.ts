import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelObjectIds, ModelSpec, WorkspaceAPI } from "trimble-connect-workspace-api";
import { MAX_ANNOTATED_OBJECTS } from "./annotations";
import { buildSearchIndex, entryKey, rebarByCastUnit, searchEntries, type SearchEntry } from "./objectSearch";

const NO_ENTRIES: SearchEntry[] = [];

export interface ObjectSearchState {
  query: string;
  setQuery: (query: string) => void;
  results: SearchEntry[];
  /** All matches, including those beyond the shown results. */
  total: number;
  /** Index progress while the model is being read; null when ready or not started. */
  progress: { done: number; total: number } | null;
  ready: boolean;
  error: string | null;
  /** Starts reading the model; called on first focus so opening the panel costs nothing. */
  prepare: () => void;
  /** Objects ticked in the search: these, and only these, get dimensions in 3D. */
  checked: Map<string, SearchEntry>;
  /** The ticked objects as a viewer selection (stable while the ticks don't change). */
  selection: ModelObjectIds[];
  toggle: (entry: SearchEntry) => void;
  /** How many matches of the current search are ticked. */
  checkedMatches: number;
  /** Ticks every match of the current search (up to the annotation limit). */
  checkAllMatches: () => void;
  /** Unticks every match of the current search; ticks from earlier searches stay. */
  uncheckAllMatches: () => void;
  /** All reinforcing bar groups of a cast unit (the whole mesh), from the full index. */
  unitBars: (castUnit: string) => SearchEntry[];
  /** Ticks every bar group of the cast unit, or unticks them if they are all ticked already. */
  toggleUnit: (castUnit: string) => void;
  clear: () => void;
}

function toSelection(entries: Iterable<SearchEntry>): ModelObjectIds[] {
  const byModel = new Map<string, number[]>();
  for (const e of entries) byModel.set(e.modelId, [...(byModel.get(e.modelId) ?? []), e.runtimeId]);
  return [...byModel].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds }));
}

/**
 * Search the loaded models by name, bar mark, cast unit or any property, and tick objects to
 * dimension them. Ticked objects are also selected (highlighted) in the viewer and framed by the camera.
 */
export function useObjectSearch(api: WorkspaceAPI | null, models: ModelSpec[]): ObjectSearchState {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wanted, setWanted] = useState(false);
  const [checked, setChecked] = useState<Map<string, SearchEntry>>(() => new Map());
  const run = useRef(0);
  const highlighted = useRef<ModelObjectIds[]>([]);
  const highlightQueue = useRef<Promise<unknown>>(Promise.resolve());
  // The index (and the ticks, which refer to it) are reset when the set of loaded models changes.
  const modelsKey = models.map((m) => `${m.id}:${m.versionId}`).sort().join(",");

  useEffect(() => {
    setEntries(null);
    setProgress(null);
    setChecked(new Map());
  }, [modelsKey]);

  useEffect(() => {
    if (!api || !wanted || entries) return;
    const id = ++run.current;
    const cancelled = () => id !== run.current;
    setError(null);
    buildSearchIndex(api, (done, total) => !cancelled() && setProgress({ done, total }), cancelled)
      .then((built) => {
        if (cancelled()) return;
        setEntries(built);
        setProgress(null);
      })
      .catch((err) => {
        if (cancelled()) return;
        setProgress(null);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      run.current++;
    };
  }, [api, wanted, entries, modelsKey]);

  const { results, matches, total } = useMemo(() => searchEntries(entries ?? [], query), [entries, query]);
  const selection = useMemo(() => toSelection(checked.values()), [checked]);

  // Mirror the ticks in the viewer: highlight exactly the ticked objects and frame them. Only objects
  // this panel highlighted are deselected, so nothing else the user selected is touched.
  useEffect(() => {
    if (!api) return;
    const previous = highlighted.current;
    highlighted.current = selection;
    const viewer = api.viewer;
    // Serialized, so ticking quickly can't interleave remove/add calls.
    highlightQueue.current = highlightQueue.current
      .then(async () => {
        if (previous.length) await viewer.setSelection({ modelObjectIds: previous }, "remove");
        if (!selection.length) return;
        await viewer.setSelection({ modelObjectIds: selection }, "add");
        await viewer.setCamera({ modelObjectIds: selection }, { animationTime: 400 });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [api, selection]);

  const toggle = useCallback((entry: SearchEntry) => {
    setChecked((prev) => {
      const next = new Map(prev);
      if (next.has(entryKey(entry))) next.delete(entryKey(entry));
      else next.set(entryKey(entry), entry);
      return next;
    });
  }, []);

  const checkAllMatches = useCallback(() => {
    setChecked((prev) => {
      const next = new Map(prev);
      for (const e of matches) {
        if (next.size >= MAX_ANNOTATED_OBJECTS) break;
        next.set(entryKey(e), e);
      }
      return next;
    });
  }, [matches]);

  const uncheckAllMatches = useCallback(() => {
    setChecked((prev) => {
      const next = new Map(prev);
      for (const e of matches) next.delete(entryKey(e));
      return next;
    });
  }, [matches]);

  const checkedMatches = useMemo(() => matches.filter((e) => checked.has(entryKey(e))).length, [matches, checked]);

  const units = useMemo(() => rebarByCastUnit(entries ?? []), [entries]);
  const unitBars = useCallback((castUnit: string) => units.get(castUnit) ?? NO_ENTRIES, [units]);

  const toggleUnit = useCallback(
    (castUnit: string) => {
      const members = units.get(castUnit) ?? NO_ENTRIES;
      setChecked((prev) => {
        const next = new Map(prev);
        const all = members.length > 0 && members.every((e) => next.has(entryKey(e)));
        for (const e of members) {
          if (all) next.delete(entryKey(e));
          else if (next.size < MAX_ANNOTATED_OBJECTS) next.set(entryKey(e), e);
        }
        return next;
      });
    },
    [units],
  );

  const clear = useCallback(() => setChecked(new Map()), []);
  const prepare = useCallback(() => setWanted(true), []);

  return {
    query,
    setQuery,
    results,
    total,
    progress,
    ready: !!entries,
    error,
    prepare,
    checked,
    selection,
    toggle,
    checkedMatches,
    checkAllMatches,
    uncheckAllMatches,
    unitBars,
    toggleUnit,
    clear,
  };
}

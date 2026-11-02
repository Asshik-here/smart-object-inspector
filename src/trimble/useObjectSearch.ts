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
  /** Keys of the selected objects. The viewer's selection is the source of truth, so objects
   *  selected by clicking in 3D show as ticked here too. */
  checked: Set<string>;
  toggle: (entry: SearchEntry) => void;
  /** How many matches of the current search are selected. */
  checkedMatches: number;
  /** Selects every match of the current search (up to the annotation limit). */
  checkAllMatches: () => void;
  /** Deselects every match of the current search; other selected objects stay. */
  uncheckAllMatches: () => void;
  /** All reinforcing bar groups of a cast unit (the whole mesh), from the full index. */
  unitBars: (castUnit: string) => SearchEntry[];
  /** Selects every bar group of the cast unit, or deselects them if they are all selected already. */
  toggleUnit: (castUnit: string) => void;
  /** Deselects everything. */
  clear: () => void;
}

function toSelection(entries: Iterable<{ modelId: string; runtimeId: number }>): ModelObjectIds[] {
  const byModel = new Map<string, number[]>();
  for (const e of entries) byModel.set(e.modelId, [...(byModel.get(e.modelId) ?? []), e.runtimeId]);
  return [...byModel].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds }));
}

/** Keys of the objects in a viewer selection. */
function selectionKeys(selection: ModelObjectIds[]): Set<string> {
  const keys = new Set<string>();
  for (const m of selection) for (const id of m.objectRuntimeIds ?? []) keys.add(entryKey({ modelId: m.modelId, runtimeId: id }));
  return keys;
}

/**
 * Search the loaded models by name, bar mark, cast unit or any property, and select the results.
 * Ticking a result changes the viewer's selection (and frames what was added); clicking objects in
 * 3D shows up as ticks here, because both are the same selection.
 */
export function useObjectSearch(
  api: WorkspaceAPI | null,
  models: ModelSpec[],
  viewerSelection: ModelObjectIds[],
  /** Re-reads the viewer selection after a change, in case the viewer doesn't report it. */
  refreshSelection: () => Promise<void>,
): ObjectSearchState {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wanted, setWanted] = useState(false);
  const run = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The index is rebuilt when the set of loaded models changes.
  const modelsKey = models.map((m) => `${m.id}:${m.versionId}`).sort().join(",");

  useEffect(() => {
    setEntries(null);
    setProgress(null);
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
  const checked = useMemo(() => selectionKeys(viewerSelection), [viewerSelection]);
  const checkedRef = useRef(checked);
  checkedRef.current = checked;

  /**
   * Adds objects to / removes them from the viewer's selection, serialized so quick clicks can't
   * interleave. Added objects are framed by the camera; the panel updates when the viewer reports
   * the new selection.
   */
  const change = useCallback(
    (add: SearchEntry[], remove: SearchEntry[]) => {
      if (!api || (!add.length && !remove.length)) return;
      const viewer = api.viewer;
      queue.current = queue.current
        .then(async () => {
          if (remove.length) await viewer.setSelection({ modelObjectIds: toSelection(remove) }, "remove");
          if (add.length) await viewer.setSelection({ modelObjectIds: toSelection(add) }, "add");
          await refreshSelection();
          if (add.length) await viewer.setCamera({ modelObjectIds: toSelection(add) }, { animationTime: 400 });
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
    [api, refreshSelection],
  );

  /** Not-yet-selected entries, capped so the selection stays within the annotation limit. */
  const addable = (list: SearchEntry[]) => {
    const room = Math.max(0, MAX_ANNOTATED_OBJECTS - checkedRef.current.size);
    return list.filter((e) => !checkedRef.current.has(entryKey(e))).slice(0, room);
  };
  const selectedOf = (list: SearchEntry[]) => list.filter((e) => checkedRef.current.has(entryKey(e)));

  const toggle = useCallback(
    (entry: SearchEntry) =>
      checkedRef.current.has(entryKey(entry)) ? change([], [entry]) : change(addable([entry]), []),
    // `addable` only reads the ref.
    [change],
  );

  const checkAllMatches = useCallback(() => change(addable(matches), []), [change, matches]);
  const uncheckAllMatches = useCallback(() => change([], selectedOf(matches)), [change, matches]);
  const checkedMatches = useMemo(() => matches.filter((e) => checked.has(entryKey(e))).length, [matches, checked]);

  const units = useMemo(() => rebarByCastUnit(entries ?? []), [entries]);
  const unitBars = useCallback((castUnit: string) => units.get(castUnit) ?? NO_ENTRIES, [units]);
  const toggleUnit = useCallback(
    (castUnit: string) => {
      const members = units.get(castUnit) ?? NO_ENTRIES;
      const all = members.length > 0 && members.every((e) => checkedRef.current.has(entryKey(e)));
      if (all) change([], members);
      else change(addable(members), []);
    },
    [change, units],
  );

  const clear = useCallback(() => {
    if (!api || !viewerSelection.length) return;
    const selector = { modelObjectIds: viewerSelection };
    queue.current = queue.current
      .then(() => api.viewer.setSelection(selector, "remove"))
      .then(refreshSelection)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [api, viewerSelection, refreshSelection]);

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
    toggle,
    checkedMatches,
    checkAllMatches,
    uncheckAllMatches,
    unitBars,
    toggleUnit,
    clear,
  };
}

import type { ObjectProperties, WorkspaceAPI } from "trimble-connect-workspace-api";
import { applyCentres, DEFAULT_TEMPLATE, renderLabelOrName } from "./labelTemplate";
import { objectData } from "./objectData";

/** One searchable model object. */
export interface SearchEntry {
  modelId: string;
  runtimeId: number;
  /** What the user sees: the bar label for rebar groups, otherwise the object's name. */
  title: string;
  /** Secondary line, e.g. the IFC class and cast unit. */
  subtitle: string;
  /** Lower-cased text of every property value, for matching. */
  text: string;
  /** Lower-cased short names (title, name, bar mark) that rank first when matched exactly. */
  keys: string[];
}

/** Objects are read in batches, so a large model doesn't hold up the viewer. */
const BATCH = 300;
const MAX_RESULTS = 50;

const propertyValue = (props: ObjectProperties | undefined, name: RegExp): string => {
  for (const set of props?.properties ?? []) {
    for (const p of set.properties ?? []) if (name.test(p.name) && p.value !== "") return String(p.value);
  }
  return "";
};

/** Readable names for common IFC classes; others are shown without the IFC prefix. */
const CLASS_NAMES: Record<string, string> = {
  IFCREINFORCINGBAR: "Reinforcing bar",
  IFCREINFORCINGMESH: "Reinforcing mesh",
  IFCELEMENTASSEMBLY: "Assembly",
  IFCBEAM: "Beam",
  IFCCOLUMN: "Column",
  IFCSLAB: "Slab",
  IFCWALL: "Wall",
  IFCFOOTING: "Footing",
  IFCBUILDINGELEMENTPROXY: "Element",
};

const prettyClass = (cls: string | undefined) => {
  if (!cls) return "";
  const upper = cls.toUpperCase();
  return CLASS_NAMES[upper] ?? upper.replace(/^IFC/, "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
};

/** A searchable entry for one object's properties. */
export function toEntry(modelId: string, runtimeId: number, props: ObjectProperties | undefined): SearchEntry {
  const name = props?.product?.name ?? "";
  const mark = propertyValue(props, /barmark|bar mark/i);
  const castUnit = propertyValue(props, /cast unit mark/i);
  const title = applyCentres(renderLabelOrName(DEFAULT_TEMPLATE, props), null) || name || `Object ${runtimeId}`;
  const subtitle = [prettyClass(props?.class), castUnit].filter(Boolean).join(" · ");
  const values = [
    title,
    name,
    props?.class ?? "",
    props?.product?.description ?? "",
    props?.product?.objectType ?? "",
    ...(props?.properties ?? []).flatMap((set) => (set.properties ?? []).map((p) => String(p.value ?? ""))),
  ];
  return {
    modelId,
    runtimeId,
    title,
    subtitle,
    text: values.join(" ").toLowerCase(),
    keys: [title, name, mark].filter(Boolean).map((k) => k.toLowerCase()),
  };
}

/**
 * Entries whose text contains every word of the query. Exact matches on the title, name or bar mark
 * come first, then titles starting with the query, then everything else in model order.
 */
export function searchEntries(
  entries: SearchEntry[],
  query: string,
  limit = MAX_RESULTS,
): { results: SearchEntry[]; matches: SearchEntry[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], matches: [], total: 0 };
  const words = q.split(/\s+/);
  const found = entries.filter((e) => words.every((w) => e.text.includes(w)));
  const rank = (e: SearchEntry) => (e.keys.includes(q) ? 0 : e.keys.some((k) => k.startsWith(q)) ? 1 : 2);
  const matches = found
    .map((e, i) => ({ e, r: rank(e), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
  return { results: matches.slice(0, limit), matches, total: matches.length };
}

/** Stable key of an entry, for ticked state. */
export const entryKey = (e: { modelId: string; runtimeId: number }) => `${e.modelId}:${e.runtimeId}`;

/**
 * Reads every object of the loaded models into a search index, in batches, reporting progress.
 * Properties come through the shared object cache, so objects already inspected aren't fetched again.
 */
export async function buildSearchIndex(
  api: WorkspaceAPI,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<SearchEntry[]> {
  const models = await api.viewer.getObjects();
  const all = models.flatMap((m) => m.objects.map((o) => ({ modelId: m.modelId, id: o.id })));
  const cache = objectData(api);
  const entries: SearchEntry[] = [];
  onProgress(0, all.length);
  for (let i = 0; i < all.length; i += BATCH) {
    if (isCancelled()) return entries;
    const batch = all.slice(i, i + BATCH);
    // One call per model: the property API takes a single model id.
    const byModel = new Map<string, number[]>();
    for (const o of batch) byModel.set(o.modelId, [...(byModel.get(o.modelId) ?? []), o.id]);
    const loaded = await Promise.all([...byModel].map(([modelId, ids]) => cache.get(modelId, ids, ["props"]).then((d) => ({ modelId, d }))));
    for (const { modelId, d } of loaded) for (const o of d) entries.push(toEntry(modelId, o.runtimeId, o.props));
    onProgress(Math.min(i + BATCH, all.length), all.length);
  }
  return entries;
}

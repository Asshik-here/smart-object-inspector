import type { ModelObjectIds, ObjectProperties, WorkspaceAPI } from "trimble-connect-workspace-api";
import { BAR_COUNT_NAME, BAR_LENGTH_NAME, DIAMETER_NAME, numericProperty } from "./barProperties";
import { buildChain } from "./chain";
import {
  barRunAxis,
  centrelineBox,
  M_TO_MM,
  other,
  planPoint,
  scale,
  union,
  type Axis,
  type BoxMm,
  type Vec,
} from "./geometry";
import { applyCentres, evenCentres, renderLabelOrName } from "./labelTemplate";
import {
  addDimension,
  addMarkups,
  LABEL_COLOR,
  markupSet,
  OVERALL_COLOR,
  text,
  type DimensionStyle,
  type OwnedMarkup,
  type ValueText,
} from "./markups";
import { MAX_ANNOTATED_OBJECTS } from "./annotations";
import { objectData, selectionData } from "./objectData";
import type { StrokeLabel } from "./valueLabels";

export interface PickedPoint {
  /** Position as reported by `viewer.onPicked`, in meters like other viewer positions. */
  position: Vec;
  modelId: string;
  objectRuntimeId: number;
}

export interface PickedGroupSummary {
  label: string;
  /** Distinct bars picked in this group. */
  picked: number;
  /** Bars in the group according to its properties, when the model provides it. */
  expected: number | null;
  spacing: string;
}

export interface PickedChainResult {
  owned: OwnedMarkup[];
  /** Dimension values, drawn separately so they can face the camera. */
  labels: StrokeLabel[];
  groups: PickedGroupSummary[];
}

export interface PickedChainOptions {
  /** Gaps are rounded to this many mm (0: raw), measured from the first bar so noise doesn't add up. */
  roundTo: number;
  labelTemplate: string;
  style: DimensionStyle;
  valueText: ValueText;
}

interface PickedGroup {
  props: ObjectProperties | undefined;
  box: BoxMm;
  points: Vec[];
}

/** Outer box of the selection at bar centrelines, or null when nothing with a box is selected. */
async function selectionFrame(api: WorkspaceAPI, selection: ModelObjectIds[]): Promise<BoxMm | null> {
  const { objects } = await selectionData(api, selection, MAX_ANNOTATED_OBJECTS);
  const boxes = objects.filter((o) => o.box).map((o) => centrelineBox(o.box!, numericProperty(o.props, DIAMETER_NAME)));
  return boxes.length ? union(boxes) : null;
}

/** Picks grouped per object, with each object's properties and centreline box. */
async function pickedGroups(api: WorkspaceAPI, picks: PickedPoint[]): Promise<PickedGroup[]> {
  const byObject = new Map<string, PickedPoint[]>();
  for (const p of picks) {
    const key = `${p.modelId}:${p.objectRuntimeId}`;
    byObject.set(key, [...(byObject.get(key) ?? []), p]);
  }
  const cache = objectData(api);
  const groups = await Promise.all(
    [...byObject.values()].map(async (list): Promise<PickedGroup | null> => {
      const [data] = await cache.get(list[0].modelId, [list[0].objectRuntimeId]);
      if (!data?.box) return null;
      const box = centrelineBox(data.box, numericProperty(data.props, DIAMETER_NAME));
      return { props: data.props, box, points: list.map((p) => scale(p.position, M_TO_MM)) };
    }),
  );
  return groups.filter((g): g is PickedGroup => g !== null);
}

/**
 * Centre positions of the picked bars along the spacing axis. A pick on the first or last bar snaps
 * to that bar's centre (the centreline box edge); picks closer than a bar diameter are the same bar;
 * offsets from the first bar are rounded so the few mm of surface noise per pick don't add up.
 */
function barPositions(g: PickedGroup, along: Axis, roundTo: number): number[] {
  const diameter = numericProperty(g.props, DIAMETER_NAME) ?? 0;
  const radius = diameter / 2;
  const projected = g.points
    .map((p) => {
      const v = p[along];
      if (Math.abs(v - g.box.min[along]) <= radius + 2) return g.box.min[along];
      if (Math.abs(g.box.max[along] - v) <= radius + 2) return g.box.max[along];
      return v;
    })
    .sort((a, b) => a - b);
  const distinct = projected.filter((v, i) => i === 0 || v - projected[i - 1] > Math.max(diameter, 5));
  return distinct.map((v) => (roundTo > 0 ? distinct[0] + Math.round((v - distinct[0]) / roundTo) * roundTo : v));
}

/**
 * Draws one dimension chain per picked bar group, through the points the user picked (one per bar).
 * Works when a whole rebar group is a single object, because each pick is a real point on a real bar.
 * The chain runs from the outer edge of the selection (or the group), through the bars, to the other
 * edge; the overall dimension sits outside all chains, as on a Tekla drawing.
 */
export async function drawPickedChain(
  api: WorkspaceAPI,
  picks: PickedPoint[],
  selection: ModelObjectIds[],
  options: PickedChainOptions,
): Promise<PickedChainResult> {
  const groups = await pickedGroups(api, picks);
  if (!groups.length) return { owned: [], labels: [], groups: [] };

  const frame = (await selectionFrame(api, selection)) ?? union(groups.map((g) => g.box));
  const span = Math.max(frame.max.x - frame.min.x, frame.max.y - frame.min.y);
  const offset = Math.max(80, 0.06 * span);
  const z = frame.max.z;
  const set = markupSet(options.style, offset, options.valueText);
  const chainsPerAxis = new Map<Axis, number>();
  const summaries: PickedGroupSummary[] = [];

  for (const g of groups) {
    const runs = barRunAxis(g.box, numericProperty(g.props, BAR_LENGTH_NAME), g.points);
    const along = other(runs);
    const positions = barPositions(g, along, options.roundTo);

    const stack = chainsPerAxis.get(along) ?? 0;
    chainsPerAxis.set(along, stack + 1);
    const across = frame.min[runs] - offset * (1 + stack * 1.6);
    const edges = { min: frame.min[along], max: frame.max[along] };
    const chain = buildChain(positions, { along, across, z, edges, anchors: g.points }, set);

    const expected = numericProperty(g.props, BAR_COUNT_NAME);
    // Centres go in the label only once every bar is picked; a partial pick could hide an odd gap.
    const complete = expected === null || positions.length >= expected;
    const gaps = positions.slice(1).map((p, i) => p - positions[i]);
    const label = applyCentres(
      renderLabelOrName(options.labelTemplate, g.props),
      complete && gaps.length ? evenCentres(gaps) : null,
    );
    // As on the drawing: the label continues the dimension line beyond the far bar.
    const labelEnd = chain.direction === 1 ? Math.max(chain.end, edges.max) : Math.min(chain.end, edges.min);
    const labelAt = planPoint(along, labelEnd + chain.direction * offset * 1.5, across, z);
    set.texts.push(text(planPoint(along, chain.end, across, z), labelAt, label, LABEL_COLOR));
    summaries.push({ label, picked: positions.length, expected, spacing: chain.summary });
  }

  // Overall dimension per direction, outside every chain on that side.
  for (const [along, count] of chainsPerAxis) {
    const across = frame.min[other(along)] - offset * (1 + count * 1.6);
    const from = planPoint(along, frame.min[along], across, z);
    const to = planPoint(along, frame.max[along], across, z);
    const value = String(Math.round(frame.max[along] - frame.min[along]));
    addDimension(set, from, to, value, OVERALL_COLOR, planPoint(along, 0, -1, 0));
  }

  return { owned: await addMarkups(api, set), labels: set.labels, groups: summaries };
}

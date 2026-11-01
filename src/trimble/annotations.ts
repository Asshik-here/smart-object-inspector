import type { ModelObjectIds, ObjectProperties, WorkspaceAPI } from "trimble-connect-workspace-api";
import { BAR_LENGTH_NAME, DIAMETER_NAME, numericProperty } from "./barProperties";
import { buildChain } from "./chain";
import {
  barRunAxis,
  center,
  centrelineBox,
  other,
  planPoint,
  spread,
  union,
  type Axis,
  type BoxMm,
  type Vec,
} from "./geometry";
import type { IfcBarGroup } from "./ifcBars";
import {
  applyCentres,
  applyCount,
  evenCentres,
  MARK_TEMPLATE,
  renderLabel,
  renderLabelOrName,
  renderTagLines,
} from "./labelTemplate";
import {
  addDimension,
  addMarkups,
  LABEL_COLOR,
  markupSet,
  OVERALL_COLOR,
  TAG_COLOR,
  text,
  type DimensionStyle,
  type MarkupSet,
  type OwnedMarkup,
  type ValueText,
} from "./markups";
import { selectionData } from "./objectData";
import { detectSpacing, expandWithCount, parseSpacing, type SpacingCandidate } from "./spacing";
import type { StrokeLabel } from "./valueLabels";

/** Upper bound of objects annotated at once; keeps large selections responsive. */
export const MAX_ANNOTATED_OBJECTS = 200;
const MAX_GROUPS = 25;

export interface AnnotationOptions {
  labelTemplate: string;
  /** Token of the property holding the spacing list, e.g. `{Set.Spacing}`; empty to auto-detect. */
  spacingToken: string;
  /** Optional token of the property holding the number of bars, used with a single spacing value. */
  countToken: string;
  /** Property tokens shown as "Name: Value" lines under each label. */
  tagTokens: string[];
  /** "stacked": one markup per line; "inline": one markup with lines joined by " | ". */
  tagLayout: "stacked" | "inline";
  spacing: boolean;
  overall: boolean;
  height: boolean;
  labels: boolean;
  /** Section-style bar mark tags (`147`) with an arrow down to the bars. */
  marks: boolean;
  dimensionStyle: DimensionStyle;
  valueText: ValueText;
  /**
   * Gaps within this many mm of a run are merged into it (Tekla-style `8*200`). 0 shows exact values,
   * so a bar placed 7 mm off the grid stays visible as `207 · 193`.
   */
  mergeTolerance: number;
}

/** Bar positions read from the model's IFC file, keyed by IFC GlobalId. */
export type IfcBarIndex = Map<string, IfcBarGroup>;

interface AnnotatedObject {
  modelId: string;
  runtimeId: number;
  /** Label with {count} still unresolved; objects with the same value form one group. */
  label: string;
  box: BoxMm;
  /** Possible spacing lists from the object's properties; the first one that fits the box is used. */
  spacing: SpacingCandidate[];
  tagLines: string[];
  barLength: number | null;
  mark: string;
  /** One centreline point per bar from the IFC file (world mm), when an IFC is loaded. */
  ifcBars: Vec[] | null;
}

/** Bars sharing a label and plan direction, e.g. the ten "B1 PF" bars. */
interface BarGroup {
  label: string;
  /** Direction the bars run in plan. Spacing is measured along the other axis. */
  runs: Axis;
  members: AnnotatedObject[];
  /** Bar centre positions along the spacing axis, sorted. */
  positions: number[];
  /** A real point on each bar (its end, from the IFC), for extension lines and chain placement. */
  ends?: Vec[];
  /** Where the positions came from. */
  source: "measured" | "property" | "ifc" | "none";
  /** What the spacing was read from, when `source` is "property" or "ifc". */
  spacingFrom?: string;
}

export interface GroupSummary {
  label: string;
  count: number;
  spacing: string;
  source: BarGroup["source"];
  spacingFrom?: string;
}

export interface AnnotationResult {
  markupIds: number[];
  owned: OwnedMarkup[];
  /** Dimension values, drawn separately so they can face the camera. */
  labels: StrokeLabel[];
  objectCount: number;
  /** Overall extents of the annotated objects in millimeters. */
  extents: Vec | null;
  groups: GroupSummary[];
  truncated: boolean;
}

interface Drawing extends MarkupSet {
  summaries: GroupSummary[];
}

/**
 * Fits a spacing list to a group object's box: the axis whose extent best equals
 * sum(gaps) + one bar diameter is the spacing axis. Returns null if neither axis fits.
 */
function positionsFromGaps(box: BoxMm, gaps: number[]): { runs: Axis; positions: number[] } | null {
  const total = gaps.reduce((a, b) => a + b, 0);
  let best: { along: Axis; diameter: number } | null = null;
  for (const along of ["x", "y"] as Axis[]) {
    const diameter = box.max[along] - box.min[along] - total;
    // Allow a little tolerance for rounding; a bar thicker than 60 mm means the axis doesn't fit.
    if (diameter < -5 || diameter > 60) continue;
    if (!best || Math.abs(diameter) < Math.abs(best.diameter)) best = { along, diameter };
  }
  if (!best) return null;
  const positions = [box.min[best.along] + Math.max(0, best.diameter) / 2];
  for (const gap of gaps) positions.push(positions[positions.length - 1] + gap);
  return { runs: other(best.along), positions };
}

/**
 * Groups the selected objects into bar groups, taking bar positions from (in order of preference)
 * the IFC geometry, a spacing property that fits the object, or the objects' own boxes.
 */
function groupBars(objects: AnnotatedObject[]): BarGroup[] {
  const measured = new Map<string, BarGroup>();
  const result: BarGroup[] = [];
  for (const o of objects) {
    if (o.ifcBars && o.ifcBars.length > 1) {
      const along: Axis = spread(o.ifcBars, "x") >= spread(o.ifcBars, "y") ? "x" : "y";
      result.push({
        label: o.label,
        runs: other(along),
        members: [o],
        positions: o.ifcBars.map((p) => p[along]).sort((a, b) => a - b),
        source: "ifc",
        spacingFrom: "IFC geometry",
        ends: o.ifcBars,
      });
      continue;
    }
    // A rebar group exported as one object: only a spacing that matches its real extent is used.
    const fitted = o.spacing
      .map((candidate) => ({ fit: positionsFromGaps(o.box, candidate.gaps), from: candidate.from }))
      .find((c) => c.fit);
    if (fitted?.fit) {
      const { runs, positions } = fitted.fit;
      result.push({ label: o.label, runs, members: [o], positions, source: "property", spacingFrom: fitted.from });
      continue;
    }
    const runs = barRunAxis(o.box, o.barLength);
    const key = `${o.label}|${runs}`;
    const group = measured.get(key) ?? { label: o.label, runs, members: [], positions: [], source: "measured" };
    group.members.push(o);
    measured.set(key, group);
  }
  for (const group of measured.values()) {
    const along = other(group.runs);
    group.positions = group.members.map((m) => center(m.box)[along]).sort((a, b) => a - b);
    if (group.members.length < 2) group.source = "none";
    result.push(group);
  }
  return result.slice(0, MAX_GROUPS);
}

interface LabelPlacement {
  at: Vec;
  labelAt: Vec;
}

/** Draws the group's chain and returns its summary plus where the label continues the dimension line. */
function drawSpacing(group: BarGroup, overall: BoxMm, offset: number, tolerance: number, drawing: Drawing) {
  const along = other(group.runs);
  const edges = { min: overall.min[along], max: overall.max[along] };
  // With real bar ends (IFC), the chain goes beside those ends and at their height, so it lines up
  // with the bars from any viewing angle. Otherwise it sits on the min side at the top of the model.
  const ends = group.ends ?? [];
  const mean = (f: (p: Vec) => number) => ends.reduce((sum, p) => sum + f(p), 0) / ends.length;
  const middle = (overall.min[group.runs] + overall.max[group.runs]) / 2;
  const side: 1 | -1 = ends.length && mean((p) => p[group.runs]) > middle ? 1 : -1;
  const across = side === 1 ? overall.max[group.runs] + offset : overall.min[group.runs] - offset;
  const z = ends.length ? mean((p) => p.z) : overall.max.z;
  const chain = buildChain(group.positions, { along, across, z, edges, tolerance, side, anchors: ends }, drawing);
  const beyond = chain.direction === 1 ? Math.max(chain.end, edges.max) : Math.min(chain.end, edges.min);
  const placement: LabelPlacement = {
    at: planPoint(along, chain.end, across, z),
    labelAt: planPoint(along, beyond + chain.direction * offset * 1.5, across, z),
  };
  return { summary: chain.summary, placement };
}

/**
 * Label for the group, followed by its property tag lines. With a spacing chain the label continues
 * the chain's dimension line (as on a Tekla drawing); otherwise it has a leader to the group's last bar.
 * Stacked tag lines step diagonally (down in Y and Z) so they stay apart in plan, side and 3D views.
 */
function drawLabel(
  group: BarGroup,
  lift: number,
  layout: AnnotationOptions["tagLayout"],
  drawing: Drawing,
  placement?: LabelPlacement,
) {
  const along = other(group.runs);
  const anchor = group.members.reduce((a, b) => (center(b.box)[along] > center(a.box)[along] ? b : a));
  const lastBar = group.positions.length ? group.positions[group.positions.length - 1] : center(anchor.box)[along];
  const at = placement?.at ?? planPoint(along, lastBar, anchor.box.max[group.runs], anchor.box.max.z);
  const labelAt =
    placement?.labelAt ??
    planPoint(along, lastBar + lift * 0.3, anchor.box.max[group.runs] + lift * 0.8, at.z + lift * 0.3);
  const title = applyCount(group.label, group.members.length);
  const lines = anchor.tagLines;

  if (layout === "inline" || !lines.length) {
    const value = [title, ...lines].join("  |  ");
    drawing.texts.push(text(at, labelAt, value, LABEL_COLOR, anchor.modelId, anchor.runtimeId));
    return;
  }
  drawing.texts.push(text(at, labelAt, title, LABEL_COLOR, anchor.modelId, anchor.runtimeId));
  const step = lift * 0.35;
  lines.forEach((line, i) => {
    const p = { x: labelAt.x, y: labelAt.y - step * (i + 1), z: labelAt.z - step * (i + 1) };
    // Zero-length leader: the text sits at the point without a line back to the object.
    drawing.texts.push(text(p, p, line, TAG_COLOR));
  });
}

/**
 * Bar mark tag like the boxed `73` on a section: text above the group with an arrow down onto a bar.
 * Tags of different groups sit at different points along the bars so they don't overlap.
 */
function drawMarkTag(group: BarGroup, index: number, total: number, lift: number, drawing: Drawing) {
  const anchor = group.members[Math.floor(group.members.length / 2)];
  const along = other(group.runs);
  const bar = group.positions.length ? group.positions[Math.floor(group.positions.length / 2)] : center(anchor.box)[along];
  const fraction = total > 1 ? 0.3 + (0.4 * index) / (total - 1) : 0.5;
  const onBar = anchor.box.min[group.runs] + fraction * (anchor.box.max[group.runs] - anchor.box.min[group.runs]);
  const at = planPoint(along, bar, onBar, anchor.box.max.z);
  const tagAt = planPoint(along, bar, onBar, anchor.box.max.z + lift);
  drawing.texts.push(text(at, tagAt, anchor.mark, LABEL_COLOR, anchor.modelId, anchor.runtimeId));
}

function buildDrawing(objects: AnnotatedObject[], overall: BoxMm, options: AnnotationOptions): Drawing {
  const dx = overall.max.x - overall.min.x;
  const dy = overall.max.y - overall.min.y;
  const dz = overall.max.z - overall.min.z;
  const size = Math.max(dx, dy);
  const offset = Math.max(80, 0.06 * size);
  const drawing: Drawing = { ...markupSet(options.dimensionStyle, offset, options.valueText), summaries: [] };
  const minimum = Math.max(20, 0.03 * size);
  const z = overall.max.z;

  const groups = groupBars(objects);
  groups.forEach((group, index) => {
    const gaps = group.positions.slice(1).map((p, i) => p - group.positions[i]);
    group.label = applyCentres(group.label, group.source === "none" ? null : evenCentres(gaps));
    let spacing = "—";
    let placement: LabelPlacement | undefined;
    if (options.spacing && group.positions.length > 1) {
      ({ summary: spacing, placement } = drawSpacing(group, overall, offset, options.mergeTolerance, drawing));
    }
    if (options.labels) drawLabel(group, Math.max(150, 0.1 * size), options.tagLayout, drawing, placement);
    if (options.marks) drawMarkTag(group, index, groups.length, Math.max(120, 0.08 * size), drawing);
    drawing.summaries.push({
      label: applyCount(group.label, group.members.length),
      count: group.members.length,
      spacing,
      source: group.source,
      spacingFrom: group.spacingFrom,
    });
  });

  // Overall dimensions sit one step further out than the spacing chains.
  if (options.overall) {
    if (dx >= minimum) {
      const y = overall.min.y - offset * 2.5;
      const from = { x: overall.min.x, y, z };
      addDimension(drawing, from, { x: overall.max.x, y, z }, String(Math.round(dx)), OVERALL_COLOR, { x: 0, y: -1, z: 0 });
    }
    if (dy >= minimum) {
      const x = overall.min.x - offset * 2.5;
      const from = { x, y: overall.min.y, z };
      addDimension(drawing, from, { x, y: overall.max.y, z }, String(Math.round(dy)), OVERALL_COLOR, { x: -1, y: 0, z: 0 });
    }
  }
  if (options.height && dz >= 10) {
    const x = overall.max.x + offset;
    const y = overall.min.y;
    const from = { x, y, z: overall.min.z };
    addDimension(drawing, from, { x, y, z: overall.max.z }, String(Math.round(dz)), OVERALL_COLOR, { x: 1, y: 0, z: 0 });
  }
  return drawing;
}

/** The configured spacing property if set, otherwise every property that looks like a spacing. */
function readSpacing(options: AnnotationOptions, props: ObjectProperties | undefined): SpacingCandidate[] {
  if (!options.spacingToken.trim()) return detectSpacing(props);
  const gaps = parseSpacing(renderLabel(options.spacingToken, props));
  if (!gaps) return [];
  const count = options.countToken.trim() ? Number(renderLabel(options.countToken, props)) : NaN;
  const from = options.spacingToken.replace(/^\{|\}$/g, "");
  return [{ gaps: expandWithCount(gaps, Number.isInteger(count) ? count : null), from }];
}

async function loadObjects(
  api: WorkspaceAPI,
  selection: ModelObjectIds[],
  options: AnnotationOptions,
  ifc: IfcBarIndex | null,
): Promise<{ objects: AnnotatedObject[]; truncated: boolean }> {
  const kinds = ifc ? (["props", "box", "guid"] as const) : (["props", "box"] as const);
  const { objects, truncated } = await selectionData(api, selection, MAX_ANNOTATED_OBJECTS, [...kinds]);
  const annotated = objects
    .filter((o) => o.box)
    .map(
      (o): AnnotatedObject => ({
        modelId: o.modelId,
        runtimeId: o.runtimeId,
        label: renderLabelOrName(options.labelTemplate, o.props),
        box: centrelineBox(o.box!, numericProperty(o.props, DIAMETER_NAME)),
        spacing: readSpacing(options, o.props),
        tagLines: renderTagLines(options.tagTokens, o.props),
        barLength: numericProperty(o.props, BAR_LENGTH_NAME),
        mark: renderLabelOrName(MARK_TEMPLATE, o.props),
        ifcBars: (o.guid && ifc?.get(o.guid)?.bars) || null,
      }),
    );
  return { objects: annotated, truncated };
}

/** Draws spacing chains, overall dimensions, height and grouped labels for the selected objects. */
export async function drawAnnotations(
  api: WorkspaceAPI,
  selection: ModelObjectIds[],
  options: AnnotationOptions,
  ifc: IfcBarIndex | null = null,
): Promise<AnnotationResult> {
  const { objects, truncated } = await loadObjects(api, selection, options, ifc);
  if (!objects.length) {
    return { markupIds: [], owned: [], labels: [], objectCount: 0, extents: null, groups: [], truncated };
  }

  const overall = union(objects.map((o) => o.box));
  const drawing = buildDrawing(objects, overall, options);
  const owned = await addMarkups(api, drawing);

  return {
    markupIds: owned.map((m) => m.id),
    owned,
    labels: drawing.labels,
    objectCount: objects.length,
    extents: {
      x: overall.max.x - overall.min.x,
      y: overall.max.y - overall.min.y,
      z: overall.max.z - overall.min.z,
    },
    groups: drawing.summaries,
    truncated,
  };
}

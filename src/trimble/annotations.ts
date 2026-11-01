import type {
  Box3,
  ColorRGBA,
  MarkupPick,
  LineMarkup,
  MeasurementMarkup,
  ModelObjectIds,
  ObjectProperties,
  TextMarkup,
  WorkspaceAPI,
} from "trimble-connect-workspace-api";
import {
  applyCentres,
  applyCount,
  evenCentres,
  MARK_TEMPLATE,
  renderLabel,
  renderLabelOrName,
  renderTagLines,
} from "./labelTemplate";
import type { IfcBarGroup } from "./ifcBars";
import { canStroke, strokeWidth } from "./strokeFont";
import type { StrokeLabel } from "./valueLabels";
import { detectSpacing, expandWithCount, parseSpacing, type SpacingCandidate } from "./spacing";

/** Bounding boxes from the viewer are in meters; markup coordinates are in millimeters. */
const M_TO_MM = 1000;
/** Upper bound of objects annotated at once; keeps large selections responsive. */
export const MAX_ANNOTATED_OBJECTS = 200;
const MAX_GROUPS = 25;
/** Gaps within this tolerance (mm) are treated as equal when merging into "n*s". */
const GAP_TOLERANCE = 1;

const OVERALL_COLOR: ColorRGBA = { r: 0, g: 90, b: 190, a: 255 };
const SPACING_COLOR: ColorRGBA = { r: 45, g: 45, b: 45, a: 255 };
/** Extension lines from the bars to the dimension line: lighter, so the values stay the focus. */
const EXTENSION_COLOR: ColorRGBA = { r: 150, g: 150, b: 150, a: 255 };

/**
 * "drawing": thin line, a tick at every point and the bare value (`305`, `8*200`), as on a Tekla
 * drawing. Every value stays visible and nothing overlaps. "measure": Trimble measurement markups.
 */
export type DimensionStyle = "drawing" | "measure";

/**
 * How drawing-style values are written. "markup": Trimble text markups, which the viewer keeps facing
 * the camera live (smooth while orbiting) but always underlines. "stroke": values drawn with lines,
 * no underline, re-oriented to the camera after it stops moving.
 */
export type ValueText = "markup" | "stroke";
const LABEL_COLOR: ColorRGBA = { r: 200, g: 20, b: 30, a: 255 };
const TAG_COLOR: ColorRGBA = { r: 40, g: 40, b: 40, a: 255 };

type Axis = "x" | "y";

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface BoxMm {
  min: Vec;
  max: Vec;
}

export interface AnnotationOptions {
  labelTemplate: string;
  /** Token of the property holding the spacing list, e.g. `{Set.Spacing}`; empty to measure only. */
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
  /** Where the positions came from: measured objects or the spacing property. */
  source: "measured" | "property" | "ifc" | "none";
  /** Property the spacing was read from, when `source` is "property". */
  spacingFrom?: string;
}

export interface GroupSummary {
  label: string;
  count: number;
  spacing: string;
  source: BarGroup["source"];
  spacingFrom?: string;
}

/** A markup created by this extension, with enough content to recognise it after a reload. */
export interface OwnedMarkup {
  id: number;
  signature: string;
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

const toMm = (box: Box3): BoxMm => ({
  min: { x: box.min.x * M_TO_MM, y: box.min.y * M_TO_MM, z: box.min.z * M_TO_MM },
  max: { x: box.max.x * M_TO_MM, y: box.max.y * M_TO_MM, z: box.max.z * M_TO_MM },
});

/**
 * Bar centreline box in plan: the bounding box pulled in by the bar radius in X and Y, because Tekla
 * dimensions plan views to bar centrelines (2320, not the 2330 outer size). Z keeps the outer size,
 * matching section heights (120).
 */
function centrelineBox(box: Box3, diameter: number | null): BoxMm {
  const mm = toMm(box);
  const r = (diameter ?? 0) / 2;
  if (r <= 0 || mm.max.x - mm.min.x < 2 * r || mm.max.y - mm.min.y < 2 * r) return mm;
  return {
    min: { x: mm.min.x + r, y: mm.min.y + r, z: mm.min.z },
    max: { x: mm.max.x - r, y: mm.max.y - r, z: mm.max.z },
  };
}

const pick = (p: Vec, modelId?: string, objectId?: number): MarkupPick => ({
  positionX: p.x,
  positionY: p.y,
  positionZ: p.z,
  modelId,
  objectId,
});

const center = (b: BoxMm): Vec => ({
  x: (b.min.x + b.max.x) / 2,
  y: (b.min.y + b.max.y) / 2,
  z: (b.min.z + b.max.z) / 2,
});

const other = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

function union(boxes: BoxMm[]): BoxMm {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const b of boxes) {
    min.x = Math.min(min.x, b.min.x);
    min.y = Math.min(min.y, b.min.y);
    min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x);
    max.y = Math.max(max.y, b.max.y);
    max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

function dimension(from: Vec, to: Vec, color: ColorRGBA): MeasurementMarkup {
  return { color, start: pick(from), end: pick(to), mainLineStart: pick(from), mainLineEnd: pick(to) };
}

function line(from: Vec, to: Vec, color: ColorRGBA): LineMarkup {
  return { color, start: pick(from), end: pick(to) };
}

const offsetBy = (p: Vec, d: Vec, s: number): Vec => ({ x: p.x + d.x * s, y: p.y + d.y * s, z: p.z + d.z * s });
const distance = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

function text(at: Vec, labelAt: Vec, value: string, color: ColorRGBA, modelId?: string, objectId?: number): TextMarkup {
  return { color, text: value, start: pick(at, modelId, objectId), end: pick(labelAt) };
}

/** Point on a plan line: `along` is the coordinate on `axis`, `across` on the other axis. */
function planPoint(axis: Axis, along: number, across: number, z: number): Vec {
  return axis === "x" ? { x: along, y: across, z } : { x: across, y: along, z };
}

const BAR_LENGTH_NAME = /actual length|^length|bar ?length/i;
const BAR_COUNT_NAME = /number of bars|bars in group/i;
const DIAMETER_NAME = /^nominaldiameter$|^size$|^diameter$/i;

/** First positive numeric value of a property whose name matches. */
function numericProperty(props: ObjectProperties | undefined, name: RegExp): number | null {
  for (const set of props?.properties ?? []) {
    for (const p of set.properties ?? []) {
      if (!name.test(p.name)) continue;
      const n = Number(p.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Plan axis a group's bars run along. With a bar length property it is the axis whose extent is
 * closest to that length (a 10-bar group spread 1720 mm wide with 865 mm bars runs the short way).
 * Without it, the picks' spread decides when available, otherwise the longer side.
 */
function barRunAxis(box: BoxMm, barLength: number | null, points: Vec[] = []): Axis {
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  if (barLength) return Math.abs(dx - barLength) <= Math.abs(dy - barLength) ? "x" : "y";
  if (points.length > 1) {
    const spread = (a: Axis) => Math.max(...points.map((p) => p[a])) - Math.min(...points.map((p) => p[a]));
    return spread("x") >= spread("y") ? "y" : "x";
  }
  return dx >= dy ? "x" : "y";
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

function groupBars(objects: AnnotatedObject[]): BarGroup[] {
  const groups = new Map<string, BarGroup>();
  const result: BarGroup[] = [];
  for (const o of objects) {
    // Exact bar positions from the IFC geometry: one point per bar, already in world millimetres.
    if (o.ifcBars && o.ifcBars.length > 1) {
      const bars = o.ifcBars;
      const spread = (a: Axis) => Math.max(...bars.map((p) => p[a])) - Math.min(...bars.map((p) => p[a]));
      const along: Axis = spread("x") >= spread("y") ? "x" : "y";
      result.push({
        label: o.label,
        runs: other(along),
        members: [o],
        positions: bars.map((p) => p[along]).sort((a, b) => a - b),
        source: "ifc",
        spacingFrom: "IFC geometry",
        ends: bars,
      });
      continue;
    }
    // A rebar group exported as one object: bar positions come from its spacing property.
    // Only a spacing that matches the object's real extent is accepted.
    let fitted: { runs: Axis; positions: number[]; from: string } | null = null;
    for (const candidate of o.spacing) {
      const fit = positionsFromGaps(o.box, candidate.gaps);
      if (fit) {
        fitted = { ...fit, from: candidate.from };
        break;
      }
    }
    if (fitted) {
      result.push({
        label: o.label,
        runs: fitted.runs,
        members: [o],
        positions: fitted.positions,
        source: "property",
        spacingFrom: fitted.from,
      });
      continue;
    }
    const runs = barRunAxis(o.box, o.barLength);
    const key = `${o.label}|${runs}`;
    const group = groups.get(key) ?? { label: o.label, runs, members: [], positions: [], source: "measured" };
    group.members.push(o);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const along = other(group.runs);
    group.positions = group.members.map((m) => center(m.box)[along]).sort((a, b) => a - b);
    if (group.members.length < 2) group.source = "none";
    result.push(group);
  }
  return result.slice(0, MAX_GROUPS);
}

interface Run {
  from: number;
  to: number;
  gap: number;
  count: number;
}

/** Splits sorted positions into runs of equal gaps (within `tolerance` mm), like Tekla's "8*200". */
function equalGapRuns(positions: number[], tolerance = GAP_TOLERANCE): Run[] {
  const runs: Run[] = [];
  for (let i = 1; i < positions.length; i++) {
    const gap = positions[i] - positions[i - 1];
    if (gap < GAP_TOLERANCE) continue;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.gap - gap) <= Math.max(tolerance, GAP_TOLERANCE)) {
      last.to = positions[i];
      last.count++;
    } else {
      runs.push({ from: positions[i - 1], to: positions[i], gap, count: 1 });
    }
  }
  return runs;
}

const formatRun = (run: Run) => (run.count > 1 ? `${run.count}*${Math.round(run.gap)}` : `${Math.round(run.gap)}`);

/** Markups to add, in the chosen dimension style. */
interface MarkupSet {
  dims: MeasurementMarkup[];
  texts: TextMarkup[];
  lines: LineMarkup[];
  style: DimensionStyle;
  valueText: ValueText;
  /** Half-length of the ticks, and the unit for text clearance (mm). */
  tick: number;
  /** Tick positions already drawn, so chain segments sharing a point don't stack ticks. */
  ticks: Set<string>;
  /** Dimension values drawn as strokes; kept as data so they can be re-oriented to the camera. */
  labels: StrokeLabel[];
}

interface Drawing extends MarkupSet {
  summaries: GroupSummary[];
}

function markupSet(style: DimensionStyle, offset: number, valueText: ValueText): MarkupSet {
  const tick = Math.max(15, offset * 0.15);
  return { dims: [], texts: [], lines: [], style, valueText, tick, ticks: new Set(), labels: [] };
}

/**
 * One dimension from `from` to `to` labelled `value`. `outward` is the unit direction away from the
 * model: ticks run along it and the value sits on that side of the line.
 */
function addDimension(set: MarkupSet, from: Vec, to: Vec, value: string, color: ColorRGBA, outward: Vec) {
  if (set.style === "measure") {
    set.dims.push(dimension(from, to, color));
    // Measurements print their own length; only a merged run ("8*200") needs extra text.
    if (value !== String(Math.round(distance(from, to)))) {
      const mid = offsetBy(from, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, 0.5);
      set.texts.push(text(mid, offsetBy(mid, outward, set.tick * 4), value, color));
    }
    return;
  }
  set.lines.push(line(from, to, color));
  const length = distance(from, to) || 1;
  const lineDir = { x: (to.x - from.x) / length, y: (to.y - from.y) / length, z: (to.z - from.z) / length };
  addTick(set, from, lineDir, outward, color);
  addTick(set, to, lineDir, outward, color);
  const mid = offsetBy(from, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, 0.5);
  if (set.valueText === "markup" || !canStroke(value)) {
    // Just outside the line; a zero-length leader keeps it a plain, camera-facing label.
    const at = offsetBy(mid, outward, set.tick);
    set.texts.push(text(at, at, value, color));
    return;
  }
  // Trimble always underlines text markups (the API has no style option), so values are drawn as
  // strokes instead (see valueLabels.ts), on the outer side of the line, re-oriented to the camera.
  const height = set.tick * 1.8;
  const width = strokeWidth(value, height);
  // Like Tekla: a value wider than its segment moves just past the segment's end instead of
  // overlapping the ticks.
  const anchor = width > length * 0.9 ? offsetBy(to, lineDir, width / 2 + set.tick) : mid;
  set.labels.push({ value, anchor, lineDir, outward, height, gap: set.tick * 0.5, color });
}

/**
 * Tekla-style 45° slash across the dimension line at `p` (drawing style), once per point. A slash,
 * not a perpendicular tick, so it stays visible where an extension line meets the dimension line.
 * `lineDir` is the dimension line's direction, `outward` points away from the model.
 */
function addTick(set: MarkupSet, p: Vec, lineDir: Vec, outward: Vec, color: ColorRGBA) {
  if (set.style !== "drawing") return;
  const key = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
  if (set.ticks.has(key)) return;
  set.ticks.add(key);
  const d = { x: lineDir.x + outward.x, y: lineDir.y + outward.y, z: lineDir.z + outward.z };
  const slash = offsetBy({ x: 0, y: 0, z: 0 }, d, 1 / (Math.hypot(d.x, d.y, d.z) || 1));
  set.lines.push(line(offsetBy(p, slash, -set.tick), offsetBy(p, slash, set.tick), color));
}

/** Adds every markup of a set and returns what was created. */
async function addMarkups(api: WorkspaceAPI, set: MarkupSet): Promise<OwnedMarkup[]> {
  const [dims, texts, lines] = await Promise.all([
    set.dims.length ? api.markup.addMeasurementMarkups(set.dims) : Promise.resolve([]),
    set.texts.length ? api.markup.addTextMarkup(set.texts) : Promise.resolve([]),
    set.lines.length ? api.markup.addLineMarkups(set.lines) : Promise.resolve([]),
  ]);
  return [...dims, ...texts, ...lines]
    .filter((m) => m.id !== undefined)
    .map((m) => ({ id: m.id as number, signature: markupSignature(m) }));
}

interface Chain {
  /** Gap summary read from the starting edge, e.g. "110 + 8*200". */
  summary: string;
  /** Position of the far bar, where the label continues the dimension line. */
  end: number;
  /** Direction (+1 / -1 along the axis) from the far bar out to the label. */
  direction: 1 | -1;
}

/**
 * Which edge a Tekla-style chain starts from: the side with the smaller edge distance; on a tie,
 * the side next to the odd gap (B1 on the drawing: 305 · 110 · 8*200 rather than 8*200 · 110 · 305).
 */
function leadingEdge(first: number, last: number, edges: { min: number; max: number }, runs: Run[]): "min" | "max" {
  const toMin = first - edges.min;
  const toMax = edges.max - last;
  if (Math.abs(toMin - toMax) > GAP_TOLERANCE) return toMin < toMax ? "min" : "max";
  const oddAtMax = runs.length > 1 && runs[runs.length - 1].count === 1 && runs[0].count > 1;
  return oddAtMax ? "max" : "min";
}

/**
 * Tekla-style dimension chain along `along` at plan coordinate `across`: one edge → nearest bar,
 * then bar-to-bar gaps (equal runs merged). The far end has no edge dimension; the label continues
 * the line there. Single gaps are plain measurements; merged runs get one measurement spanning the
 * run plus an "n*s" text, because measurement markups can't carry custom text.
 */
function buildChain(
  positions: number[],
  along: Axis,
  across: number,
  z: number,
  edges: { min: number; max: number } | null,
  drawing: MarkupSet,
  tolerance = GAP_TOLERANCE,
  /** -1: the chain lies on the min side of the model, +1: on the max side. */
  side: 1 | -1 = -1,
  /** Points on the bars; each gets an extension line to the chain so ticks and bars visibly match. */
  anchors: Vec[] = [],
): Chain {
  const runs = equalGapRuns(positions, tolerance);
  const first = positions[0];
  const last = positions[positions.length - 1];
  const lead = edges ? leadingEdge(first, last, edges, runs) : "min";
  // An edge distance under this is just the bar's own half-thickness, not a real cover dimension.
  const MIN_EDGE = 15;
  const edgeSegment: Run[] = !edges
    ? []
    : lead === "min"
      ? [{ from: edges.min, to: first, gap: first - edges.min, count: 1 }]
      : [{ from: last, to: edges.max, gap: edges.max - last, count: 1 }];
  const segments: Run[] = [...edgeSegment.filter((s) => s.gap >= MIN_EDGE), ...runs].filter(
    (s) => s.gap >= GAP_TOLERANCE,
  );

  const outward = planPoint(along, 0, side, 0);
  for (const s of segments) {
    const from = planPoint(along, s.from, across, z);
    const to = planPoint(along, s.to, across, z);
    addDimension(drawing, from, to, formatRun(s), SPACING_COLOR, outward);
  }
  // Every bar gets a tick, also inside a merged run ("8*200" spans nine bars).
  const lineDir = planPoint(along, 1, 0, 0);
  for (const p of positions) addTick(drawing, planPoint(along, p, across, z), lineDir, outward, SPACING_COLOR);
  for (const a of anchors) {
    drawing.lines.push(line(a, planPoint(along, a[along], across, z), EXTENSION_COLOR));
  }
  const fromLead = lead === "min" ? runs : [...runs].reverse();
  return {
    summary: fromLead.map(formatRun).join(" + ") || "—",
    end: lead === "min" ? last : first,
    direction: lead === "min" ? 1 : -1,
  };
}

/** Spacing chain for one group, outside the overall box on the side where its bars start. */
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
  const side: 1 | -1 =
    ends.length && mean((p) => p[group.runs]) > (overall.min[group.runs] + overall.max[group.runs]) / 2 ? 1 : -1;
  const across = side === 1 ? overall.max[group.runs] + offset : overall.min[group.runs] - offset;
  const z = ends.length ? mean((p) => p.z) : overall.max.z;
  const chain = buildChain(group.positions, along, across, z, edges, drawing, tolerance, side, ends);
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
  for (const group of groups) {
    const gaps = group.positions.slice(1).map((p, i) => p - group.positions[i]);
    group.label = applyCentres(group.label, group.source === "none" ? null : evenCentres(gaps));
    let spacing = "—";
    let placement: LabelPlacement | undefined;
    if (options.spacing && group.positions.length > 1) {
      ({ summary: spacing, placement } = drawSpacing(group, overall, offset, options.mergeTolerance, drawing));
    }
    if (options.labels) drawLabel(group, Math.max(150, 0.1 * size), options.tagLayout, drawing, placement);
    if (options.marks) drawMarkTag(group, groups.indexOf(group), groups.length, Math.max(120, 0.08 * size), drawing);
    drawing.summaries.push({
      label: applyCount(group.label, group.members.length),
      count: group.members.length,
      spacing,
      source: group.source,
      spacingFrom: group.spacingFrom,
    });
  }

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
function readSpacing(options: AnnotationOptions, props: Parameters<typeof renderLabel>[1]): SpacingCandidate[] {
  if (!options.spacingToken.trim()) return detectSpacing(props);
  const gaps = parseSpacing(renderLabel(options.spacingToken, props));
  if (!gaps) return [];
  const count = options.countToken.trim() ? Number(renderLabel(options.countToken, props)) : NaN;
  const from = options.spacingToken.replace(/^\{|\}$/g, "");
  return [{ gaps: expandWithCount(gaps, Number.isInteger(count) ? count : null), from }];
}

/** IFC GlobalIds for runtime ids, or an empty map when the model has none (non-IFC models throw). */
async function globalIds(api: WorkspaceAPI, modelId: string, ids: number[]): Promise<Map<number, string>> {
  try {
    const external = await api.viewer.convertToObjectIds(modelId, ids);
    return new Map(ids.map((id, i) => [id, external[i]]));
  } catch {
    return new Map();
  }
}

async function loadObjects(
  api: WorkspaceAPI,
  selection: ModelObjectIds[],
  options: AnnotationOptions,
  ifc: IfcBarIndex | null,
): Promise<{ objects: AnnotatedObject[]; truncated: boolean }> {
  let remaining = MAX_ANNOTATED_OBJECTS;
  let truncated = false;
  const objects: AnnotatedObject[] = [];

  for (const entry of selection) {
    const ids = entry.objectRuntimeIds ?? [];
    if (!ids.length || remaining <= 0) {
      truncated ||= ids.length > 0;
      continue;
    }
    const batch = ids.slice(0, remaining);
    truncated ||= batch.length < ids.length;
    remaining -= batch.length;

    const [boxes, props, guids] = await Promise.all([
      api.viewer.getObjectBoundingBoxes(entry.modelId, batch),
      api.viewer.getObjectProperties(entry.modelId, batch),
      ifc ? globalIds(api, entry.modelId, batch) : Promise.resolve(new Map<number, string>()),
    ]);
    const byId = new Map(props.map((p) => [p.id, p]));
    for (const b of boxes) {
      if (!b.boundingBox) continue;
      const props = byId.get(b.id);
      const guid = guids.get(b.id);
      objects.push({
        modelId: entry.modelId,
        runtimeId: b.id,
        label: renderLabelOrName(options.labelTemplate, props),
        box: centrelineBox(b.boundingBox, numericProperty(props, DIAMETER_NAME)),
        spacing: readSpacing(options, props),
        tagLines: renderTagLines(options.tagTokens, props),
        barLength: numericProperty(props, BAR_LENGTH_NAME),
        mark: renderLabelOrName(MARK_TEMPLATE, props),
        ifcBars: (guid && ifc?.get(guid)?.bars) || null,
      });
    }
  }
  return { objects, truncated };
}

async function selectionBox(api: WorkspaceAPI, selection: ModelObjectIds[]): Promise<BoxMm | null> {
  const boxes: BoxMm[] = [];
  for (const entry of selection) {
    const ids = (entry.objectRuntimeIds ?? []).slice(0, MAX_ANNOTATED_OBJECTS);
    if (!ids.length) continue;
    const [result, props] = await Promise.all([
      api.viewer.getObjectBoundingBoxes(entry.modelId, ids),
      api.viewer.getObjectProperties(entry.modelId, ids),
    ]);
    const byId = new Map(props.map((p) => [p.id, p]));
    for (const b of result) {
      if (b.boundingBox) boxes.push(centrelineBox(b.boundingBox, numericProperty(byId.get(b.id), DIAMETER_NAME)));
    }
  }
  return boxes.length ? union(boxes) : null;
}

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

interface PickedGroup {
  props: ObjectProperties | undefined;
  box: BoxMm;
  points: Vec[];
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
  roundTo: number,
  labelTemplate: string,
  style: DimensionStyle = "drawing",
  valueText: ValueText = "markup",
): Promise<PickedChainResult> {
  const byObject = new Map<string, PickedPoint[]>();
  for (const p of picks) {
    const key = `${p.modelId}:${p.objectRuntimeId}`;
    byObject.set(key, [...(byObject.get(key) ?? []), p]);
  }

  const groups: PickedGroup[] = [];
  for (const list of byObject.values()) {
    const { modelId, objectRuntimeId } = list[0];
    const [boxes, props] = await Promise.all([
      api.viewer.getObjectBoundingBoxes(modelId, [objectRuntimeId]),
      api.viewer.getObjectProperties(modelId, [objectRuntimeId]),
    ]);
    const bb = boxes[0]?.boundingBox;
    if (!bb) continue;
    const points = list.map((p) => ({ x: p.position.x * M_TO_MM, y: p.position.y * M_TO_MM, z: p.position.z * M_TO_MM }));
    groups.push({ props: props[0], box: centrelineBox(bb, numericProperty(props[0], DIAMETER_NAME)), points });
  }
  if (!groups.length) return { owned: [], labels: [], groups: [] };

  const frame = (await selectionBox(api, selection)) ?? union(groups.map((g) => g.box));
  const span = Math.max(frame.max.x - frame.min.x, frame.max.y - frame.min.y);
  const offset = Math.max(80, 0.06 * span);
  const z = frame.max.z;
  const drawing = markupSet(style, offset, valueText);
  const chainsPerAxis = new Map<Axis, number>();
  const summaries: PickedGroupSummary[] = [];

  for (const g of groups) {
    const runs = barRunAxis(g.box, numericProperty(g.props, BAR_LENGTH_NAME), g.points);
    const along = other(runs);
    const diameter = numericProperty(g.props, DIAMETER_NAME) ?? 0;
    const radius = diameter / 2;

    // A pick on the first or last bar is snapped to that bar's centre, which the box edge fixes exactly.
    const projected = g.points
      .map((p) => {
        const v = p[along];
        if (Math.abs(v - g.box.min[along]) <= radius + 2) return g.box.min[along];
        if (Math.abs(g.box.max[along] - v) <= radius + 2) return g.box.max[along];
        return v;
      })
      .sort((a, b) => a - b);
    // Two picks closer than a bar diameter are the same bar.
    const distinct = projected.filter((v, i) => i === 0 || v - projected[i - 1] > Math.max(diameter, 5));

    // A pick lands on the bar surface, not its centre, so each pick carries a few mm of noise.
    // Rounding every bar's offset from the first bar (not each gap) keeps that noise from adding up.
    const positions = distinct.map((v) =>
      roundTo > 0 ? distinct[0] + Math.round((v - distinct[0]) / roundTo) * roundTo : v,
    );

    const stack = chainsPerAxis.get(along) ?? 0;
    chainsPerAxis.set(along, stack + 1);
    const across = frame.min[runs] - offset * (1 + stack * 1.6);
    const edges = { min: frame.min[along], max: frame.max[along] };
    const chain = buildChain(positions, along, across, z, edges, drawing, GAP_TOLERANCE, -1, g.points);
    const spacing = chain.summary;

    const expected = numericProperty(g.props, BAR_COUNT_NAME);
    // Centres go in the label only once every bar is picked; a partial pick could hide an odd gap.
    const complete = expected === null || distinct.length >= expected;
    const gaps = positions.slice(1).map((p, i) => p - positions[i]);
    const label = applyCentres(
      renderLabelOrName(labelTemplate, g.props),
      complete && gaps.length ? evenCentres(gaps) : null,
    );
    // As on the drawing: the label continues the dimension line beyond the far bar.
    const labelEnd = chain.direction === 1 ? Math.max(chain.end, edges.max) : Math.min(chain.end, edges.min);
    drawing.texts.push(
      text(
        planPoint(along, chain.end, across, z),
        planPoint(along, labelEnd + chain.direction * offset * 1.5, across, z),
        label,
        LABEL_COLOR,
      ),
    );
    summaries.push({
      label,
      picked: distinct.length,
      expected,
      spacing,
    });
  }

  // Overall dimension per direction, outside every chain on that side.
  for (const [along, count] of chainsPerAxis) {
    const runs = other(along);
    const across = frame.min[runs] - offset * (1 + count * 1.6);
    const from = planPoint(along, frame.min[along], across, z);
    const to = planPoint(along, frame.max[along], across, z);
    const value = String(Math.round(frame.max[along] - frame.min[along]));
    addDimension(drawing, from, to, value, OVERALL_COLOR, planPoint(along, 0, -1, 0));
  }

  return { owned: await addMarkups(api, drawing), labels: drawing.labels, groups: summaries };
}

/** Content fingerprint of a markup: its text, or its rounded end points for a measurement or line. */
export function markupSignature(markup: TextMarkup | MeasurementMarkup | LineMarkup): string {
  const r = (n: number | undefined) => Math.round(n ?? 0);
  const p = (m: MarkupPick | undefined) => `${r(m?.positionX)},${r(m?.positionY)},${r(m?.positionZ)}`;
  return "text" in markup && markup.text !== undefined
    ? `t:${markup.text}`
    : `m:${p(markup.start)}>${p(markup.end)}`;
}

/** Removes markups previously created by this extension. Never touches user-created markups. */
export async function clearAnnotations(api: WorkspaceAPI, markupIds: number[]): Promise<void> {
  if (markupIds.length) await api.markup.removeMarkups(markupIds);
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

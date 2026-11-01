import { line, addDimension, addTick, EXTENSION_COLOR, SPACING_COLOR, type MarkupSet } from "./markups";
import { planPoint, type Axis, type Vec } from "./geometry";

/** Gaps within this tolerance (mm) are treated as equal when merging into "n*s". */
export const GAP_TOLERANCE = 1;
/** An edge distance under this is just the bar's own half-thickness, not a real cover dimension. */
const MIN_EDGE = 15;

export interface Run {
  from: number;
  to: number;
  gap: number;
  count: number;
}

/** Splits sorted positions into runs of equal gaps (within `tolerance` mm), like Tekla's "8*200". */
export function equalGapRuns(positions: number[], tolerance = GAP_TOLERANCE): Run[] {
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

export const formatRun = (run: Run) => (run.count > 1 ? `${run.count}*${Math.round(run.gap)}` : `${Math.round(run.gap)}`);

export interface Chain {
  /** Gap summary read from the starting edge, e.g. "110 + 8*200". */
  summary: string;
  /** Position of the far bar, where the label continues the dimension line. */
  end: number;
  /** Direction (+1 / -1 along the axis) from the far bar out to the label. */
  direction: 1 | -1;
}

export interface Edges {
  min: number;
  max: number;
}

/**
 * Which edge a Tekla-style chain starts from: the side with the smaller edge distance; on a tie,
 * the side next to the odd gap (B1 on the drawing: 305 · 110 · 8*200 rather than 8*200 · 110 · 305).
 */
export function leadingEdge(first: number, last: number, edges: Edges, runs: Run[]): "min" | "max" {
  const toMin = first - edges.min;
  const toMax = edges.max - last;
  if (Math.abs(toMin - toMax) > GAP_TOLERANCE) return toMin < toMax ? "min" : "max";
  const oddAtMax = runs.length > 1 && runs[runs.length - 1].count === 1 && runs[0].count > 1;
  return oddAtMax ? "max" : "min";
}

export interface ChainLayout {
  /** Spacing axis: the chain's dimension line runs along it. */
  along: Axis;
  /** Plan coordinate of the dimension line on the other axis. */
  across: number;
  z: number;
  /** Outer edges along `along`; one edge distance is dimensioned from the leading edge. */
  edges: Edges | null;
  tolerance?: number;
  /** -1: the chain lies on the min side of the model, +1: on the max side. */
  side?: 1 | -1;
  /** Points on the bars; each gets an extension line to the chain so ticks and bars visibly match. */
  anchors?: Vec[];
}

/**
 * Tekla-style dimension chain: one edge → nearest bar, then bar-to-bar gaps (equal runs merged),
 * a tick at every bar and an extension line from each anchor. The far end has no edge dimension;
 * the label continues the line there.
 */
export function buildChain(positions: number[], layout: ChainLayout, set: MarkupSet): Chain {
  const { along, across, z, edges, tolerance = GAP_TOLERANCE, side = -1, anchors = [] } = layout;
  const runs = equalGapRuns(positions, tolerance);
  const first = positions[0];
  const last = positions[positions.length - 1];
  const lead = edges ? leadingEdge(first, last, edges, runs) : "min";
  const edgeSegment: Run[] = !edges
    ? []
    : lead === "min"
      ? [{ from: edges.min, to: first, gap: first - edges.min, count: 1 }]
      : [{ from: last, to: edges.max, gap: edges.max - last, count: 1 }];
  const segments = [...edgeSegment.filter((s) => s.gap >= MIN_EDGE), ...runs].filter((s) => s.gap >= GAP_TOLERANCE);

  const outward = planPoint(along, 0, side, 0);
  for (const s of segments) {
    addDimension(set, planPoint(along, s.from, across, z), planPoint(along, s.to, across, z), formatRun(s), SPACING_COLOR, outward);
  }
  // Every bar gets a tick, also inside a merged run ("8*200" spans nine bars).
  const lineDir = planPoint(along, 1, 0, 0);
  for (const p of positions) addTick(set, planPoint(along, p, across, z), lineDir, outward, SPACING_COLOR);
  for (const a of anchors) set.lines.push(line(a, planPoint(along, a[along], across, z), EXTENSION_COLOR));

  const fromLead = lead === "min" ? runs : [...runs].reverse();
  return {
    summary: fromLead.map(formatRun).join(" + ") || "—",
    end: lead === "min" ? last : first,
    direction: lead === "min" ? 1 : -1,
  };
}

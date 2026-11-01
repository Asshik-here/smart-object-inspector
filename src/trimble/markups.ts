import type {
  ColorRGBA,
  LineMarkup,
  MarkupPick,
  MeasurementMarkup,
  TextMarkup,
  WorkspaceAPI,
} from "trimble-connect-workspace-api";
import { distance, normalize, offsetBy, type Vec } from "./geometry";
import { canStroke, strokeWidth } from "./strokeFont";
import type { StrokeLabel } from "./valueLabels";

export const OVERALL_COLOR: ColorRGBA = { r: 0, g: 90, b: 190, a: 255 };
export const SPACING_COLOR: ColorRGBA = { r: 45, g: 45, b: 45, a: 255 };
/** Extension lines from the bars to the dimension line: lighter, so the values stay the focus. */
export const EXTENSION_COLOR: ColorRGBA = { r: 150, g: 150, b: 150, a: 255 };
export const LABEL_COLOR: ColorRGBA = { r: 200, g: 20, b: 30, a: 255 };
export const TAG_COLOR: ColorRGBA = { r: 40, g: 40, b: 40, a: 255 };

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

/** A markup created by this extension, with enough content to recognise it after a reload. */
export interface OwnedMarkup {
  id: number;
  signature: string;
}

/** Markups to add, in the chosen dimension style. */
export interface MarkupSet {
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

/** `offset` is the distance between the model and its dimension lines; ticks and text scale with it. */
export function markupSet(style: DimensionStyle, offset: number, valueText: ValueText): MarkupSet {
  const tick = Math.max(15, offset * 0.15);
  return { dims: [], texts: [], lines: [], style, valueText, tick, ticks: new Set(), labels: [] };
}

const pick = (p: Vec, modelId?: string, objectId?: number): MarkupPick => ({
  positionX: p.x,
  positionY: p.y,
  positionZ: p.z,
  modelId,
  objectId,
});

function dimension(from: Vec, to: Vec, color: ColorRGBA): MeasurementMarkup {
  return { color, start: pick(from), end: pick(to), mainLineStart: pick(from), mainLineEnd: pick(to) };
}

export function line(from: Vec, to: Vec, color: ColorRGBA): LineMarkup {
  return { color, start: pick(from), end: pick(to) };
}

/** Text with a leader from `at` (optionally attached to an object) to `labelAt`, where the text sits. */
export function text(
  at: Vec,
  labelAt: Vec,
  value: string,
  color: ColorRGBA,
  modelId?: string,
  objectId?: number,
): TextMarkup {
  return { color, text: value, start: pick(at, modelId, objectId), end: pick(labelAt) };
}

/**
 * Tekla-style 45° slash across the dimension line at `p` (drawing style), once per point. A slash,
 * not a perpendicular tick, so it stays visible where an extension line meets the dimension line.
 * `lineDir` is the dimension line's direction, `outward` points away from the model.
 */
export function addTick(set: MarkupSet, p: Vec, lineDir: Vec, outward: Vec, color: ColorRGBA) {
  if (set.style !== "drawing") return;
  const key = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
  if (set.ticks.has(key)) return;
  set.ticks.add(key);
  const slash = normalize({ x: lineDir.x + outward.x, y: lineDir.y + outward.y, z: lineDir.z + outward.z });
  set.lines.push(line(offsetBy(p, slash, -set.tick), offsetBy(p, slash, set.tick), color));
}

/**
 * One dimension from `from` to `to` labelled `value`. `outward` is the unit direction away from the
 * model: ticks run along it and the value sits on that side of the line.
 */
export function addDimension(set: MarkupSet, from: Vec, to: Vec, value: string, color: ColorRGBA, outward: Vec) {
  const length = distance(from, to) || 1;
  const lineDir = { x: (to.x - from.x) / length, y: (to.y - from.y) / length, z: (to.z - from.z) / length };
  const mid = offsetBy(from, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, 0.5);

  if (set.style === "measure") {
    set.dims.push(dimension(from, to, color));
    // Measurements print their own length; only a merged run ("8*200") needs extra text.
    if (value !== String(Math.round(distance(from, to)))) {
      set.texts.push(text(mid, offsetBy(mid, outward, set.tick * 4), value, color));
    }
    return;
  }
  set.lines.push(line(from, to, color));
  addTick(set, from, lineDir, outward, color);
  addTick(set, to, lineDir, outward, color);
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

/** Content fingerprint of a markup: its text, or its rounded end points for a measurement or line. */
export function markupSignature(markup: TextMarkup | MeasurementMarkup | LineMarkup): string {
  const r = (n: number | undefined) => Math.round(n ?? 0);
  const p = (m: MarkupPick | undefined) => `${r(m?.positionX)},${r(m?.positionY)},${r(m?.positionZ)}`;
  return "text" in markup && markup.text !== undefined ? `t:${markup.text}` : `m:${p(markup.start)}>${p(markup.end)}`;
}

/** Ownership records for markups the viewer just created. */
export function toOwned(markups: (TextMarkup | MeasurementMarkup | LineMarkup)[]): OwnedMarkup[] {
  return markups.filter((m) => m.id !== undefined).map((m) => ({ id: m.id as number, signature: markupSignature(m) }));
}

/** Adds every markup of a set (one call per markup type) and returns what was created. */
export async function addMarkups(api: WorkspaceAPI, set: MarkupSet): Promise<OwnedMarkup[]> {
  const [dims, texts, lines] = await Promise.all([
    set.dims.length ? api.markup.addMeasurementMarkups(set.dims) : Promise.resolve([]),
    set.texts.length ? api.markup.addTextMarkup(set.texts) : Promise.resolve([]),
    set.lines.length ? api.markup.addLineMarkups(set.lines) : Promise.resolve([]),
  ]);
  return toOwned([...dims, ...texts, ...lines]);
}

/** Removes markups previously created by this extension. Never touches user-created markups. */
export async function clearAnnotations(api: WorkspaceAPI, markupIds: number[]): Promise<void> {
  if (markupIds.length) await api.markup.removeMarkups(markupIds);
}

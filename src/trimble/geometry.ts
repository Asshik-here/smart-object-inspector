import type { Box3 } from "trimble-connect-workspace-api";

/** A point or direction. Model geometry is in millimetres unless noted. */
export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface BoxMm {
  min: Vec;
  max: Vec;
}

/** A plan axis. */
export type Axis = "x" | "y";

/** Viewer positions and bounding boxes are in meters; markup coordinates are in millimeters. */
export const M_TO_MM = 1000;

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const normalize = (a: Vec): Vec => scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
/** `p + d * s`. */
export const offsetBy = (p: Vec, d: Vec, s: number): Vec => ({ x: p.x + d.x * s, y: p.y + d.y * s, z: p.z + d.z * s });
export const distance = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

export const other = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

/** Point on a plan line: `along` is the coordinate on `axis`, `across` on the other axis. */
export function planPoint(axis: Axis, along: number, across: number, z: number): Vec {
  return axis === "x" ? { x: along, y: across, z } : { x: across, y: along, z };
}

export const toMm = (box: Box3): BoxMm => ({ min: scale(box.min, M_TO_MM), max: scale(box.max, M_TO_MM) });

export const center = (b: BoxMm): Vec => scale(add(b.min, b.max), 0.5);

export function union(boxes: BoxMm[]): BoxMm {
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

/** Spread of the points along a plan axis. */
export function spread(points: Vec[], axis: Axis): number {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p[axis]);
    max = Math.max(max, p[axis]);
  }
  return max - min;
}

/**
 * Bar centreline box in plan: the bounding box pulled in by the bar radius in X and Y, because Tekla
 * dimensions plan views to bar centrelines (2320, not the 2330 outer size). Z keeps the outer size,
 * matching section heights (120).
 */
export function centrelineBox(box: Box3, diameter: number | null): BoxMm {
  const mm = toMm(box);
  const r = (diameter ?? 0) / 2;
  if (r <= 0 || mm.max.x - mm.min.x < 2 * r || mm.max.y - mm.min.y < 2 * r) return mm;
  return {
    min: { x: mm.min.x + r, y: mm.min.y + r, z: mm.min.z },
    max: { x: mm.max.x - r, y: mm.max.y - r, z: mm.max.z },
  };
}

/**
 * Plan axis a group's bars run along. With a bar length it is the axis whose extent is closest to
 * that length (a 10-bar group spread 1720 mm wide with 865 mm bars runs the short way). Without it,
 * the points' spread decides when available (bars run across it), otherwise the longer side.
 */
export function barRunAxis(box: BoxMm, barLength: number | null, points: Vec[] = []): Axis {
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  if (barLength) return Math.abs(dx - barLength) <= Math.abs(dy - barLength) ? "x" : "y";
  if (points.length > 1) return spread(points, "x") >= spread(points, "y") ? "y" : "x";
  return dx >= dy ? "x" : "y";
}

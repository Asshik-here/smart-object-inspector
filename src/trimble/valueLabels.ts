import type { Camera, ColorRGBA, LineMarkup } from "trimble-connect-workspace-api";
import { strokeText, strokeWidth } from "./strokeFont";

interface Vec {
  x: number;
  y: number;
  z: number;
}

/**
 * A dimension value to draw as strokes. Kept as data, not markups, so it can be redrawn facing the
 * camera whenever the view changes (stroked text is real 3D geometry and would otherwise read
 * mirrored or upside-down from the other side).
 */
export interface StrokeLabel {
  value: string;
  /** Point on the dimension line the value belongs to (mm). */
  anchor: Vec;
  /** Unit direction of the dimension line. */
  lineDir: Vec;
  /** Unit direction away from the model; the value sits on this side of the line. */
  outward: Vec;
  /** Letter height (mm). */
  height: number;
  /** Clearance between the line and the value (mm). */
  gap: number;
  color: ColorRGBA;
}

/** Screen axes of the camera in world coordinates. */
export interface ViewFrame {
  right: Vec;
  up: Vec;
  forward: Vec;
}

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const normalize = (a: Vec): Vec => scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));

/**
 * Camera axes in world coordinates. Prefers position/lookAt/upDirection, which are plain world
 * vectors. The quaternion is only a fallback: measured against lookAt in Trimble Connect, its identity
 * looks along +Z (not −Z as the typings say), so forward is the rotated +Z.
 */
export function frameFromCamera(camera: Camera | null | undefined): ViewFrame | null {
  if (camera?.position && camera.lookAt && camera.upDirection) {
    const forward = normalize(add(camera.lookAt, scale(camera.position, -1)));
    const up = normalize(add(camera.upDirection, scale(forward, -dot(camera.upDirection, forward))));
    return { right: cross(forward, up), up, forward };
  }
  const q = camera?.quaternion;
  if (q) {
    const rotate = (v: Vec): Vec => {
      const u = { x: q.x, y: q.y, z: q.z };
      const t = scale(cross(u, v), 2);
      return add(add(v, scale(t, q.w)), cross(u, t));
    };
    const forward = rotate({ x: 0, y: 0, z: 1 });
    const up = rotate({ x: 0, y: 1, z: 0 });
    return { right: cross(forward, up), up, forward };
  }
  return null;
}

/**
 * Plan-view reading frame, used before the camera is known: lines along X read left→right with
 * tops towards +Y; lines along Y read bottom→top with tops towards −X (as vertical dimensions on a
 * drawing); vertical (Z) lines read upwards with tops outward.
 */
function planFrame(label: StrokeLabel): { dir: Vec; up: Vec } {
  const { lineDir, outward } = label;
  if (Math.abs(lineDir.z) > 0.9) return { dir: { x: 0, y: 0, z: 1 }, up: outward };
  return Math.abs(lineDir.x) >= Math.abs(lineDir.y)
    ? { dir: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } }
    : { dir: { x: 0, y: 1, z: 0 }, up: { x: -1, y: 0, z: 0 } };
}

/**
 * Baseline and letter-up for reading from the camera. The baseline follows the dimension line and
 * reads left→right on screen (bottom→top when the line is vertical on screen, as on a drawing).
 * Letter-up is `baseline × view direction`: perpendicular to the baseline, facing the viewer, and
 * never mirrored.
 */
function cameraFrame(label: StrokeLabel, view: ViewFrame): { dir: Vec; up: Vec } {
  let dir = label.lineDir;
  // A line pointing straight at the camera has no readable direction; fall back to screen axes.
  if (Math.abs(dot(dir, view.forward)) > 0.95) return { dir: view.right, up: view.up };
  const onRight = dot(dir, view.right);
  const onUp = dot(dir, view.up);
  if (onRight < -0.05 || (Math.abs(onRight) <= 0.05 && onUp < 0)) dir = scale(dir, -1);
  return { dir, up: normalize(cross(dir, view.forward)) };
}

/** Line markups drawing every label, readable from `view` (or from plan view when unknown). */
export function strokeLabels(labels: StrokeLabel[], view: ViewFrame | null): LineMarkup[] {
  const lines: LineMarkup[] = [];
  const pick = (p: Vec) => ({ positionX: p.x, positionY: p.y, positionZ: p.z });
  for (const label of labels) {
    const { dir, up } = view ? cameraFrame(label, view) : planFrame(label);
    const width = strokeWidth(label.value, label.height);
    // Push the text block out far enough that, however it is turned, it clears the dimension line.
    const clearance =
      label.gap +
      (label.height / 2) * Math.max(0.3, Math.abs(dot(up, label.outward))) +
      (width / 2) * Math.abs(dot(dir, label.outward));
    const center = add(label.anchor, scale(label.outward, clearance));
    const base = add(center, scale(up, -label.height / 2));
    for (const [a, b] of strokeText(label.value, base, dir, up, label.height)) {
      lines.push({ color: label.color, start: pick(a), end: pick(b) });
    }
  }
  return lines;
}

/**
 * Minimal IFC (STEP) reader for rebar geometry: finds every IfcReinforcingBar and returns one centreline
 * point per bar, in world millimetres. Tekla exports a rebar group as one IfcReinforcingBar whose body is
 * one IfcMappedItem (or IfcSweptDiskSolid) per bar, so the bar positions are in the file even though the
 * viewer API only exposes the group's bounding box.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface IfcBarGroup {
  globalId: string;
  name: string;
  /** One point on each bar's centreline (the start of its directrix), world millimetres. */
  bars: Vec3[];
}

/** Rotation (column vectors) plus translation. */
interface Transform {
  x: Vec3;
  y: Vec3;
  z: Vec3;
  t: Vec3;
}

const IDENTITY: Transform = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
  t: { x: 0, y: 0, z: 0 },
};

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return scale(a, 1 / l);
};

const rotate = (m: Transform, p: Vec3): Vec3 => add(add(scale(m.x, p.x), scale(m.y, p.y)), scale(m.z, p.z));
const apply = (m: Transform, p: Vec3): Vec3 => add(rotate(m, p), m.t);
/** `outer ∘ inner`: first inner, then outer. */
const compose = (outer: Transform, inner: Transform): Transform => ({
  x: rotate(outer, inner.x),
  y: rotate(outer, inner.y),
  z: rotate(outer, inner.z),
  t: apply(outer, inner.t),
});

/** Splits a STEP argument list at top-level commas. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "'" && !inString) inString = true;
    else if (c === "'" && inString) {
      if (args[i + 1] === "'") {
        current += c;
        i++;
      } else inString = false;
    } else if (!inString && c === "(") depth++;
    else if (!inString && c === ")") depth--;
    if (!inString && depth === 0 && c === ",") {
      out.push(current.trim());
      current = "";
    } else current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const refOf = (arg: string | undefined): number | null => {
  const m = arg ? /^#(\d+)$/.exec(arg.trim()) : null;
  return m ? Number(m[1]) : null;
};
const refList = (arg: string | undefined): number[] =>
  arg ? [...arg.matchAll(/#(\d+)/g)].map((m) => Number(m[1])) : [];
const unquote = (arg: string | undefined) => (arg && arg.startsWith("'") ? arg.slice(1, -1).replace(/''/g, "'") : "");

class StepFile {
  private entities = new Map<number, { type: string; args: string[] }>();

  constructor(text: string) {
    // Tekla writes one entity per line: #id= TYPE(args);
    for (const m of text.matchAll(/^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;\s*$/gm)) {
      this.entities.set(Number(m[1]), { type: m[2], args: splitArgs(m[3]) });
    }
  }

  get(id: number | null) {
    return id === null ? undefined : this.entities.get(id);
  }

  all(type: string): [number, string[]][] {
    const out: [number, string[]][] = [];
    for (const [id, e] of this.entities) if (e.type === type) out.push([id, e.args]);
    return out;
  }

  point(id: number | null): Vec3 {
    const e = this.get(id);
    const nums = (e?.args[0] ?? "").replace(/[()]/g, "").split(",").map(Number);
    return { x: nums[0] || 0, y: nums[1] || 0, z: nums[2] || 0 };
  }

  direction(id: number | null, fallback: Vec3): Vec3 {
    const e = this.get(id);
    if (!e || e.type !== "IFCDIRECTION") return fallback;
    const nums = (e.args[0] ?? "").replace(/[()]/g, "").split(",").map(Number);
    return normalize({ x: nums[0] || 0, y: nums[1] || 0, z: nums[2] || 0 });
  }

  /** IfcAxis2Placement3D(Location, Axis, RefDirection). */
  axis2Placement(id: number | null): Transform {
    const e = this.get(id);
    if (!e || e.type !== "IFCAXIS2PLACEMENT3D") return IDENTITY;
    const z = this.direction(refOf(e.args[1]), { x: 0, y: 0, z: 1 });
    const ref = this.direction(refOf(e.args[2]), { x: 1, y: 0, z: 0 });
    const x = normalize(add(ref, scale(z, -dot(ref, z))));
    return { x, y: cross(z, x), z, t: this.point(refOf(e.args[0])) };
  }

  /** IfcLocalPlacement(PlacementRelTo, RelativePlacement), resolved to world. */
  placement(id: number | null, depth = 0): Transform {
    const e = this.get(id);
    if (!e || e.type !== "IFCLOCALPLACEMENT" || depth > 50) return IDENTITY;
    const local = this.axis2Placement(refOf(e.args[1]));
    const parent = refOf(e.args[0]);
    return parent === null ? local : compose(this.placement(parent, depth + 1), local);
  }

  /** IfcCartesianTransformationOperator3D(Axis1, Axis2, LocalOrigin, Scale, Axis3); uniform scale only. */
  operator(id: number | null): Transform {
    const e = this.get(id);
    if (!e || !e.type.startsWith("IFCCARTESIANTRANSFORMATIONOPERATOR3D")) return IDENTITY;
    const s = e.args[3] && e.args[3] !== "$" ? Number(e.args[3]) || 1 : 1;
    const x = this.direction(refOf(e.args[0]), { x: 1, y: 0, z: 0 });
    const z = this.direction(refOf(e.args[4]), { x: 0, y: 0, z: 1 });
    const y = this.direction(refOf(e.args[1]), cross(z, x));
    return { x: scale(x, s), y: scale(y, s), z: scale(z, s), t: this.point(refOf(e.args[2])) };
  }

  /** First point of a curve: polyline vertex, or the line point of the first straight trimmed segment. */
  curveStart(id: number | null, depth = 0): Vec3 | null {
    const e = this.get(id);
    if (!e || depth > 10) return null;
    switch (e.type) {
      case "IFCPOLYLINE":
        return this.point(refList(e.args[0])[0] ?? null);
      case "IFCCOMPOSITECURVE":
        for (const seg of refList(e.args[0])) {
          const p = this.curveStart(seg, depth + 1);
          if (p) return p;
        }
        return null;
      case "IFCCOMPOSITECURVESEGMENT":
        return this.curveStart(refOf(e.args[2]), depth + 1);
      case "IFCTRIMMEDCURVE":
        return this.curveStart(refOf(e.args[0]), depth + 1);
      case "IFCLINE":
        return this.point(refOf(e.args[0]));
      default:
        return null;
    }
  }

  /** Centreline start points of the solids in a representation item, in the item's coordinates. */
  itemBars(id: number, depth = 0): Vec3[] {
    const e = this.get(id);
    if (!e || depth > 10) return [];
    if (e.type === "IFCSWEPTDISKSOLID") {
      const p = this.curveStart(refOf(e.args[0]));
      return p ? [p] : [];
    }
    if (e.type === "IFCMAPPEDITEM") {
      const map = this.get(refOf(e.args[0]));
      if (!map) return [];
      const origin = this.axis2Placement(refOf(map.args[0]));
      const target = this.operator(refOf(e.args[1]));
      const toItem = compose(target, origin);
      const shape = this.get(refOf(map.args[1]));
      return refList(shape?.args[3]).flatMap((it) => this.itemBars(it, depth + 1).map((p) => apply(toItem, p)));
    }
    return [];
  }

  /** Bars of an IfcProductDefinitionShape, using its Body representation. */
  shapeBars(id: number | null): Vec3[] {
    const shape = this.get(id);
    const reps = refList(shape?.args[2]).map((r) => this.get(r));
    const body = reps.find((r) => unquote(r?.args[1]) === "Body") ?? reps[0];
    return refList(body?.args[3]).flatMap((it) => this.itemBars(it));
  }
}

/** Reads every IfcReinforcingBar with its per-bar centreline points (world mm), keyed by GlobalId. */
export function readIfcBars(text: string): Map<string, IfcBarGroup> {
  const file = new StepFile(text);
  const groups = new Map<string, IfcBarGroup>();
  // IfcReinforcingBar(GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, …)
  for (const [, args] of file.all("IFCREINFORCINGBAR")) {
    const globalId = unquote(args[0]);
    const world = file.placement(refOf(args[5]));
    const bars = file.shapeBars(refOf(args[6])).map((p) => apply(world, p));
    if (globalId && bars.length) groups.set(globalId, { globalId, name: unquote(args[2]), bars });
  }
  return groups;
}

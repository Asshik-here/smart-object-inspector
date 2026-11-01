/**
 * Minimal IFC (STEP) reader for rebar geometry: finds every IfcReinforcingBar and returns one centreline
 * point per bar, in world millimetres. Tekla exports a rebar group as one IfcReinforcingBar whose body is
 * one IfcMappedItem (or IfcSweptDiskSolid) per bar, so the bar positions are in the file even though the
 * viewer API only exposes the group's bounding box.
 */
import { add, cross, dot, normalize, scale, type Vec } from "./geometry";

export interface IfcBarGroup {
  globalId: string;
  name: string;
  /** One point on each bar's centreline (the start of its directrix), world millimetres. */
  bars: Vec[];
}

/** Rotation (column vectors) plus translation. */
interface Transform {
  x: Vec;
  y: Vec;
  z: Vec;
  t: Vec;
}

const IDENTITY: Transform = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
  t: { x: 0, y: 0, z: 0 },
};

const rotate = (m: Transform, p: Vec): Vec => add(add(scale(m.x, p.x), scale(m.y, p.y)), scale(m.z, p.z));
const apply = (m: Transform, p: Vec): Vec => add(rotate(m, p), m.t);
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
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args.charCodeAt(i);
    if (c === 39 /* ' */) {
      if (inString && args.charCodeAt(i + 1) === 39) i++;
      else inString = !inString;
    } else if (!inString) {
      if (c === 40 /* ( */) depth++;
      else if (c === 41 /* ) */) depth--;
      else if (c === 44 /* , */ && depth === 0) {
        out.push(args.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  const last = args.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const refOf = (arg: string | undefined): number | null => {
  const m = arg ? /^#(\d+)$/.exec(arg.trim()) : null;
  return m ? Number(m[1]) : null;
};
const refList = (arg: string | undefined): number[] =>
  arg ? [...arg.matchAll(/#(\d+)/g)].map((m) => Number(m[1])) : [];
const unquote = (arg: string | undefined) => (arg && arg.startsWith("'") ? arg.slice(1, -1).replace(/''/g, "'") : "");

interface RawEntity {
  type: string;
  /** Raw argument text; split into arguments only when the entity is used. */
  raw: string;
  args?: string[];
}

/** Caches a pure per-entity computation; placements and bar shapes are shared by many bars. */
function memo<T>(cache: Map<number, T>, id: number | null, compute: () => T): T {
  if (id === null) return compute();
  let value = cache.get(id);
  if (value === undefined) {
    value = compute();
    cache.set(id, value);
  }
  return value;
}

class StepFile {
  private entities = new Map<number, RawEntity>();
  private placements = new Map<number, Transform>();
  private axes = new Map<number, Transform>();
  private items = new Map<number, Vec[]>();
  readonly bars: number[] = [];

  constructor(text: string) {
    // One pass indexing each entity's type and raw arguments: `#id= TYPE(args);`. Entities may span
    // lines, so a record ends at the first `;` outside a string and outside parentheses.
    const n = text.length;
    let i = text.indexOf("DATA;");
    i = i < 0 ? 0 : i + 5;
    while (i < n) {
      i = text.indexOf("#", i);
      if (i < 0) break;
      const eq = text.indexOf("=", i);
      const open = text.indexOf("(", eq);
      if (eq < 0 || open < 0) break;
      const id = Number(text.slice(i + 1, eq));
      const type = text.slice(eq + 1, open).trim();
      let depth = 0;
      let inString = false;
      let j = open;
      for (; j < n; j++) {
        const c = text.charCodeAt(j);
        if (c === 39 /* ' */) inString = !inString;
        else if (!inString) {
          if (c === 40 /* ( */) depth++;
          else if (c === 41 /* ) */ && --depth === 0) break;
        }
      }
      if (Number.isInteger(id) && /^[A-Z0-9_]+$/.test(type)) {
        this.entities.set(id, { type, raw: text.slice(open + 1, j) });
        if (type === "IFCREINFORCINGBAR") this.bars.push(id);
      }
      i = j + 1;
    }
  }

  get(id: number | null): { type: string; args: string[] } | undefined {
    const e = id === null ? undefined : this.entities.get(id);
    if (!e) return undefined;
    e.args ??= splitArgs(e.raw);
    return e as { type: string; args: string[] };
  }

  point(id: number | null): Vec {
    const e = this.get(id);
    const nums = (e?.args[0] ?? "").replace(/[()]/g, "").split(",").map(Number);
    return { x: nums[0] || 0, y: nums[1] || 0, z: nums[2] || 0 };
  }

  direction(id: number | null, fallback: Vec): Vec {
    const e = this.get(id);
    if (!e || e.type !== "IFCDIRECTION") return fallback;
    const nums = (e.args[0] ?? "").replace(/[()]/g, "").split(",").map(Number);
    return normalize({ x: nums[0] || 0, y: nums[1] || 0, z: nums[2] || 0 });
  }

  /** IfcAxis2Placement3D(Location, Axis, RefDirection). */
  axis2Placement(id: number | null): Transform {
    return memo(this.axes, id, () => {
      const e = this.get(id);
      if (!e || e.type !== "IFCAXIS2PLACEMENT3D") return IDENTITY;
      const z = this.direction(refOf(e.args[1]), { x: 0, y: 0, z: 1 });
      const ref = this.direction(refOf(e.args[2]), { x: 1, y: 0, z: 0 });
      const x = normalize(add(ref, scale(z, -dot(ref, z))));
      return { x, y: cross(z, x), z, t: this.point(refOf(e.args[0])) };
    });
  }

  /** IfcLocalPlacement(PlacementRelTo, RelativePlacement), resolved to world. */
  placement(id: number | null, depth = 0): Transform {
    if (depth > 50) return IDENTITY;
    return memo(this.placements, id, () => {
      const e = this.get(id);
      if (!e || e.type !== "IFCLOCALPLACEMENT") return IDENTITY;
      const local = this.axis2Placement(refOf(e.args[1]));
      const parent = refOf(e.args[0]);
      return parent === null ? local : compose(this.placement(parent, depth + 1), local);
    });
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
  curveStart(id: number | null, depth = 0): Vec | null {
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
  itemBars(id: number, depth = 0): Vec[] {
    if (depth > 10) return [];
    return memo(this.items, id, () => {
      const e = this.get(id);
      if (!e) return [];
      if (e.type === "IFCSWEPTDISKSOLID") {
        const p = this.curveStart(refOf(e.args[0]));
        return p ? [p] : [];
      }
      if (e.type === "IFCMAPPEDITEM") {
        const map = this.get(refOf(e.args[0]));
        if (!map) return [];
        const toItem = compose(this.operator(refOf(e.args[1])), this.axis2Placement(refOf(map.args[0])));
        const shape = this.get(refOf(map.args[1]));
        return refList(shape?.args[3]).flatMap((it) => this.itemBars(it, depth + 1).map((p) => apply(toItem, p)));
      }
      return [];
    });
  }

  /** Bars of an IfcProductDefinitionShape, using its Body representation. */
  shapeBars(id: number | null): Vec[] {
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
  for (const id of file.bars) {
    const args = file.get(id)!.args;
    const globalId = unquote(args[0]);
    const world = file.placement(refOf(args[5]));
    const bars = file.shapeBars(refOf(args[6])).map((p) => apply(world, p));
    if (globalId && bars.length) groups.set(globalId, { globalId, name: unquote(args[2]), bars });
  }
  return groups;
}

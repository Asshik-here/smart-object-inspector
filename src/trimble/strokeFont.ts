/**
 * Minimal single-stroke font for dimension values (digits and `* x - .`), drawn with line markups.
 * Trimble always underlines text markups; drawing the glyphs as strokes gives clean, underline-free
 * values that lie in the model plane like text on a CAD drawing.
 *
 * Glyphs are polylines on a 4 × 6 cell (x right, y up); characters advance by CHAR_ADVANCE cells.
 */

type Polyline = [number, number][];

export const GLYPH_HEIGHT = 6;
const CHAR_ADVANCE = 5.5;

const GLYPHS: Record<string, Polyline[]> = {
  "0": [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]]],
  "1": [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  "2": [[[0, 6], [4, 6], [4, 3], [0, 3], [0, 0], [4, 0]]],
  "3": [[[0, 6], [4, 6], [4, 0], [0, 0]], [[1, 3], [4, 3]]],
  "4": [[[0, 6], [0, 3], [4, 3]], [[3, 6], [3, 0]]],
  "5": [[[4, 6], [0, 6], [0, 3], [4, 3], [4, 0], [0, 0]]],
  "6": [[[4, 6], [0, 6], [0, 0], [4, 0], [4, 3], [0, 3]]],
  "7": [[[0, 6], [4, 6], [1, 0]]],
  "8": [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]], [[0, 3], [4, 3]]],
  "9": [[[4, 3], [0, 3], [0, 6], [4, 6], [4, 0], [0, 0]]],
  "*": [[[2, 1], [2, 5]], [[0.3, 2], [3.7, 4]], [[0.3, 4], [3.7, 2]]],
  x: [[[0.5, 1], [3.5, 5]], [[0.5, 5], [3.5, 1]]],
  "-": [[[0.5, 3], [3.5, 3]]],
  ".": [[[1.8, 0], [2.2, 0]]],
};

interface Vec {
  x: number;
  y: number;
  z: number;
}

/** Width of `value` drawn at `height`, in the same units. */
export function strokeWidth(value: string, height: number): number {
  return ((value.length * CHAR_ADVANCE - (CHAR_ADVANCE - 4)) * height) / GLYPH_HEIGHT;
}

/** True when every character of `value` has a glyph. */
export function canStroke(value: string): boolean {
  return [...value].every((c) => c === " " || c in GLYPHS);
}

/**
 * Strokes for `value`, centred on `center`, with the baseline along `dir` and glyph tops towards
 * `up` (both unit vectors), `height` in model units. Returns line segments as [from, to] pairs.
 */
export function strokeText(value: string, center: Vec, dir: Vec, up: Vec, height: number): [Vec, Vec][] {
  const unit = height / GLYPH_HEIGHT;
  const width = strokeWidth(value, height);
  const at = (cx: number, gx: number, gy: number): Vec => {
    const u = cx * unit + gx * unit - width / 2;
    const v = gy * unit;
    return {
      x: center.x + dir.x * u + up.x * v,
      y: center.y + dir.y * u + up.y * v,
      z: center.z + dir.z * u + up.z * v,
    };
  };
  const segments: [Vec, Vec][] = [];
  [...value].forEach((c, i) => {
    for (const poly of GLYPHS[c] ?? []) {
      for (let k = 1; k < poly.length; k++) {
        const cx = i * CHAR_ADVANCE;
        segments.push([at(cx, poly[k - 1][0], poly[k - 1][1]), at(cx, poly[k][0], poly[k][1])]);
      }
    }
  });
  return segments;
}

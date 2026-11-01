import type { ObjectProperties } from "trimble-connect-workspace-api";

/** Property names (any property set) that hold a bar's length, its group's bar count, or its diameter. */
export const BAR_LENGTH_NAME = /actual length|^length|bar ?length/i;
export const BAR_COUNT_NAME = /number of bars|bars in group/i;
export const DIAMETER_NAME = /^nominaldiameter$|^size$|^diameter$/i;

/** First positive numeric value of a property whose name matches. */
export function numericProperty(props: ObjectProperties | undefined, name: RegExp): number | null {
  for (const set of props?.properties ?? []) {
    for (const p of set.properties ?? []) {
      if (!name.test(p.name)) continue;
      const n = Number(p.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

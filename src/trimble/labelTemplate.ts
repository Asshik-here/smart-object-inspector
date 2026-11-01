import type { ObjectProperties } from "trimble-connect-workspace-api";

/** Placeholder replaced by the number of objects sharing the same label. */
export const COUNT_TOKEN = "{count}";
/**
 * Placeholder for the bar centres (spacing). Filled only when the spacing is known and even; otherwise
 * it is dropped together with the separator before it, as Tekla omits centres for uneven spacing.
 */
export const CENTRES_TOKEN = "{centres}";
/**
 * Reinforcement notation `QTY-GRADE+DIA-MARK-CENTRES-ID FIXING`, e.g. `4-H10-149-200-B2 PF`,
 * from the MSS_TEST_BBS_PS property set.
 */
export const DEFAULT_TEMPLATE =
  "{MSS_TEST_BBS_PS.NUMBER OF BARS IN GROUP}-{MSS_TEST_BBS_PS.GRADE}{MSS_TEST_BBS_PS.SIZE}-{MSS_TEST_BBS_PS.REBAR BARMARK}-{centres}-{MSS_TEST_BBS_PS.BAR / PART NAME}";
/** Earlier defaults; stored settings still holding one of these are moved to the current default. */
export const LEGACY_TEMPLATES = [
  "{count}-{name}",
  "{name}",
  "{MSS_TEST_BBS_PS.NUMBER OF BARS IN GROUP}-{MSS_TEST_BBS_PS.GRADE}{MSS_TEST_BBS_PS.SIZE}-{MSS_TEST_BBS_PS.REBAR BARMARK}-{MSS_TEST_BBS_PS.BAR / PART NAME}",
];
/** Bar mark shown in the section-style tags, e.g. `147`. */
export const MARK_TEMPLATE = "{MSS_TEST_BBS_PS.REBAR BARMARK}";
const PLACEHOLDERS = [COUNT_TOKEN, CENTRES_TOKEN];
const MISSING = "?";

export interface LabelToken {
  token: string;
  /** Example value from the inspected object, shown next to the token in the UI. */
  sample: string;
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  if (typeof value === "bigint") return value.toString();
  return value === undefined || value === null ? "" : String(value).trim();
}

/** All `{...}` tokens an object offers: built-ins plus every `{PropertySet.Property}` it actually has. */
export function tokenValues(props: ObjectProperties | null | undefined): Map<string, string> {
  const values = new Map<string, string>();
  if (!props) return values;
  values.set("{name}", formatValue(props.product?.name));
  values.set("{class}", formatValue(props.class));
  values.set("{objectType}", formatValue(props.product?.objectType));
  values.set("{description}", formatValue(props.product?.description));
  for (const set of props.properties ?? []) {
    for (const p of set.properties ?? []) {
      values.set(`{${set.name ?? ""}.${p.name}}`, formatValue(p.value));
    }
  }
  return values;
}

export function availableTokens(props: ObjectProperties | null | undefined): LabelToken[] {
  return [...tokenValues(props)].filter(([, v]) => v !== "").map(([token, sample]) => ({ token, sample }));
}

/**
 * Fills every token except {count} and {centres}; unknown or empty tokens become "?" so missing data stays visible.
 * Matching is case-insensitive because property names differ in casing between exporters.
 */
export function renderLabel(template: string, props: ObjectProperties | null | undefined): string {
  const values = tokenValues(props);
  const lower = new Map([...values].map(([k, v]) => [k.toLowerCase(), v]));
  return template.replace(/\{[^{}]+\}/g, (token) => {
    if (PLACEHOLDERS.includes(token)) return token;
    return lower.get(token.toLowerCase()) || MISSING;
  });
}

/**
 * Like {@link renderLabel}, but when the object has none of the template's properties (another model,
 * another property set) it falls back to the object's name instead of a string of "?".
 */
export function renderLabelOrName(template: string, props: ObjectProperties | null | undefined): string {
  const values = tokenValues(props);
  const lower = new Set([...values].filter(([, v]) => v !== "").map(([k]) => k.toLowerCase()));
  const tokens = (template.match(/\{[^{}]+\}/g) ?? []).filter((t) => !PLACEHOLDERS.includes(t));
  if (tokens.length && !tokens.some((t) => lower.has(t.toLowerCase()))) {
    return props?.product?.name || props?.class || MISSING;
  }
  return renderLabel(template, props);
}

/** Readable name for a token: `{Ifc Material.Material}` → `Material`, `{name}` → `Name`. */
export function tokenDisplayName(token: string): string {
  const inner = token.replace(/^\{|\}$/g, "");
  const name = inner.includes(".") ? inner.slice(inner.lastIndexOf(".") + 1) : inner;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One "Name: Value" line per token, for the 3D property tag. */
export function renderTagLines(tokens: string[], props: ObjectProperties | null | undefined): string[] {
  return tokens.map((t) => `${tokenDisplayName(t)}: ${renderLabel(t, props)}`);
}

export function applyCount(label: string, count: number): string {
  return label.split(COUNT_TOKEN).join(String(count));
}

/** Fills {centres}, or removes it with one adjacent separator when the spacing is unknown or uneven. */
export function applyCentres(label: string, centres: number | null): string {
  if (centres !== null) return label.split(CENTRES_TOKEN).join(String(Math.round(centres)));
  return label
    .replace(/[-\s]*\{centres\}/g, "")
    .replace(/^\{centres\}[-\s]*/g, "");
}

/** The single centre-to-centre spacing when all gaps are equal (within 1 mm), otherwise null. */
export function evenCentres(gaps: number[]): number | null {
  if (!gaps.length) return null;
  return gaps.every((g) => Math.abs(g - gaps[0]) <= 1) ? gaps[0] : null;
}

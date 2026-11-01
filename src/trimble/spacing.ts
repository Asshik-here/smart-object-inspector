import type { ObjectProperties } from "trimble-connect-workspace-api";

/**
 * Parses a rebar spacing description into the list of centre-to-centre gaps (mm).
 *
 * Accepted forms (case-insensitive, separated by spaces, commas or semicolons):
 * - `200`                single gap
 * - `8*200`, `8x200`, `8@200`   repeated gap
 * - `110 8*200`          mixed list, as Tekla writes it
 *
 * Returns null when the text contains anything that isn't a spacing, so unrelated
 * property values are never misread as geometry.
 */
export function parseSpacing(text: string): number[] | null {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return null;
  const gaps: number[] = [];
  for (const part of parts) {
    const repeated = /^(\d+)\s*[*x@×]\s*(\d+(?:\.\d+)?)$/i.exec(part);
    if (repeated) {
      const count = Number(repeated[1]);
      const gap = Number(repeated[2]);
      if (count < 1 || gap <= 0 || count > 1000) return null;
      for (let i = 0; i < count; i++) gaps.push(gap);
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(part) && Number(part) > 0) {
      gaps.push(Number(part));
      continue;
    }
    return null;
  }
  return gaps;
}

export interface SpacingCandidate {
  gaps: number[];
  /** Property the gaps were read from, as `Set.Property`. */
  from: string;
}

const SPACING_NAME = /spac|c\/c|centres|centers|pitch|distribution/i;
const COUNT_NAME = /number|count|quantity|qty|^no\.?$|^nr\.?$/i;
const REPEAT_FORMAT = /\d\s*[*x@×]\s*\d/i;

/**
 * Finds properties that look like a spacing: named like one (Spacing, c/c, Pitch…), or written in
 * repeat form like `8*200`. These are only candidates; the caller must check they fit the geometry.
 */
export function detectSpacing(props: ObjectProperties | null | undefined): SpacingCandidate[] {
  const all = (props?.properties ?? []).flatMap((set) =>
    (set.properties ?? []).map((p) => ({ from: `${set.name ?? ""}.${p.name}`, name: p.name, value: String(p.value ?? "") })),
  );
  const count = all.find((p) => COUNT_NAME.test(p.name) && /^\d+$/.test(p.value.trim()));
  const barCount = count ? Number(count.value) : null;

  const candidates: SpacingCandidate[] = [];
  for (const p of all) {
    if (!SPACING_NAME.test(p.name) && !REPEAT_FORMAT.test(p.value)) continue;
    const gaps = parseSpacing(p.value);
    if (gaps) candidates.push({ gaps: expandWithCount(gaps, barCount), from: p.from });
  }
  return candidates;
}

/** Expands a single spacing to `barCount - 1` gaps when the bar count is known. */
export function expandWithCount(gaps: number[], barCount: number | null): number[] {
  if (gaps.length === 1 && barCount !== null && barCount > 2) return Array(barCount - 1).fill(gaps[0]);
  return gaps;
}

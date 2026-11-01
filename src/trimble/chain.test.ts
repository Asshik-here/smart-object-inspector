import { describe, expect, it } from "vitest";
import { buildChain, equalGapRuns, formatRun, leadingEdge } from "./chain";
import { markupSet } from "./markups";

const positions = (start: number, gaps: number[]) => gaps.reduce((acc, g) => [...acc, acc[acc.length - 1] + g], [start]);

describe("equalGapRuns", () => {
  it("merges equal gaps into runs", () => {
    const runs = equalGapRuns(positions(0, [110, 200, 200, 200]));
    expect(runs.map(formatRun)).toEqual(["110", "3*200"]);
  });

  it("keeps small deviations visible unless a tolerance is given", () => {
    const p = positions(0, [200, 207, 193, 200]);
    expect(equalGapRuns(p).map(formatRun)).toEqual(["200", "207", "193", "200"]);
    expect(equalGapRuns(p, 10).map(formatRun)).toEqual(["4*200"]);
  });
});

describe("leadingEdge", () => {
  it("starts from the smaller edge distance", () => {
    expect(leadingEdge(35, 565, { min: 0, max: 850 }, [])).toBe("min");
    expect(leadingEdge(300, 820, { min: 0, max: 850 }, [])).toBe("max");
  });

  it("on a tie, starts next to the odd gap", () => {
    const runs = equalGapRuns(positions(305, [200, 200, 110]));
    expect(leadingEdge(305, 815, { min: 0, max: 1120 }, runs)).toBe("max");
  });
});

describe("buildChain", () => {
  it("draws Tekla-style: edge distance from the leading side, merged runs, a tick per bar", () => {
    // The drawing's B1 chain inside 2320: bars at 305, then 8*200, then 110 → read from the max edge
    // (the edge distances tie at 305, and the odd 110 gap is on that side): 305 · 110 · 8*200.
    const bars = positions(305, [200, 200, 200, 200, 200, 200, 200, 200, 110]);
    const set = markupSet("drawing", 139, "markup");
    const chain = buildChain(bars, { along: "x", across: -100, z: 0, edges: { min: 0, max: 2320 } }, set);

    expect(chain.summary).toBe("110 + 8*200");
    expect(chain.direction).toBe(-1);
    expect(set.texts.map((t) => t.text).sort()).toEqual(["110", "305", "8*200"]);
    // One dimension line per segment, one slash per bar and at the edge, no duplicate slashes.
    const slashes = set.lines.filter((l) => l.start.positionX !== l.end.positionX && l.start.positionY !== l.end.positionY);
    expect(slashes).toHaveLength(10 + 1);
  });
});

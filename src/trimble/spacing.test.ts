import { describe, expect, it } from "vitest";
import { detectSpacing, expandWithCount, parseSpacing } from "./spacing";

describe("parseSpacing", () => {
  it("reads Tekla spacing lists", () => {
    expect(parseSpacing("110 8*200")).toEqual([110, 200, 200, 200, 200, 200, 200, 200, 200]);
    expect(parseSpacing("8x200")).toHaveLength(8);
    expect(parseSpacing("8@200")).toHaveLength(8);
    expect(parseSpacing("110,200;200")).toEqual([110, 200, 200]);
    expect(parseSpacing("200")).toEqual([200]);
  });

  it("rejects anything that is not a spacing", () => {
    expect(parseSpacing("B1 PF")).toBeNull();
    expect(parseSpacing("?")).toBeNull();
    expect(parseSpacing("")).toBeNull();
    expect(parseSpacing("0")).toBeNull();
  });
});

describe("expandWithCount", () => {
  it("repeats a single spacing for the bar count", () => {
    expect(expandWithCount([200], 10)).toHaveLength(9);
    expect(expandWithCount([110, 200], 10)).toEqual([110, 200]);
    expect(expandWithCount([200], null)).toEqual([200]);
  });
});

describe("detectSpacing", () => {
  const set = (props: [string, string | number][]) => ({
    id: 1,
    properties: [{ name: "S", properties: props.map(([name, value]) => ({ name, value, type: 5 })) }],
  }) as never;

  it("finds spacing-like properties by name or repeat format", () => {
    expect(detectSpacing(set([["SPACING", "110 8*200"]]))[0]).toMatchObject({ from: "S.SPACING" });
    expect(detectSpacing(set([["Layout", "8x200"]]))).toHaveLength(1);
    expect(detectSpacing(set([["Spacing", 200], ["Number of bars", 10]]))[0].gaps).toHaveLength(9);
  });

  it("ignores lengths and other numbers", () => {
    expect(detectSpacing(set([["BarLength", 2320], ["NominalDiameter", 10]]))).toEqual([]);
  });
});

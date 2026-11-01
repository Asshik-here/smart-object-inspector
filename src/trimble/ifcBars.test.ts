import { describe, expect, it } from "vitest";
import { readIfcBars } from "./ifcBars";
import { FIXTURE_BAR_X, GROUP_GUID, IFC_FIXTURE } from "./testFixtures";

describe("readIfcBars", () => {
  const groups = readIfcBars(IFC_FIXTURE);
  const group = groups.get(GROUP_GUID)!;

  it("finds each rebar group with its name", () => {
    expect(groups.size).toBe(1);
    expect(group.name).toBe("B9 'PF'");
  });

  it("returns one world point per bar, through mapped items and the full placement chain", () => {
    expect(group.bars).toHaveLength(4);
    for (const [i, x] of FIXTURE_BAR_X.entries()) {
      expect(group.bars[i].x).toBeCloseTo(x, 6);
      expect(group.bars[i].y).toBeCloseTo(2000, 6);
      expect(group.bars[i].z).toBeCloseTo(0, 6);
    }
  });

  it("ignores files without reinforcing bars", () => {
    expect(readIfcBars("ISO-10303-21;\nDATA;\n#1= IFCWALL('x',$,$);\nENDSEC;").size).toBe(0);
  });
});

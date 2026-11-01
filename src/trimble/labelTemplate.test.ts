import { describe, expect, it } from "vitest";
import { applyCentres, DEFAULT_TEMPLATE, evenCentres, MARK_TEMPLATE, renderLabel, renderLabelOrName } from "./labelTemplate";
import { GROUP_PROPERTIES } from "./testFixtures";

describe("label notation", () => {
  it("renders QTY-GRADE+DIA-MARK-ID FIXING from the BBS properties", () => {
    expect(applyCentres(renderLabelOrName(DEFAULT_TEMPLATE, GROUP_PROPERTIES), null)).toBe("4-H10-99-B9 PF");
    expect(renderLabelOrName(MARK_TEMPLATE, GROUP_PROPERTIES)).toBe("99");
  });

  it("adds the centres only when they are known", () => {
    expect(applyCentres(renderLabelOrName(DEFAULT_TEMPLATE, GROUP_PROPERTIES), 200)).toBe("4-H10-99-200-B9 PF");
  });

  it("shows ? for a missing property but falls back to the name when none match", () => {
    expect(renderLabel("{MSS_TEST_BBS_PS.REBAR BARMARK}-{Nope.Missing}", GROUP_PROPERTIES)).toBe("99-?");
    const other = { id: 2, product: { name: "Beam B1" }, properties: [] };
    expect(renderLabelOrName(DEFAULT_TEMPLATE, other)).toBe("Beam B1");
  });
});

describe("evenCentres", () => {
  it("is the spacing when every gap is equal, otherwise null", () => {
    expect(evenCentres([200, 200, 200])).toBe(200);
    expect(evenCentres([110, 200, 200])).toBeNull();
    expect(evenCentres([])).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { WorkspaceAPI } from "trimble-connect-workspace-api";
import { drawAnnotations, type AnnotationOptions } from "./annotations";
import { readIfcBars } from "./ifcBars";
import { DEFAULT_TEMPLATE } from "./labelTemplate";
import { GROUP_BOX, GROUP_GUID, GROUP_PROPERTIES, IFC_FIXTURE } from "./testFixtures";

const OPTIONS: AnnotationOptions = {
  labelTemplate: DEFAULT_TEMPLATE,
  spacingToken: "",
  countToken: "",
  tagTokens: [],
  tagLayout: "stacked",
  spacing: true,
  overall: true,
  height: false,
  labels: true,
  marks: true,
  dimensionStyle: "drawing",
  valueText: "markup",
  mergeTolerance: 0,
};

function mockApi() {
  let id = 1;
  const added = { texts: [] as string[], lines: 0, measurements: 0 };
  const api = {
    viewer: {
      getObjectProperties: vi.fn(async () => [GROUP_PROPERTIES]),
      getObjectBoundingBoxes: vi.fn(async () => [{ id: 1, boundingBox: GROUP_BOX }]),
      convertToObjectIds: vi.fn(async () => [GROUP_GUID]),
    },
    markup: {
      addTextMarkup: vi.fn(async (list: { text?: string }[]) =>
        list.map((m) => (added.texts.push(m.text ?? ""), { ...m, id: id++ })),
      ),
      addLineMarkups: vi.fn(async (list: object[]) => ((added.lines += list.length), list.map((m) => ({ ...m, id: id++ })))),
      addMeasurementMarkups: vi.fn(async (list: object[]) =>
        ((added.measurements += list.length), list.map((m) => ({ ...m, id: id++ }))),
      ),
    },
  };
  return { api: api as unknown as WorkspaceAPI, added };
}

const SELECTION = [{ modelId: "m", objectRuntimeIds: [1] }];

describe("drawAnnotations", () => {
  it("draws the spacing chain from IFC bar positions, with label, tag and overall dimensions", async () => {
    const { api, added } = mockApi();
    const result = await drawAnnotations(api, SELECTION, OPTIONS, readIfcBars(IFC_FIXTURE));

    expect(result.groups).toEqual([
      expect.objectContaining({ label: "4-H10-99-B9 PF", spacing: "110 + 2*200", source: "ifc" }),
    ]);
    // Values on the chain, the label, the bar mark tag and both overall dimensions (centreline 510 × 800).
    expect(added.texts.sort()).toEqual(["110", "2*200", "4-H10-99-B9 PF", "510", "800", "99"]);
    expect(added.measurements).toBe(0);
    expect(result.owned).toHaveLength(added.texts.length + added.lines);
  });

  it("without an IFC, labels the group but reports that no spacing is known", async () => {
    const { api, added } = mockApi();
    const result = await drawAnnotations(api, SELECTION, OPTIONS, null);

    expect(result.groups[0]).toMatchObject({ label: "4-H10-99-B9 PF", spacing: "—", source: "none" });
    expect(added.texts).not.toContain("110");
  });

  it("uses Trimble measurements in measure style, adding text only for merged runs", async () => {
    const { api, added } = mockApi();
    await drawAnnotations(api, SELECTION, { ...OPTIONS, dimensionStyle: "measure" }, readIfcBars(IFC_FIXTURE));

    expect(added.measurements).toBeGreaterThan(0);
    expect(added.texts).toContain("2*200");
    expect(added.texts).not.toContain("110");
  });
});

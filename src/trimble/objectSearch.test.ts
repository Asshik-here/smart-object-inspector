import { describe, expect, it, vi } from "vitest";
import type { WorkspaceAPI } from "trimble-connect-workspace-api";
import { buildSearchIndex, groupByCastUnit, rebarByCastUnit, searchEntries, toEntry } from "./objectSearch";
import { GROUP_PROPERTIES } from "./testFixtures";

const beam = { id: 2, class: "IFCBEAM", product: { name: "Beam 73A" }, properties: [] };
const entries = [toEntry("m", 1, GROUP_PROPERTIES), toEntry("m", 2, beam)];

describe("toEntry", () => {
  it("titles rebar groups with their bar label and shows a readable class", () => {
    expect(entries[0]).toMatchObject({ title: "4-H10-99-B9 PF", subtitle: "Reinforcing bar" });
    expect(entries[1]).toMatchObject({ title: "Beam 73A", subtitle: "Beam" });
  });
});

describe("searchEntries", () => {
  it("matches any property value, every word, case-insensitively", () => {
    expect(searchEntries(entries, "h10").results.map((e) => e.runtimeId)).toEqual([1]);
    expect(searchEntries(entries, "beam 73a").results.map((e) => e.runtimeId)).toEqual([2]);
    expect(searchEntries(entries, "nothing like this").total).toBe(0);
    expect(searchEntries(entries, "  ").total).toBe(0);
  });

  it("ranks an exact bar mark first", () => {
    const withMark = [entries[1], toEntry("m", 3, { ...GROUP_PROPERTIES, id: 3 })];
    // "99" is the bar mark of the rebar group; the beam doesn't contain it at all.
    expect(searchEntries(withMark, "99").results[0].runtimeId).toBe(3);
  });

  it("limits the shown results but reports the total", () => {
    const many = Array.from({ length: 80 }, (_, i) => toEntry("m", i, beam));
    const { results, total } = searchEntries(many, "beam");
    expect(results).toHaveLength(50);
    expect(total).toBe(80);
  });
});

describe("buildSearchIndex", () => {
  it("indexes every object of every model, in batches, with progress", async () => {
    const api = {
      viewer: {
        getObjects: vi.fn(async () => [
          { modelId: "a", objects: [{ id: 1 }, { id: 2 }] },
          { modelId: "b", objects: [{ id: 7 }] },
        ]),
        getObjectProperties: vi.fn(async (_m: string, ids: number[]) => ids.map((id) => ({ ...beam, id }))),
      },
    } as unknown as WorkspaceAPI;
    const progress: number[] = [];
    const index = await buildSearchIndex(api, (done) => progress.push(done), () => false);

    expect(index.map((e) => `${e.modelId}:${e.runtimeId}`)).toEqual(["a:1", "a:2", "b:7"]);
    expect(progress.at(-1)).toBe(3);
  });
});

describe("cast units", () => {
  const unit = (id: number, name: string, mark: string, cls = "IFCREINFORCINGBAR") =>
    toEntry("m", id, {
      id,
      class: cls,
      product: { name },
      properties: [{ name: "S", properties: [{ name: "CAST UNIT MARK", value: mark, type: 5 }] }],
    } as never);
  const all = [unit(1, "B2 PF", "U-1"), unit(2, "B1 PF", "U-1"), unit(3, "MESH", "U-1", "IFCELEMENTASSEMBLY"), unit(4, "B1 PF", "U-2")];

  it("groups results by cast unit in order of appearance", () => {
    expect(groupByCastUnit(all).map((g) => [g.castUnit, g.results.length])).toEqual([["U-1", 3], ["U-2", 1]]);
  });

  it("selects every reinforcing bar group of a unit, without the assembly", () => {
    const units = rebarByCastUnit(all);
    expect(units.get("U-1")?.map((e) => e.runtimeId)).toEqual([1, 2]);
    expect(units.get("U-2")?.map((e) => e.runtimeId)).toEqual([4]);
    expect(units.has("")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { WorkspaceAPI } from "trimble-connect-workspace-api";
import { ObjectDataCache } from "./objectData";

function mockApi(failFirst = false) {
  let fail = failFirst;
  const viewer = {
    getObjectProperties: vi.fn(async (_m: string, ids: number[]) => {
      if (fail) {
        fail = false;
        throw new Error("viewer busy");
      }
      return ids.map((id) => ({ id, product: { name: `P${id}` } }));
    }),
    getObjectBoundingBoxes: vi.fn(async (_m: string, ids: number[]) =>
      ids.map((id) => ({ id, boundingBox: { isBox3: true, min: { x: id, y: 0, z: 0 }, max: { x: id + 1, y: 1, z: 1 } } })),
    ),
    convertToObjectIds: vi.fn(async () => {
      throw new Error("not an IFC model");
    }),
  };
  return { api: { viewer } as unknown as WorkspaceAPI, viewer };
}

describe("ObjectDataCache", () => {
  it("fetches each object once, batching only the missing ones", async () => {
    const { api, viewer } = mockApi();
    const cache = new ObjectDataCache(api);
    await cache.get("m", [1, 2]);
    const second = await cache.get("m", [2, 3]);

    expect(viewer.getObjectProperties).toHaveBeenCalledTimes(2);
    expect(viewer.getObjectProperties).toHaveBeenLastCalledWith("m", [3]);
    expect(second.map((o) => o.props?.product?.name)).toEqual(["P2", "P3"]);
    expect(second[1].box?.min.x).toBe(3);
  });

  it("shares in-flight requests", async () => {
    const { api, viewer } = mockApi();
    const cache = new ObjectDataCache(api);
    await Promise.all([cache.get("m", [1]), cache.get("m", [1])]);
    expect(viewer.getObjectProperties).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const { api, viewer } = mockApi(true);
    const cache = new ObjectDataCache(api);
    await expect(cache.get("m", [1], ["props"])).rejects.toThrow("viewer busy");
    const [retry] = await cache.get("m", [1], ["props"]);
    expect(retry.props?.product?.name).toBe("P1");
    expect(viewer.getObjectProperties).toHaveBeenCalledTimes(2);
  });

  it("treats models without IFC ids as having no GUIDs", async () => {
    const { api } = mockApi();
    const [object] = await new ObjectDataCache(api).get("m", [1], ["guid"]);
    expect(object.guid).toBeUndefined();
  });
});

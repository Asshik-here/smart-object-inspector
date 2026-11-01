import { describe, expect, it } from "vitest";
import { cross, dot, type Vec } from "./geometry";
import { cameraFrame, frameFromCamera, type StrokeLabel, type ViewFrame } from "./valueLabels";

const close = (a: Vec, b: Vec) => {
  expect(a.x).toBeCloseTo(b.x, 2);
  expect(a.y).toBeCloseTo(b.y, 2);
  expect(a.z).toBeCloseTo(b.z, 2);
};

/** A camera as Trimble Connect reported it while looking down at a mesh (screen right ≈ +Y). */
const recorded = {
  position: { x: 516.2981801665196, y: 650.075349420033, z: 3.0420096520267395 },
  lookAt: { x: 516.1958710268233, y: 650.0929534207781, z: 2.0474127793731185 },
  upDirection: { x: -0.9801924509502105, y: 0.16865852540735193, z: 0.10381262402828104 },
  quaternion: { x: -0.6434989486819306, y: 0.7636802599072865, z: 0.03974720545615874, w: -0.03349213835537395 },
};

describe("frameFromCamera", () => {
  it("derives screen axes from lookAt/upDirection", () => {
    const view = frameFromCamera(recorded)!;
    close(view.right, { x: 0.17, y: 0.986, z: 0 });
    expect(view.forward.z).toBeLessThan(-0.99);
  });

  it("gives the same axes from the quaternion alone (identity looks along +Z in Trimble Connect)", () => {
    const fromLookAt = frameFromCamera(recorded)!;
    const fromQuaternion = frameFromCamera({ quaternion: recorded.quaternion })!;
    close(fromQuaternion.right, fromLookAt.right);
    close(fromQuaternion.up, fromLookAt.up);
    close(fromQuaternion.forward, fromLookAt.forward);
  });
});

describe("cameraFrame", () => {
  const label = (lineDir: Vec): StrokeLabel => ({
    value: "305",
    anchor: { x: 0, y: 0, z: 0 },
    lineDir,
    outward: { x: 0, y: -1, z: 0 },
    height: 40,
    gap: 10,
    color: { r: 0, g: 0, b: 0, a: 255 },
  });
  const views: Record<string, ViewFrame> = {
    top: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } },
    "top turned 180°": { right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: -1, z: 0 }, forward: { x: 0, y: 0, z: -1 } },
    recorded: frameFromCamera(recorded)!,
  };

  for (const [name, view] of Object.entries(views)) {
    for (const lineDir of [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]) {
      it(`reads correctly from the ${name} view along (${lineDir.x}, ${lineDir.y})`, () => {
        const { dir, up } = cameraFrame(label(lineDir), view);
        const onRight = dot(dir, view.right);
        // Left→right on screen, or bottom→top when the line is vertical on screen.
        expect(onRight > 0.05 || (Math.abs(onRight) <= 0.05 && dot(dir, view.up) > 0)).toBe(true);
        // Not mirrored: baseline × letter-up points back at the viewer.
        expect(dot(cross(dir, up), view.forward)).toBeLessThan(0);
      });
    }
  }
});

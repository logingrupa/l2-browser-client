import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { getWorldCanvas } from "../../src/scene/getWorldCanvas";
import { projectPosition } from "../../src/scene/projectPosition";

let engine: NullEngine;
beforeEach(() => { engine = new NullEngine(); });
afterEach(() => { engine.dispose(); vi.restoreAllMocks(); });

it("uses the Editor display canvas for projection instead of its detached renderer", () => {
  const detached = { tagName: "CANVAS", clientWidth: 0, clientHeight: 0 } as HTMLCanvasElement;
  const visible = { tagName: "CANVAS", clientWidth: 800, clientHeight: 360 } as HTMLCanvasElement;
  vi.spyOn(engine, "getRenderingCanvas").mockReturnValue(detached);
  vi.spyOn(engine, "getInputElement").mockReturnValue(visible);
  const scene = new Scene(engine);
  scene.activeCamera = new ArcRotateCamera("World camera", -Math.PI / 2, Math.PI / 2, 5, Vector3.Zero(), scene);
  scene.updateTransformMatrix(true);
  expect(getWorldCanvas(engine)).toBe(visible);
  const point = projectPosition(scene, Vector3.Zero());
  expect(point.x).toBeCloseTo(400);
  expect(point.y).toBeCloseTo(180);
  expect(point.z).toBeGreaterThan(0);
  expect(point.z).toBeLessThan(1);
  scene.dispose();
});

it("retains the browser canvas when the input element is absent or not a canvas", () => {
  const canvas = { tagName: "CANVAS" } as HTMLCanvasElement;
  vi.spyOn(engine, "getRenderingCanvas").mockReturnValue(canvas);
  const input = vi.spyOn(engine, "getInputElement").mockReturnValue(null);
  expect(getWorldCanvas(engine)).toBe(canvas);
  input.mockReturnValue({ tagName: "DIV" } as HTMLElement);
  expect(getWorldCanvas(engine)).toBe(canvas);
  input.mockReturnValue(canvas);
  expect(getWorldCanvas(engine)).toBe(canvas);
});

it("retains the missing-canvas result for an engine without a DOM surface", () => {
  expect(getWorldCanvas(engine)).toBeNull();
});

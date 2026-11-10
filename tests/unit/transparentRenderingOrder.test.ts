import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager";
import { compareTransparentSubMeshes, installTransparentRenderingOrder } from "../../src/runtime/transparentRenderingOrder";

const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });

function sceneWithMeshes() {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const subMeshAt = (name: string, distanceToCamera: number, alphaIndex: number, emitterOrdinal?: number): SubMesh => {
    const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
    mesh.alphaIndex = alphaIndex;
    if (emitterOrdinal !== undefined) mesh.metadata = { nativeEmitterOrdinal: emitterOrdinal };
    const subMesh = mesh.subMeshes[0]!;
    subMesh._alphaIndex = alphaIndex;
    subMesh._distanceToCamera = distanceToCamera;
    return subMesh;
  };
  return { scene, subMeshAt };
}

const namesInOrder = (subMeshes: readonly SubMesh[]) => [...subMeshes].sort(compareTransparentSubMeshes).map(subMesh => subMesh.getMesh().name);

describe("transparent rendering order", () => {
  it("draws farther transparent meshes first and ignores alphaIndex", () => {
    const { subMeshAt } = sceneWithMeshes();
    const water = subMeshAt("water sheet", 10, 0), nearEffect = subMeshAt("near effect", 4, 99), farEffect = subMeshAt("far effect", 20, -5);
    expect(namesInOrder([nearEffect, water, farEffect])).toEqual(["far effect", "water sheet", "near effect"]);
  });

  it("orders equal distances by the per-actor emitter ordinal and keeps meshes without one in place", () => {
    const { subMeshAt } = sceneWithMeshes();
    const third = subMeshAt("emitter 2", 5, 0, 2), first = subMeshAt("emitter 0", 5, 7, 0), second = subMeshAt("emitter 1", 5, 3, 1);
    expect(namesInOrder([third, first, second])).toEqual(["emitter 0", "emitter 1", "emitter 2"]);
    const plain = subMeshAt("plain", 5, 0);
    expect(compareTransparentSubMeshes(plain, first)).toBe(0);
    expect(compareTransparentSubMeshes(first, first)).toBe(0);
  });

  it("installs the one comparator on every rendering group once per scene and restores the default on release", () => {
    const { scene } = sceneWithMeshes();
    const setRenderingOrder = vi.spyOn(scene, "setRenderingOrder");
    const release = installTransparentRenderingOrder(scene);
    const groupCount = RenderingManager.MAX_RENDERINGGROUPS - RenderingManager.MIN_RENDERINGGROUPS;
    expect(setRenderingOrder).toHaveBeenCalledTimes(groupCount);
    for (const call of setRenderingOrder.mock.calls) expect(call.slice(1)).toEqual([null, null, compareTransparentSubMeshes]);
    expect(() => installTransparentRenderingOrder(scene)).toThrow("already has the transparent rendering order");
    release(); release();
    expect(setRenderingOrder).toHaveBeenCalledTimes(groupCount * 2);
    expect(setRenderingOrder.mock.calls.at(-1)!.slice(1)).toEqual([null, null, null]);
    releases.push(installTransparentRenderingOrder(scene));
  });
});

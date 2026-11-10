import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PickingInfo } from "@babylonjs/core/Collisions/pickingInfo";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Ray } from "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray";
import { sampleFootstepSurfaceContact } from "../../src/runtime/footstepSurfaceContact";

const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); vi.restoreAllMocks(); });

function surfaceScene() {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const terrain = MeshBuilder.CreateBox("20_21.TerrainInfo0", { size: 1 }, scene);
  const body = MeshBuilder.CreateBox("fighter body", { size: 1 }, scene);
  body.metadata = { clientEntityId: "local-player" };
  const rays: Ray[] = [];
  let acceptsMesh: ((mesh: AbstractMesh) => boolean) | undefined;
  const acceptsAlone = (predicate: ((mesh: AbstractMesh, thinInstanceIndex: number) => boolean) | undefined) => predicate === undefined ? undefined : (mesh: AbstractMesh) => predicate(mesh, -1);
  const pickedTerrain = Object.assign(new PickingInfo(), { hit: true, pickedMesh: terrain, pickedPoint: new Vector3(1, .02, 1), faceId: 7 });
  const pick = vi.spyOn(scene, "pickWithRay").mockImplementation((ray, predicate) => { rays.push(ray); acceptsMesh = acceptsAlone(predicate); return pickedTerrain; });
  return { scene, terrain, body, rays, pick, acceptsMesh: () => acceptsMesh! };
}

describe("footstep surface contact", () => {
  it("names the mesh and triangle under the presented feet as one support sample from a downward probe", () => {
    const { scene, terrain, rays } = surfaceScene();
    const contact = sampleFootstepSurfaceContact(scene, { x: 1, y: .1, z: 1 }, .5)!;
    expect(rays[0]!.origin.asArray()).toEqual([1, .6, 1]);
    expect(rays[0]!.direction.asArray()).toEqual([0, -1, 0]);
    expect(rays[0]!.length).toBe(1);
    expect(contact).toEqual({ queryPosition: { x: 1, y: .1, z: 1 }, position: { x: 1, y: .02, z: 1 }, controllingSample: 0,
      samples: [{ meshId: terrain.id, meshUniqueId: terrain.uniqueId, meshName: terrain.name, indexOffset: 21, triangleIndex: 7, position: { x: 1, y: .02, z: 1 } }] });
  });

  it("probes only enabled pickable surface meshes, never an actor body, and answers null without a hit or without feet", () => {
    const { scene, terrain, body, pick, acceptsMesh } = surfaceScene();
    sampleFootstepSurfaceContact(scene, { x: 1, y: .1, z: 1 }, .5);
    expect(acceptsMesh()(terrain)).toBe(true);
    expect(acceptsMesh()(body)).toBe(false);
    terrain.isPickable = false;
    expect(acceptsMesh()(terrain)).toBe(false);
    pick.mockReturnValue(new PickingInfo());
    expect(sampleFootstepSurfaceContact(scene, { x: 1, y: 3, z: 1 }, .5)).toBeNull();
    expect(sampleFootstepSurfaceContact(scene, null, .5)).toBeNull();
    expect(sampleFootstepSurfaceContact(scene, { x: Number.NaN, y: 0, z: 0 }, .5)).toBeNull();
  });
});

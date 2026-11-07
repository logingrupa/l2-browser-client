import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { createFootstepGroundSampler } from "../../src/audio/footstepSurfaceGround";
import { resolveFootstepSurface } from "../../src/audio/footstepSurfaceAuto";
import { createFootstepDecoGrassField } from "../../src/assets/native/loadNativeStepDecoGrass";
import type { WorldGroundContact } from "../../src/world/WorldNavigation";

const disposals: (() => void)[] = [];
afterEach(() => { for (const dispose of disposals.splice(0).reverse()) dispose(); });
function world() {
  const engine = new NullEngine(), scene = new Scene(engine);
  disposals.push(() => { scene.dispose(); engine.dispose(); });
  return scene;
}
function quad(scene: Scene, name: string, metadata: unknown, parent?: TransformNode) {
  const mesh = new Mesh(name, scene), data = new VertexData();
  data.positions = [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10]; data.indices = [0, 1, 2, 0, 2, 3];
  data.applyToMesh(mesh); mesh.metadata = metadata;
  if (parent) mesh.parent = parent;
  return mesh;
}
const contact = (mesh: Mesh, x: number, z: number): WorldGroundContact => ({ queryPosition: { x, y: 0, z }, position: { x, y: 0, z },
  controllingSample: 0, samples: [{ meshId: mesh.id, meshUniqueId: mesh.uniqueId, meshName: mesh.name, indexOffset: 0, triangleIndex: 0, position: { x, y: 0, z } }] });
/** Two quads of 128 units at native X 0..256, Y 0..128: left sparse, right dense. */
const field = createFootstepDecoGrassField({ terrain: "20_20.TerrainInfo0", quads: [2, 1], quadSize: [128, 128], origin: [0, 0],
  sectors: [[0, 0, 2, 1]], perQuad: Float32Array.from([0, 8]), radius: 64, threshold: 2 }, { manifestSha256: "a".repeat(64), ruleId: "rule" });

describe("footstep ground context from the accepted support", () => {
  it("reads the expected deco count at the support's native XY (x · 100, z · 100) on terrain only", () => {
    const scene = world(), sampler = createFootstepGroundSampler(scene, { decoGrass: field, sourceUnitsPerMetre: 100 });
    disposals.push(() => sampler.dispose());
    const terrain = quad(scene, "20_20.TerrainInfo0", { worldTerrain: true, gltf: { extras: { nativeObject: "20_20.TerrainInfo0" } } });
    const dense = sampler.describe(contact(terrain, 1.92, .64));
    expect(dense).toMatchObject({ kind: "terrain", sourceId: "20_20.TerrainInfo0", nativeXY: [192, 64], footVolume: null,
      decoGrass: { status: "sampled", grass: true, quad: [1, 0] } });
    expect(resolveFootstepSurface(dense, null).group).toBe("GRASS");
    const sparse = sampler.describe(contact(terrain, .32, .64));
    expect(sparse.decoGrass).toMatchObject({ grass: false, expected: 0 }); expect(resolveFootstepSurface(sparse, null).group).toBe("LAND");
    expect(sampler.describe(contact(terrain, 9, .64)).decoGrass?.status).toBe("outside-terrain");
    expect(sampler.inspection()).toMatchObject({ decoGrass: { manifest: "a".repeat(64), ruleId: "rule" }, sourceUnitsPerMetre: 100, disposed: false });
  });

  it("classifies placement, BSP, terrain-patch and unmarked mesh support by source markers", () => {
    const scene = world(), sampler = createFootstepGroundSampler(scene, { decoGrass: field });
    disposals.push(() => sampler.dispose());
    const root = new TransformNode("placement", scene); root.metadata = { nativePlacement: { id: "interlude:20_20.StaticMeshActor930" } };
    const stair = quad(scene, "stair", null, root);
    const bsp = quad(scene, "floor", { nativeBsp: { id: "interlude:20_20.Model798.Brush397" } });
    const patch = quad(scene, "patch", { nativeTerrainPatch: { id: "interlude:20_20.TerrainInfo0.TerrainSector247" } });
    const otherTerrain = quad(scene, "other", { nativeTerrainPatch: { id: "interlude:21_20.TerrainInfo0.TerrainSector1" } });
    const plain = quad(scene, "editor mesh", null);
    expect(sampler.describe(contact(stair, 1, 1))).toMatchObject({ kind: "placement", sourceId: "interlude:20_20.StaticMeshActor930", decoGrass: null });
    expect(sampler.describe(contact(bsp, 1, 1))).toMatchObject({ kind: "bsp", sourceId: "interlude:20_20.Model798.Brush397", decoGrass: null });
    expect(sampler.describe(contact(patch, 1.92, .64))).toMatchObject({ kind: "terrain-patch", decoGrass: { grass: true } });
    expect(sampler.describe(contact(otherTerrain, 1.92, .64)).decoGrass).toBeNull();
    expect(sampler.describe(contact(plain, 1, 1))).toMatchObject({ kind: "mesh", sourceId: null });
    expect(sampler.describe(null)).toMatchObject({ kind: "none" });
    const stale = contact(plain, 1, 1); (stale.samples[0] as { meshId: string }).meshId = "other";
    expect(sampler.describe(stale)).toMatchObject({ kind: "mesh", detail: "support mesh unresolved at dispatch" });
    const ambiguous = quad(scene, "ambiguous", { nativeBsp: { id: "b" } }, root);
    expect(sampler.describe(contact(ambiguous, 1, 1))).toMatchObject({ kind: "mesh", detail: "multiple source markers" });
  });

  it("leaves terrain without staged deco data to LAND, rejects a bad unit scale and stops after dispose", () => {
    const scene = world(), sampler = createFootstepGroundSampler(scene);
    const terrain = quad(scene, "terrain", { worldTerrain: true });
    sampler.preload([terrain]);
    const context = sampler.describe(contact(terrain, 1, 1));
    expect(context).toMatchObject({ kind: "terrain", decoGrass: null }); expect(resolveFootstepSurface(context, null).group).toBe("LAND");
    expect(() => createFootstepGroundSampler(scene, { sourceUnitsPerMetre: 0 })).toThrow("unit scale");
    sampler.dispose(); sampler.dispose();
    expect(sampler.describe(contact(terrain, 1, 1)).kind).toBe("none"); expect(sampler.inspection().disposed).toBe(true);
  });
});

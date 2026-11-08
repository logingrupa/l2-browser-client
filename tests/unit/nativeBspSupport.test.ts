import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { attachNativeBspSupport } from "../../src/scene/world/nativeBspSupport";
import type { NativeSectionManifest } from "../../src/scene/world/loadNativeSection";
import { createWorldNavigation } from "../../src/scene/navigation/meshNavigation";

const scenes: Scene[] = [];
afterEach(() => { for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });
function fixture() {
  const scene = new Scene(new NullEngine()); scenes.push(scene);
  const root = new TransformNode("source building", scene);
  const stairs = MeshBuilder.CreateBox("stairs", {}, scene); stairs.parent = root;
  const material = new StandardMaterial("source stone", scene);
  material.metadata = { gltf: { extras: { nativeSlotProperties: { EnableCollision: true } } } }; stairs.material = material;
  const slab = MeshBuilder.CreateBox("final BSP", {}, scene);
  const manifest = { placements: [], bsp: [{ supportPlacementIds: ["source-building"] }] } as unknown as NativeSectionManifest;
  return { scene, root, stairs, material, slab, manifest };
}
function placement(manifest: NativeSectionManifest, id: string, modelId = "interlude:Fixture.Stairs") {
  manifest.placements.push({ id, modelId, sourceMesh: modelId.substring("interlude:".length), matrix: [...Matrix.IdentityReadOnly.asArray()], materialOverrides: [] });
}
describe("native static placement and qualified BSP support", () => {
  it("uses actual authored geometry and restores metadata/pickability without changing assets", () => {
    const { root, stairs, slab, manifest } = fixture();
    root.position.set(3, 2, 1); root.scaling.x = -1;
    const metadata = { authoredNote: "keep", worldSupportsWalking: false };
    stairs.metadata = metadata; stairs.isPickable = false;
    const owner = attachNativeBspSupport(manifest, new Map([["source-building", root]]), [slab]);
    expect(owner.meshes).toEqual([slab, stairs]);
    expect(stairs.metadata).toMatchObject({ authoredNote: "keep", worldSupportsWalking: false, worldCollision: true });
    expect(stairs.isPickable).toBe(true); expect(root.position.asArray()).toEqual([3, 2, 1]); expect(root.scaling.x).toBe(-1);
    owner.dispose(); owner.dispose(); expect(stairs.metadata).toBe(metadata); expect(stairs.isPickable).toBe(false);
    expect(slab.metadata).toBeNull(); expect(slab.isDisposed()).toBe(false);
  });
  it("honours explicit source and authored exclusions and never includes unqualified scenery", () => {
    const { scene, root, stairs, slab, manifest, material } = fixture();
    material.metadata.gltf.extras.nativeSlotProperties.EnableCollision = false;
    slab.metadata = { worldCollision: false };
    const unqualified = MeshBuilder.CreateBox("animated flame", {}, scene); unqualified.material = material;
    const owner = attachNativeBspSupport(manifest, new Map([["source-building", root]]), [slab]);
    expect(owner.meshes).toEqual([]); expect(stairs.metadata).toBeNull(); expect(unqualified.metadata).toBeNull(); owner.dispose();
  });
  it("rejects missing support roots and unresolved declarations before mutating meshes", () => {
    const { root, stairs, slab, manifest, material } = fixture();
    expect(() => attachNativeBspSupport(manifest, new Map(), [slab])).toThrow(/missing/);
    material.metadata = {};
    expect(() => attachNativeBspSupport(manifest, new Map([["source-building", root]]), [slab])).toThrow(/declaration/);
    expect(stairs.metadata).toBeNull(); expect(slab.metadata).toBeNull();
  });

  it("admits separately declared static placement slots without widening the BSP relationship", () => {
    const { scene, root, stairs, material, slab, manifest } = fixture();
    const interior = new TransformNode("independent interior stairs", scene);
    const ramp = MeshBuilder.CreateBox("ramp", {}, scene); ramp.parent = interior; ramp.material = material;
    const excluded = MeshBuilder.CreateBox("source collision disabled", {}, scene); excluded.parent = interior;
    const disabled = new StandardMaterial("foliage", scene); disabled.metadata = { gltf: { extras: { nativeSlotProperties: { EnableCollision: false } } } };
    excluded.material = disabled;
    const unknown = MeshBuilder.CreateBox("unknown source slot", {}, scene); unknown.parent = interior;
    placement(manifest, "interior-stairs");
    const before = JSON.stringify(manifest);
    const owner = attachNativeBspSupport(manifest, new Map([["source-building", root], ["interior-stairs", interior]]), [slab]);
    expect(owner.meshes.map(mesh => mesh.name)).toEqual([slab.name, stairs.name, ramp.name]);
    expect(unknown.metadata).toBeNull(); expect(excluded.metadata).toBeNull();
    expect(JSON.stringify(manifest)).toBe(before);
    owner.dispose(); expect(ramp.metadata).toBeNull(); expect(ramp.material).toBe(material);
  });

  it("excludes runtime-effect models, explicit effect placements and diagnostic graph materials even with collision true", () => {
    const { scene, root, material, manifest } = fixture();
    const placements = new Map([["source-building", root]]);
    for (const [id, model] of [["effect-first", "interlude:Fixture.Effect"], ["effect-second", "interlude:Fixture.Effect"],
      ["explicit-effect", "interlude:Fixture.Other"], ["graph-slot", "interlude:Fixture.Graph"]]) {
      placement(manifest, id!, model!);
      const node = new TransformNode(id!, scene), mesh = MeshBuilder.CreateBox(id!, {}, scene); mesh.parent = node; mesh.material = material;
      placements.set(id!, node);
      if (id === "graph-slot") {
        const diagnostic = new StandardMaterial("source graph diagnostic", scene);
        diagnostic.metadata = { gltf: { extras: { nativeSlotProperties: { EnableCollision: true }, nativeMaterialGraph: "native-materials/graph.json", nativeRuntimeStatus: "unsupported-diagnostic" } } };
        mesh.material = diagnostic;
      }
    }
    manifest.unsupportedRuntimeMaterials = [{ modelId: "interlude:Fixture.Effect", sourceObject: "Fixture.Effect", runtimeStatus: "unsupported-diagnostic",
      graphManifest: "native-materials/graph.json", runtimeGaps: ["billboard"], placementIds: ["effect-first", "explicit-effect"] }];
    const owner = attachNativeBspSupport(manifest, placements, []);
    expect(owner.meshes).toEqual(root.getChildMeshes());
    for (const [id, node] of placements) if (id !== "source-building") expect(node.getChildMeshes()[0]!.metadata).toBeNull();
    owner.dispose();
  });

  it("keeps authored collision and walking exclusions on independently admitted scenery", () => {
    const { scene, root, material, manifest } = fixture();
    const interior = new TransformNode("interior", scene); placement(manifest, "interior");
    const omitted = MeshBuilder.CreateBox("no collider", {}, scene), barrier = MeshBuilder.CreateBox("not a floor", {}, scene);
    omitted.parent = barrier.parent = interior; omitted.material = barrier.material = material;
    const omittedMetadata = { worldCollision: false, authored: true }, barrierMetadata = { worldSupportsWalking: false, authored: true };
    omitted.metadata = omittedMetadata; barrier.metadata = barrierMetadata; omitted.isPickable = barrier.isPickable = false;
    const owner = attachNativeBspSupport(manifest, new Map([["source-building", root], ["interior", interior]]), []);
    expect(owner.meshes).not.toContain(omitted); expect(owner.meshes).toContain(barrier);
    expect(omitted.metadata).toBe(omittedMetadata); expect(omitted.isPickable).toBe(false);
    expect(barrier.metadata).toMatchObject({ worldSupportsWalking: false, worldCollision: true, authored: true });
    owner.dispose(); expect(barrier.metadata).toBe(barrierMetadata); expect(barrier.isPickable).toBe(false);
  });

  it("does not turn an animated placement into cached static collision", () => {
    const { scene, root, material, manifest } = fixture();
    const animated = new TransformNode("animated placement", scene); placement(manifest, "animated");
    const mesh = MeshBuilder.CreateBox("animated child", {}, scene); mesh.parent = animated; mesh.material = material;
    const group = new AnimationGroup("source motion", scene);
    const animation = new Animation("translation", "position.y", 30, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([{ frame: 0, value: 0 }, { frame: 30, value: 1 }]); group.addTargetedAnimation(animation, animated);
    const owner = attachNativeBspSupport(manifest, new Map([["source-building", root], ["animated", animated]]), []);
    expect(owner.meshes).not.toContain(mesh); expect(mesh.metadata).toBeNull(); owner.dispose();
  });

  it.each([1, -1])("supports an independent ramp with actual edited transforms and mirrored scale %s", scale => {
    const { scene, root, material, manifest } = fixture();
    const interior = new TransformNode("editable independent stairs", scene); placement(manifest, "indoor-stairs");
    interior.position.set(3, 2, 7); interior.scaling.x = scale;
    const ramp = new Mesh("ramp", scene), vertices = new VertexData();
    vertices.positions = [-2, 0, -1, -2, 0, 1, 2, 1, 1, 2, 1, -1]; vertices.indices = [0, 1, 2, 0, 2, 3]; vertices.applyToMesh(ramp);
    ramp.parent = interior; ramp.material = material;
    const matrix = interior.computeWorldMatrix(true), low = Vector3.TransformCoordinates(new Vector3(-1, .25, 0), matrix), high = Vector3.TransformCoordinates(new Vector3(1, .75, 0), matrix);
    const options = { terrainMeshes: [], origin: low, capsule: { radius: .09, height: .46 } };
    expect(createWorldNavigation({ ...options, obstacleMeshes: () => [] }).ground(low)).toBeNull();
    const owner = attachNativeBspSupport(manifest, new Map([["source-building", root], ["indoor-stairs", interior]]), []);
    const navigation = createWorldNavigation({ ...options, obstacleMeshes: () => owner.meshes });
    const from = navigation.ground(low);
    expect(from).not.toBeNull();
    const result = navigation.move(from!, high);
    expect(result.blocked).toBe(false); expect(result.position.y - from!.y).toBeCloseTo(.5, 6);
    expect(interior.position.asArray()).toEqual([3, 2, 7]); expect(interior.scaling.x).toBe(scale);
    owner.dispose(); expect(ramp.metadata).toBeNull();
  });
});

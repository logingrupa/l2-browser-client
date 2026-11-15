import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { inspectNativeGroundContact } from "../../src/scene/world/nativeGroundContact";
import type { NativeSection, NativeSectionManifest } from "../../src/scene/world/loadNativeSection";
import type { WorldGroundContact } from "../../src/world/WorldNavigation";

const scenes: Scene[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });
const resource = (file: string) => ({ file, sha256: "a".repeat(64), bytes: 100 });
function fixture() {
  const scene = new Scene(new NullEngine()); scenes.push(scene);
  const mesh = new Mesh("support", scene);
  mesh.setVerticesData("position", [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
  mesh.setIndices([0, 2, 1, 1, 2, 3]);
  const material = new StandardMaterial("authored stone", scene); mesh.material = material;
  material.metadata = { gltf: { extras: { nativeSourceReference: "Source.Stone", nativeSectionIndex: 0 } } };
  const manifest: NativeSectionManifest = { schemaVersion: 1, kind: "native-map-section-runtime", resourceRoots: { terrain: "../map-section", models: "../map-section-models" },
    terrain: { ...resource("terrain.glb"), materialStatus: "source" }, models: [], placements: [], support: "section-products-ready-for-runtime-validation", errors: [], gaps: [] };
  const terrainMeshes: Mesh[] = [];
  const section = { manifest, manifestSha256: "b".repeat(64), terrainMeshes, minimum: Vector3.Zero(), maximum: Vector3.One(), spawnCandidate: null } as unknown as NativeSection;
  return { scene, mesh, material, manifest, section, terrainMeshes };
}
function contact(mesh: Mesh, offsets = Array(9).fill(0) as number[]): WorldGroundContact {
  return { queryPosition: { x: .2, y: 1, z: .2 }, position: { x: .2, y: 0, z: .2 }, controllingSample: 4,
    samples: offsets.map((indexOffset, i) => ({ meshId: mesh.id, meshUniqueId: mesh.uniqueId, meshName: mesh.name, indexOffset, triangleIndex: indexOffset / 3,
      position: { x: i / 100, y: 0, z: .2 } })) };
}
function addPlacement(scene: Scene, manifest: NativeSectionManifest, id: string) {
  const modelId = "interlude:Source.Building";
  if (!manifest.models.length) manifest.models.push({ id: modelId, sourceObject: "Source.Building", model: resource("building/model.glb"), archive: resource("building/asset.l2asset") });
  const placement = { id, modelId, sourceMesh: "Source.Building", matrix: [...Matrix.Translation(1, 2, 3).asArray()], materialOverrides: [] };
  manifest.placements.push(placement);
  const root = new TransformNode(id, scene); root.metadata = { nativePlacement: structuredClone(placement) };
  return root;
}
const firstMaterial = (value: ReturnType<typeof inspectNativeGroundContact>) => value.triangleReferences[0]!.material;
const firstSource = (value: ReturnType<typeof inspectNativeGroundContact>) => value.meshReferences[0]!.source!;

describe("accepted native-world support inspection", () => {
  it("keeps no-contact distinct from any new ground query or native surface claim", () => {
    const { scene, section } = fixture(); const pick = vi.spyOn(scene, "pickWithRay");
    const result = inspectNativeGroundContact(scene, null, section);
    expect(result).toMatchObject({ policy: "local-accepted-capsule-support", nativeSurfaceVerified: false, nativeTopologyVerified: false,
      materialObservation: "inspection-time-live-state", contact: null, meshReferences: [], triangleReferences: [], samples: [] });
    expect(pick).not.toHaveBeenCalled(); expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("copies the original nine-sample decision and shares repeated live identities", () => {
    const { scene, mesh, section } = fixture(), original = contact(mesh), before = structuredClone(original);
    const result = inspectNativeGroundContact(scene, original, section);
    expect(result.contact).toEqual(before); expect(result.contact).not.toBe(original); expect(result.contact!.samples[0]!.position).not.toBe(original.samples[0]!.position);
    expect(result.samples).toHaveLength(9); expect(result.meshReferences).toHaveLength(1); expect(result.triangleReferences).toHaveLength(1);
    expect(result.samples.every(row => row.meshReference === 0 && row.triangleReference === 0)).toBe(true);
    expect(result.contact!.controllingSample).toBe(4); result.contact!.samples[0]!.position.y = 99; expect(original).toEqual(before);
  });

  it("joins two placements of one model through every zero-vertex ancestor", () => {
    const { scene, mesh, section, manifest } = fixture();
    const rootA = addPlacement(scene, manifest, "placement-a"), rootB = addPlacement(scene, manifest, "placement-b");
    const empty = new Mesh("zero vertex import root", scene), middle = new TransformNode("authored helper", scene);
    empty.parent = rootA; middle.parent = empty; mesh.parent = middle;
    const other = mesh.clone("same model second instance", rootB)!;
    const a = inspectNativeGroundContact(scene, contact(mesh), section), b = inspectNativeGroundContact(scene, contact(other), section);
    expect(a.meshReferences[0]!.ancestry.map(node => node.name)).toEqual([mesh.name, middle.name, empty.name, rootA.name]);
    expect(firstSource(a)).toMatchObject({ status: "metadata-linked", kind: "placement", rootUniqueId: rootA.uniqueId, manifestRecord: { id: "placement-a" }, model: { id: "interlude:Source.Building" } });
    expect(firstSource(b)).toMatchObject({ status: "metadata-linked", rootUniqueId: rootB.uniqueId, manifestRecord: { id: "placement-b" } });
  });

  it("preserves authored transforms separately from the source placement matrix", () => {
    const { scene, mesh, section, manifest, material } = fixture(), root = addPlacement(scene, manifest, "authored-placement");
    mesh.parent = root; root.setPreTransformMatrix(Matrix.FromArray(manifest.placements[0]!.matrix));
    root.position.set(9, 4, -3); root.scaling.set(-2, 3, .5); root.rotation.y = .4; mesh.position.x = 7;
    root.computeWorldMatrix(true); mesh.computeWorldMatrix(true);
    const before = { source: JSON.stringify(manifest), metadata: root.metadata, position: root.position.asArray(), scaling: root.scaling.asArray(),
      world: [...root.getWorldMatrix().asArray()], meshWorld: [...mesh.getWorldMatrix().asArray()], pivot: [...root.getPivotMatrix().asArray()] };
    const result = inspectNativeGroundContact(scene, contact(mesh), section);
    expect(firstSource(result).status).toBe("metadata-linked");
    expect(result.meshReferences[0]!.ancestry.at(-1)!.transform?.worldMatrix).toEqual(before.world);
    expect(root.position.asArray()).toEqual(before.position); expect(root.scaling.asArray()).toEqual(before.scaling);
    expect([...mesh.getWorldMatrix().asArray()]).toEqual(before.meshWorld); expect([...root.getPivotMatrix().asArray()]).toEqual(before.pivot);
    expect(root.metadata).toBe(before.metadata); expect(mesh.material).toBe(material); expect(JSON.stringify(manifest)).toBe(before.source);
  });

  it("leaves missing or mismatched placement sources unresolved", () => {
    const { scene, mesh, section, manifest } = fixture();
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section)).reason).toBe("source-marker-missing");
    const root = addPlacement(scene, manifest, "placement"); mesh.parent = root;
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), null)).reason).toBe("section-missing");
    root.metadata.nativePlacement.matrix[12]++;
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section)).reason).toBe("placement-source-identity-or-matrix-differs");
  });

  it("does not choose between nested or duplicated placement roots", () => {
    const { scene, mesh, section, manifest } = fixture(), root = addPlacement(scene, manifest, "placement"); mesh.parent = root;
    const outer = new TransformNode("nested marker", scene); outer.metadata = structuredClone(root.metadata); root.parent = outer;
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section))).toMatchObject({ status: "ambiguous", reason: "multiple-source-markers" });
    root.parent = null;
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section))).toMatchObject({ status: "ambiguous", reason: "duplicate-placement-root" });
  });

  it("resolves triangle-covering multi-material slots rather than parent material", () => {
    const { scene, mesh, section, material } = fixture();
    const second = new StandardMaterial("other live slot", scene); second.metadata = { nativeSourceReference: "direct.Reference", gltf: { extras: { nativeSourceReference: "Source.Metal", nativeSectionIndex: 11 } } };
    const multi = new MultiMaterial("container material", scene); multi.subMaterials = [material, second]; mesh.material = multi;
    mesh.subMeshes = []; new SubMesh(0, 0, 4, 0, 3, mesh); new SubMesh(1, 0, 4, 3, 3, mesh);
    const result = inspectNativeGroundContact(scene, contact(mesh, [0, 3, 0, 3, 0, 3, 0, 3, 0]), section);
    expect(result.triangleReferences).toHaveLength(2);
    expect(result.triangleReferences[0]!.material).toMatchObject({ status: "resolved", localIndicesAtInspection: [0, 2, 1], candidates: [{ materialIndex: 0, material: { id: material.id, sourceGltfExtras: { nativeSectionIndex: 0 } } }] });
    expect(result.triangleReferences[1]!.material).toMatchObject({ status: "resolved", localIndicesAtInspection: [1, 2, 3], candidates: [{ materialIndex: 1, material: {
      id: second.id, sourceMetadata: { nativeSourceReference: "direct.Reference" }, sourceGltfExtras: { nativeSourceReference: "Source.Metal", nativeSectionIndex: 11 } } }] });
  });

  it("reports overlapping, uncovered and absent materials explicitly", () => {
    const { scene, mesh, section } = fixture();
    mesh.subMeshes = []; new SubMesh(0, 0, 4, 0, 6, mesh); new SubMesh(0, 0, 4, 0, 3, mesh);
    expect(firstMaterial(inspectNativeGroundContact(scene, contact(mesh), section)).status).toBe("ambiguous");
    mesh.subMeshes = []; new SubMesh(0, 0, 4, 0, 4, mesh);
    expect(firstMaterial(inspectNativeGroundContact(scene, contact(mesh, Array(9).fill(3)), section)).status).toBe("uncovered");
    mesh.subMeshes = []; new SubMesh(0, 0, 4, 0, 6, mesh); mesh.material = null;
    // Babylon can supply an existing scene default even when mesh.material is
    // null. Keep that real effective binding; test absence at the actual API.
    expect(firstMaterial(inspectNativeGroundContact(scene, contact(mesh), section)).status).toBe("resolved");
    vi.spyOn(mesh.subMeshes[0]!, "getMaterial").mockReturnValue(null);
    expect(firstMaterial(inspectNativeGroundContact(scene, contact(mesh), section)).status).toBe("no-material");
  });

  it("observes the current effective render-pass material without overwriting either binding", () => {
    const { scene, mesh, section, material } = fixture(), override = new StandardMaterial("live pass override", scene);
    override.metadata = { gltf: { extras: { nativeSourceReference: "Source.Override", nativeSectionIndex: 7 } } };
    const pass = scene.getEngine().createRenderPassId("test"); mesh.setMaterialForRenderPass(pass, override); scene.getEngine().currentRenderPassId = pass;
    const result = inspectNativeGroundContact(scene, contact(mesh), section);
    expect(firstMaterial(result)).toMatchObject({ status: "resolved", renderPassId: pass, candidates: [{ material: { id: override.id } }] });
    expect(mesh.material).toBe(material); expect(mesh.getMaterialForRenderPass(pass)).toBe(override);
  });

  it("never substitutes a same-id mesh for a missing, disposed or changed captured mesh", () => {
    const { scene, mesh, section } = fixture(), original = contact(mesh);
    mesh.id = "new authored id";
    expect(inspectNativeGroundContact(scene, original, section).meshReferences[0]!.resolution).toBe("captured-id-differs");
    mesh.dispose(); const replacement = new Mesh("same name", scene); replacement.id = original.samples[0]!.meshId;
    const result = inspectNativeGroundContact(scene, original, section);
    expect(result.meshReferences[0]!.resolution).toBe("missing-or-disposed"); expect(firstMaterial(result).status).toBe("mesh-unavailable");
  });

  it("joins exact BSP resource records but does not qualify local indices as native polygons", () => {
    const { scene, mesh, section, manifest } = fixture();
    const bsp = { id: "source-bsp", sourceModel: "20_20.Model798", sourceBrush: "20_20.Brush7", sourceMapSha256: "c".repeat(64),
      model: resource("bsp-floor.glb"), source: resource("bsp-floor.json"), supportPlacementIds: ["building"] };
    manifest.bsp = [bsp]; mesh.metadata = { nativeBsp: structuredClone(bsp) };
    const result = inspectNativeGroundContact(scene, contact(mesh), section);
    expect(firstSource(result)).toMatchObject({ status: "metadata-linked", kind: "bsp", manifestRecord: bsp }); expect(result.nativeTopologyVerified).toBe(false);
    mesh.metadata.nativeBsp.sourceMapSha256 = "d".repeat(64);
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section)).reason).toBe("source-resource-record-differs");
  });

  it("keeps primary terrain and an exact patch linked to their separate resources", () => {
    const { scene, mesh, section, manifest, terrainMeshes } = fixture(); terrainMeshes.push(mesh);
    mesh.metadata = { worldTerrain: true, gltf: { extras: { nativeObject: "20_20.TerrainInfo0", nativeSectorObjects: ["20_20.Sector0"] } } };
    const primary = inspectNativeGroundContact(scene, contact(mesh), section);
    expect(firstSource(primary)).toMatchObject({ status: "metadata-linked", kind: "primary-terrain", manifestRecord: manifest.terrain });
    const patch = { id: "patch", sourceTerrain: "20_20.TerrainInfo0", sourceSector: "20_20.TerrainInfo0.TerrainSector247", sourceMapSha256: "c".repeat(64),
      gridBounds: [112, 240, 128, 255] as [number, number, number, number], model: resource("terrain247.glb"), source: resource("terrain247.json") };
    manifest.terrainPatches = [patch]; mesh.metadata.nativeTerrainPatch = structuredClone(patch);
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section))).toMatchObject({ status: "metadata-linked", kind: "terrain-patch", manifestRecord: patch });
    terrainMeshes.length = 0;
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section)).reason).toBe("patch-outside-current-section-terrain");
    delete mesh.metadata.nativeTerrainPatch; terrainMeshes.push(mesh); delete mesh.metadata.gltf.extras.nativeObject;
    expect(firstSource(inspectNativeGroundContact(scene, contact(mesh), section)).reason).toBe("terrain-source-object-missing");
  });

  it("rejects stale local index ranges and keeps unrelated circular metadata out of output", () => {
    const { scene, mesh, section, material } = fixture(); material.metadata.self = material.metadata;
    const original = contact(mesh, Array(9).fill(6));
    const result = inspectNativeGroundContact(scene, original, section);
    expect(firstMaterial(result).status).toBe("local-triangle-unavailable"); expect(firstMaterial(result).candidates).toEqual([]);
    expect(() => JSON.stringify(inspectNativeGroundContact(scene, contact(mesh), section))).not.toThrow();
  });
});

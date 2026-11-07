import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { LoadAssetContainer } from "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/groundMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Materials/colorCurves";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { attachAuthoredNativeSection, type AuthoredNativeSection } from "../../src/scene/world/loadAuthoredNativeSection";
import type { NativeSectionManifest } from "../../src/scene/world/loadNativeSection";

function manifest(): NativeSectionManifest {
  const hash = "a".repeat(64);
  return { schemaVersion: 1, kind: "native-map-section-runtime", support: "section-products-ready-for-runtime-validation", errors: [], gaps: ["Native shaders unverified"],
    resourceRoots: { terrain: "../map-section", models: "../map-section-models" },
    terrain: { file: "terrain.glb", sha256: hash, bytes: 100, materialStatus: "authored preview" },
    models: [{ id: "interlude:Fixture.Tree", sourceObject: "Fixture.Tree", model: { file: `${hash}/model.glb`, sha256: hash, bytes: 100 },
      archive: { file: `${hash}/asset.l2asset`, sha256: hash, bytes: 100 } }],
    placements: [{ id: "source-tree-0", modelId: "interlude:Fixture.Tree", sourceMesh: "Fixture.Tree", materialOverrides: [], matrix: [...Matrix.Translation(3, 1, 7).asArray()] },
      { id: "source-tree-1", modelId: "interlude:Fixture.Tree", sourceMesh: "Fixture.Tree", materialOverrides: [], matrix: [...Matrix.Translation(-2, 1, 5).asArray()] }],
    surfaceSpawnCandidate: { sourcePosition: [0, 500, 0], gltfGroundPosition: [0, 0, 5], nativeSpawnVerified: false, collisionVerified: false },
  };
}

describe("saved Editor native world attachment", () => {
  let engine: NullEngine, scene: Scene, sections: AuthoredNativeSection[], extraScenes: Scene[];
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; sections = []; extraScenes = []; });
  afterEach(() => { for (const section of sections) section.dispose(); for (const extra of extraScenes) extra.dispose(); scene.dispose(); engine.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function fixture() {
    const source = manifest(), root = new TransformNode("Authored native world", scene); root.scaling.z = -1;
    root.metadata = { nativeWorldRoot: { schemaVersion: 1, manifestSha256: "b".repeat(64), manifest: source } };
    const terrain = MeshBuilder.CreateGround("Native terrain", { width: 20, height: 20 }, scene); terrain.parent = root; terrain.position.z = 5;
    terrain.metadata = { worldTerrain: true, worldSupportsWalking: true, gltf: { extras: { nativeObject: "Fixture.Terrain", nativeLayers: ["saved provenance"] } } };
    const terrainMaterial = new StandardMaterial("Saved terrain PNG preview", scene); terrainMaterial.diffuseColor = new Color3(.3, .5, .7); terrain.material = terrainMaterial;
    const objectMaterial = new StandardMaterial("Saved edited bark", scene); objectMaterial.diffuseColor = new Color3(.4, .2, .1);
    const placements = source.placements.map((placement, index) => {
      const node = new TransformNode(`placement:${placement.id}`, scene); node.parent = root;
      node.metadata = { nativePlacement: structuredClone(placement) }; node.setPreTransformMatrix(Matrix.FromArray(placement.matrix));
      const mesh = MeshBuilder.CreateBox(`Source tree ${index}`, { size: 2 }, scene); mesh.parent = node; mesh.material = objectMaterial;
      return { node, mesh };
    });
    return { source, root, terrain, terrainMaterial, objectMaterial, placements };
  }
  function attach(target = scene, signal = new AbortController().signal) {
    const section = attachAuthoredNativeSection(target, signal); if (!section) throw Error("Missing authored fixture"); sections.push(section); return section;
  }
  const counts = () => ({ meshes: scene.meshes.length, transforms: scene.transformNodes.length, materials: scene.materials.length, textures: scene.textures.length });

  function bspFixture() {
    const value = fixture(), id = "interlude:20_20.StaticMeshActor940", hash = "e".repeat(64);
    value.source.placements[0]!.id = id; value.placements[0]!.node.metadata.nativePlacement.id = id;
    value.objectMaterial.metadata = { gltf: { extras: { nativeSlotProperties: { EnableCollision: true } } } };
    const resource = { id: "interlude:20_20.Model798.Brush397", sourceModel: "20_20.Model798", sourceBrush: "20_20.Brush397",
      sourceMapSha256: "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4",
      model: { file: "bsp-floor.glb", sha256: hash, bytes: 1024 }, source: { file: "bsp-floor.json", sha256: hash, bytes: 2048 }, supportPlacementIds: [id] };
    value.source.bsp = [resource];
    const slab = MeshBuilder.CreateBox("retained BSP slab", { width: 4, depth: 4, height: .3 }, scene);
    slab.parent = value.root; slab.sideOrientation = 0; slab.position.y = .5; slab.metadata = { nativeBsp: structuredClone(resource) };
    return { ...value, slab, resource };
  }

  it("attaches the source BSP and current authored building transforms with reversible support", () => {
    const value = bspFixture(), original = value.slab.metadata;
    value.placements[0]!.node.position.y = .75;
    const section = attach();
    expect(section.supportMeshes).toContain(value.slab); expect(section.supportMeshes).toContain(value.placements[0]!.mesh);
    // Static support is independent of the slab association. Both placements
    // have explicit source EnableCollision=true, using their live saved data.
    expect(section.supportMeshes).toContain(value.placements[1]!.mesh);
    expect(section.inspection()).toMatchObject({ bspMeshes: 1, bspTriangles: 12 });
    expect(value.slab.sideOrientation).toBe(1); expect(value.placements[0]!.node.position.y).toBe(.75);
    section.dispose(); expect(value.root.scaling.z).toBe(-1); expect(value.slab.sideOrientation).toBe(0); expect(value.slab.metadata).toBe(original);
    expect(value.placements[1]!.mesh.metadata).toBeNull();
    expect(value.placements[1]!.mesh.material).toBe(value.objectMaterial);
  });

  it("refuses missing or mismatched saved BSP instead of entering an incomplete world", () => {
    const value = bspFixture(); value.slab.metadata.nativeBsp.model.sha256 = "f".repeat(64);
    expect(() => attach()).toThrow(/BSP/); expect(value.root.scaling.z).toBe(-1);
    value.slab.dispose(); expect(() => attach()).toThrow(/BSP/); expect(value.root.scaling.z).toBe(-1);
  });

  it("uses the saved geometry/materials and retains authored edits independently of exact source placement metadata", () => {
    const value = fixture(), { root, terrain, placements, source } = value;
    placements[0]!.node.position.x = 1.25; placements[0]!.mesh.scaling.y = 1.5;
    placements[0]!.mesh.position.y = .4;
    const sourceBefore = JSON.stringify(root.metadata), pivotBefore = placements[0]!.node.getPivotMatrix().asArray().slice(), baseline = counts();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const section = attach();
    expect(root.scaling.asArray()).toEqual([1, 1, 1]); expect(section.terrainMeshes).toEqual([terrain]); expect(counts()).toEqual(baseline);
    expect(section.spawnCandidate?.asArray()).toEqual([0, 0, 5]); expect(section.maximum.z).toBe(15);
    const inspection = section.inspection();
    expect(inspection).toMatchObject({ authored: true, modelCount: 1, placementCount: 2, terrainTriangles: 2, finiteBounds: true,
      terrainMaterial: "editor-authored-source-materials", collisionVerified: false, visualParity: "unverified", placementTransformEdits: ["source-tree-0"] });
    expect(inspection.placements[0]!.sourceMatrix).toEqual(source.placements[0]!.matrix);
    expect(inspection.placements[0]!.worldMatrix[12]).toBeCloseTo(4.25);
    expect(inspection.placements[1]!.worldMatrix).toEqual(source.placements[1]!.matrix);
    expect(placements[0]!.mesh.scaling.y).toBe(1.5); expect(placements[0]!.mesh.position.y).toBe(.4);
    expect(terrain.material).toBe(value.terrainMaterial); expect(placements[0]!.mesh.material).toBe(value.objectMaterial);
    expect(placements[0]!.node.getPivotMatrix().asArray()).toEqual(pivotBefore); expect(JSON.stringify(root.metadata)).toBe(sourceBefore);
    expect(fetcher).not.toHaveBeenCalled();
    section.dispose(); section.dispose();
    expect(root.scaling.z).toBe(-1); expect(root.isDisposed()).toBe(false); expect(terrain.isDisposed()).toBe(false); expect(counts()).toEqual(baseline);
    expect(placements[0]!.node.position.x).toBe(1.25); expect(JSON.stringify(root.metadata)).toBe(sourceBefore);
  });

  it("attaches a real Babylon serialize/parse roundtrip with source pretransforms and authored child edits intact", async () => {
    const original = fixture(); original.placements[0]!.node.position.y = .75; original.placements[0]!.mesh.rotation.y = .4;
    original.terrain.sideOrientation = 0; original.placements[0]!.mesh.sideOrientation = 1;
    const data = await SceneSerializer.SerializeAsync(scene), restored = new Scene(engine); extraScenes.push(restored); restored.useRightHandedSystem = true;
    expect(data.meshes.map((mesh: { name: string }) => mesh.name)).toContain("Native terrain");
    LoadAssetContainer(restored, JSON.stringify(data), "", (message, error) => { throw error ?? new Error(message); }, true);
    expect(restored.meshes.map(mesh => mesh.name)).toContain("Native terrain");
    restored.useRightHandedSystem = true;
    const root = restored.transformNodes.find(node => node.metadata?.nativeWorldRoot)!;
    const placement = restored.transformNodes.find(node => node.metadata?.nativePlacement?.id === "source-tree-0")!;
    const savedMaterial = restored.getMeshByName("Native terrain")!.material;
    const parsedTerrain = restored.getMeshByName("Native terrain") as typeof original.terrain;
    const parsedTree = restored.getMeshByName("Source tree 0") as typeof original.placements[0]["mesh"];
    expect(parsedTerrain.sideOrientation).toBe(0); expect(parsedTree.sideOrientation).toBe(1);
    const section = attach(restored);
    expect(parsedTerrain.sideOrientation).toBe(1); expect(parsedTree.sideOrientation).toBe(0);
    expect(root.scaling.z).toBe(1); expect(placement.position.y).toBe(.75);
    expect(placement.getPivotMatrix().asArray()).toEqual(original.placements[0]!.node.getPivotMatrix().asArray());
    expect(restored.getMeshByName("Source tree 0")!.rotation.y).toBe(.4);
    expect(section.inspection().placements[0]!.worldMatrix[13]).toBeCloseTo(1.75);
    section.setTerrainPreview(false); section.dispose();
    expect(root.scaling.z).toBe(-1); expect(restored.getMeshByName("Native terrain")!.material).toBe(savedMaterial);
    expect(parsedTerrain.sideOrientation).toBe(0); expect(parsedTree.sideOrientation).toBe(1);
  });

  it("inverts current authored mesh faces with the reflection while preserving culling, material and source geometry", () => {
    const { terrain, placements, terrainMaterial, objectMaterial } = fixture(), tree = placements[0]!.mesh;
    terrain.sideOrientation = 0; tree.sideOrientation = 1;
    // The user's current face choice wins over retained conversion provenance.
    tree.metadata = { sourceSideOrientation: 1, authoredSideOrientation: 0 };
    const unrelated = MeshBuilder.CreateBox("Unrelated scene mesh", {}, scene); unrelated.sideOrientation = 0;
    const before = { indices: [...tree.getIndices()!], positions: [...tree.getVerticesData("position")!], normals: [...tree.getVerticesData("normal")!],
      metadata: JSON.stringify(tree.metadata), terrainMaterial: terrainMaterial.serialize(), objectMaterial: objectMaterial.serialize() };
    const section = attach();
    expect(terrain.sideOrientation).toBe(1); expect(tree.sideOrientation).toBe(0); expect(unrelated.sideOrientation).toBe(0);
    expect(terrainMaterial.backFaceCulling).toBe(true); expect(objectMaterial.backFaceCulling).toBe(true);
    expect(terrainMaterial.serialize()).toEqual(before.terrainMaterial); expect(objectMaterial.serialize()).toEqual(before.objectMaterial);
    expect([...tree.getIndices()!]).toEqual(before.indices); expect([...tree.getVerticesData("position")!]).toEqual(before.positions);
    expect([...tree.getVerticesData("normal")!]).toEqual(before.normals); expect(JSON.stringify(tree.metadata)).toBe(before.metadata);
    section.dispose(); section.dispose(); expect(terrain.sideOrientation).toBe(0); expect(tree.sideOrientation).toBe(1); expect(unrelated.sideOrientation).toBe(0);
  });

  it("toggles an owned neutral terrain material and restores saved material/texture ownership on stop", () => {
    const value = fixture(), texture = new Texture(null, scene); value.terrainMaterial.diffuseTexture = texture;
    const baseline = counts(), saved = value.terrainMaterial.serialize(), section = attach();
    section.setTerrainPreview(false); const neutral = value.terrain.material;
    expect(neutral).not.toBe(value.terrainMaterial); expect(counts().materials).toBe(baseline.materials + 1);
    expect(section.inspection().terrainMaterial).toBe("neutral-inspection");
    section.setTerrainPreview(false); expect(value.terrain.material).toBe(neutral);
    section.setTerrainPreview(true); expect(value.terrain.material).toBe(value.terrainMaterial);
    section.setTerrainPreview(false); section.dispose(); section.setTerrainPreview(false);
    expect(value.terrain.material).toBe(value.terrainMaterial); expect(value.terrainMaterial.serialize()).toEqual(saved);
    expect(scene.textures).toContain(texture); expect(counts()).toEqual(baseline);
  });

  it("does not overwrite a later terrain material assignment when restoring its own preview", () => {
    const value = fixture(), section = attach(); section.setTerrainPreview(false);
    const later = new StandardMaterial("Runtime assignment by another owner", scene); value.terrain.material = later;
    section.setTerrainPreview(true); section.dispose(); expect(value.terrain.material).toBe(later);
    expect(scene.materials).toContain(later); expect(scene.materials).toContain(value.terrainMaterial);
  });

  it("distinguishes authored placement translation from ordinary float32 rounding at native world coordinates", () => {
    const value = fixture(), source = value.source.placements[1]!, node = value.placements[1]!.node;
    source.matrix[12] = 121.17; source.matrix[14] = 950.34;
    node.metadata.nativePlacement = structuredClone(source); node.setPreTransformMatrix(Matrix.FromArray(source.matrix));
    const section = attach();
    expect(Math.abs(Math.fround(950.34) - 950.34)).toBeGreaterThan(.00001);
    expect(section.inspection().placementTransformEdits).toEqual([]);
    node.position.x = .75;
    expect(section.inspection().placementTransformEdits).toEqual([source.id]);
    expect(section.inspection().placements[1]!.sourceMatrix).toEqual(source.matrix);
  });

  it("releases temporary state on abort, allows reattachment, and leaves an already right-handed authored root unchanged", () => {
    const value = fixture(), controller = new AbortController(); value.terrain.sideOrientation = 0;
    const section = attach(scene, controller.signal); section.setTerrainPreview(false); expect(value.terrain.sideOrientation).toBe(1);
    controller.abort(); expect(value.root.scaling.z).toBe(-1); expect(value.terrain.material).toBe(value.terrainMaterial);
    expect(value.terrain.sideOrientation).toBe(0);
    expect(section.inspection()).toMatchObject({ disposed: true, finiteBounds: false });
    value.root.scaling.z = 1; const next = attach(); expect(value.terrain.sideOrientation).toBe(0);
    next.dispose(); expect(value.root.scaling.z).toBe(1); expect(value.terrain.sideOrientation).toBe(0);
  });

  it("cleans its owned material during scene disposal without double-disposing authored materials", () => {
    const value = fixture(), section = attach(); section.setTerrainPreview(false);
    const originalDispose = vi.spyOn(value.terrainMaterial, "dispose"), neutralDispose = vi.spyOn(value.terrain.material!, "dispose");
    scene.dispose(); section.dispose();
    expect(originalDispose).toHaveBeenCalledTimes(1); expect(neutralDispose).toHaveBeenCalledTimes(1);
  });

  it("returns null without a marker and rejects an aborted attachment before changing authored state", () => {
    expect(attachAuthoredNativeSection(scene, new AbortController().signal)).toBeNull();
    const value = fixture(), baseline = counts(), controller = new AbortController(); controller.abort();
    expect(() => attachAuthoredNativeSection(scene, controller.signal)).toThrow(); expect(value.root.scaling.z).toBe(-1); expect(counts()).toEqual(baseline);
  });

  it.each(["duplicate-root", "marker", "hash", "manifest", "missing-placement", "duplicate-placement", "changed-source", "unknown-placement", "missing-terrain"])(
    "rejects %s without mutating the authored world", fault => {
      const value = fixture();
      switch (fault) {
        case "duplicate-root": { const extra = new TransformNode("duplicate", scene); extra.metadata = structuredClone(value.root.metadata); break; }
        case "marker": value.root.metadata.nativeWorldRoot = null; break;
        case "hash": value.root.metadata.nativeWorldRoot.manifestSha256 = "not-a-hash"; break;
        case "manifest": value.source.placements[0]!.materialOverrides.push("unsupported"); break;
        case "missing-placement": delete value.placements[0]!.node.metadata.nativePlacement; break;
        case "duplicate-placement": value.placements[1]!.node.metadata = structuredClone(value.placements[0]!.node.metadata); break;
        case "changed-source": value.placements[0]!.node.metadata.nativePlacement.matrix[12] += 1; break;
        case "unknown-placement": value.placements[0]!.node.metadata.nativePlacement.id = "not-declared"; break;
        case "missing-terrain": delete value.terrain.metadata.worldTerrain; break;
      }
      const baseline = counts(), metadata = JSON.stringify(value.root.metadata);
      expect(() => attachAuthoredNativeSection(scene, new AbortController().signal)).toThrow();
      expect(value.root.scaling.z).toBe(-1); expect(counts()).toEqual(baseline); expect(JSON.stringify(value.root.metadata)).toBe(metadata);
    });

  it.each(["position", "scale", "rotation", "quaternion", "parent", "pretransform", "frozen"])("rejects unsupported root %s edits", fault => {
    const { root } = fixture();
    switch (fault) {
      case "position": root.position.x = 1; break;
      case "scale": root.scaling.x = 2; break;
      case "rotation": root.rotation.y = .1; break;
      case "quaternion": root.rotationQuaternion = Quaternion.FromEulerAngles(0, .1, 0); break;
      case "parent": root.parent = new TransformNode("parent", scene); break;
      case "pretransform": root.setPreTransformMatrix(Matrix.Translation(1, 0, 0)); break;
      case "frozen": root.freezeWorldMatrix(); break;
    }
    expect(() => attachAuthoredNativeSection(scene, new AbortController().signal)).toThrow("root must be identity"); expect(root.scaling.z).toBe(-1);
  });

  it("rolls back the reflection when child geometry has nonfinite bounds and rejects two concurrent owners", () => {
    const value = fixture(), baseline = counts(); value.terrain.position.x = NaN; value.terrain.sideOrientation = 0; value.placements[0]!.mesh.sideOrientation = 1;
    expect(() => attachAuthoredNativeSection(scene, new AbortController().signal)).toThrow("finite geometry bounds");
    expect(value.root.scaling.z).toBe(-1); expect(counts()).toEqual(baseline);
    expect(value.terrain.sideOrientation).toBe(0); expect(value.placements[0]!.mesh.sideOrientation).toBe(1);
    value.terrain.position.x = 0; const section = attach();
    expect(() => attachAuthoredNativeSection(scene, new AbortController().signal)).toThrow("already attached");
    section.dispose(); expect(value.root.scaling.z).toBe(-1);
  });
});

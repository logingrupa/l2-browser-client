import { baseRuntimeSettings, runtimeBoundaryMocks, useNativeSliceRuntimeHarness } from "../support/nativeSliceRuntimeHarness";
import { registerFlamePresentationWorldCases, registerPackageInspectionWorldCase, type NativeSliceTestWorld } from "../support/nativeSliceRuntimeWorldCases";
import { describe, expect, it, vi } from "vitest";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { NativeSectionManifest } from "../../src/scene/world/loadNativeSection";
import { authoredNativeWorldSource } from "../../src/editor/authoredNativeWorldSource";

describe("native slice runtime on the saved authored world", () => {
  const harness = useNativeSliceRuntimeHarness();
  const { stops, startRuntime } = harness;

  function createSavedAuthoredWorld(rootZ: -1 | 1 = -1) {
    harness.scene.useRightHandedSystem = true;
    harness.useWorldSource(authoredNativeWorldSource);
    const hash = "a".repeat(64), sourceMatrix = [...Matrix.Translation(214, -29, 795).asArray()];
    const manifest: NativeSectionManifest = {
      schemaVersion: 1, kind: "native-map-section-runtime", support: "section-products-ready-for-runtime-validation", errors: [], gaps: [],
      resourceRoots: { terrain: "../map-section", models: "../map-section-models" },
      terrain: { file: "terrain.glb", sha256: hash, bytes: 100, materialStatus: "authored" },
      models: [{ id: "interlude:Fixture.Tree", sourceObject: "Fixture.Tree", model: { file: `${hash}/model.glb`, sha256: hash, bytes: 100 },
        archive: { file: `${hash}/asset.l2asset`, sha256: hash, bytes: 100 } }],
      placements: [{ id: "source-tree", modelId: "interlude:Fixture.Tree", sourceMesh: "Fixture.Tree", matrix: sourceMatrix, materialOverrides: [] }],
      surfaceSpawnCandidate: { sourcePosition: [21000, 79000, -3000], gltfGroundPosition: [210, -30, 790], nativeSpawnVerified: false, collisionVerified: false },
    };
    const root = new TransformNode("Saved world", harness.scene); root.scaling.z = rootZ;
    root.metadata = { nativeWorldRoot: { schemaVersion: 1, manifestSha256: hash, manifest } };
    const ground = MeshBuilder.CreateGround("Saved native terrain", { width: 20, height: 20 }, harness.scene);
    ground.parent = root; ground.position.set(210, -30, 790); ground.metadata = { worldTerrain: true, worldSupportsWalking: true };
    const placement = new TransformNode("Saved source placement", harness.scene); placement.parent = root;
    placement.metadata = { nativePlacement: structuredClone(manifest.placements[0]) }; placement.setPreTransformMatrix(Matrix.FromArray(sourceMatrix));
    placement.position.x = .5;
    const tree = MeshBuilder.CreateBox("Saved tree", {}, harness.scene); tree.parent = placement;
    const material = new StandardMaterial("Authored material", harness.scene); ground.material = material; tree.material = material;
    const hidden = MeshBuilder.CreateBox("Authored hidden helper", {}, harness.scene); hidden.setEnabled(false);
    const camera = harness.scene.getCameraByName("World camera") as ArcRotateCamera;
    camera.alpha = .72; camera.beta = 1.2; camera.radius = 7;
    camera.setTarget(new Vector3(214, -25, 789 * rootZ), false, false, true);
    const cameraBefore = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone(),
      minZ: camera.minZ, maxZ: camera.maxZ, upperRadiusLimit: camera.upperRadiusLimit };
    return { root, ground, tree, hidden, placement, material, camera, cameraBefore, manifest };
  }

  function expectAuthoredCamera(camera: ArcRotateCamera, expected: ReturnType<typeof createSavedAuthoredWorld>["cameraBefore"]) {
    expect(camera.alpha).toBe(expected.alpha); expect(camera.beta).toBe(expected.beta); expect(camera.radius).toBe(expected.radius);
    expect(camera.target).toEqual(expected.target); expect(camera.minZ).toBe(expected.minZ); expect(camera.maxZ).toBe(expected.maxZ);
    expect(camera.upperRadiusLimit).toBe(expected.upperRadiusLimit);
  }

  it("uses saved native world geometry without another import, preserves edited objects and restores the LH camera on stop", async () => {
    const value = createSavedAuthoredWorld(), { root, ground, tree, hidden, material, camera, cameraBefore } = value;
    const savedMeshes = [...harness.scene.meshes], transforms = [...harness.scene.transformNodes], materials = [...harness.scene.materials];
    const materialDispose = vi.spyOn(material, "dispose"), groundDispose = vi.spyOn(ground, "dispose");
    const metadataBefore = JSON.stringify(root.metadata);
    runtimeBoundaryMocks.camera.mockImplementationOnce(() => {
      expect(camera.alpha).toBe(-cameraBefore.alpha);
      expect(camera.target.asArray()).toEqual([cameraBefore.target.x, cameraBefore.target.y, -cameraBefore.target.z]);
      return runtimeBoundaryMocks.detachCamera;
    });
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled(); expect(harness.scene.meshes).toEqual(savedMeshes); expect(harness.scene.transformNodes).toEqual(transforms);
    expect(harness.scene.materials).toEqual(materials); expect(root.scaling.z).toBe(1);
    expect(ground.isEnabled()).toBe(true); expect(tree.isEnabled()).toBe(true); expect(hidden.isEnabled()).toBe(false);
    expect(ground.material).toBe(material); expect(tree.material).toBe(material); expect(value.placement.position.x).toBe(.5);
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState()[0]!.position).toEqual({ x: 212, y: -30, z: 794 });
    expect(camera.alpha).toBe(-cameraBefore.alpha); expect(camera.beta).toBe(cameraBefore.beta); expect(camera.radius).toBe(cameraBefore.radius);
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ worldFailure: null, world: { authored: true, placementCount: 1,
      placementTransformEdits: ["source-tree"], terrainMaterial: "editor-authored-source-materials" } });
    stop(); stop();
    expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore);
    expect(groundDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
    expect(harness.scene.meshes).toEqual(savedMeshes); expect(harness.scene.materials).toEqual(materials); expect(JSON.stringify(root.metadata)).toBe(metadataBefore);
  });

  it("restores saved world and camera immediately when authored terrain cannot support the requested spawn", async () => {
    const { root, ground, material, camera, cameraBefore } = createSavedAuthoredWorld();
    const stop = await startRuntime({ ...baseRuntimeSettings, origin: new Vector3(100, 3, 4) }, new AbortController().signal); stops.push(stop);
    expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled();
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ world: null, worldFailure: "The staged native surface does not support the requested actor origin." });
    expect(root.scaling.z).toBe(-1); expect(ground.isEnabled()).toBe(true); expect(ground.material).toBe(material);
    expectAuthoredCamera(camera, cameraBefore);
    const editCameraInRetainedInspectionScene = () => { camera.alpha = .33; camera.setTarget(new Vector3(9, 8, 7), false, false, true); };
    editCameraInRetainedInspectionScene();
    stop();
    expect(camera.alpha).toBe(.33); expect(camera.target.asArray()).toEqual([9, 8, 7]);
    expect(ground.isDisposed()).toBe(false);
  });

  it.each(["stop", "abort"] as const)("does not reflect an authored RH camera when the world root is already identity, and restores it on %s", async lifetime => {
    const { root, ground, tree, camera, cameraBefore } = createSavedAuthoredWorld(1), controller = new AbortController();
    const orientations = [ground.sideOrientation, tree.sideOrientation];
    runtimeBoundaryMocks.camera.mockImplementationOnce(() => {
      expectAuthoredCamera(camera, cameraBefore);
      return runtimeBoundaryMocks.detachCamera;
    });
    const stop = await startRuntime(baseRuntimeSettings, controller.signal); stops.push(stop);
    expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled(); expect(root.scaling.z).toBe(1);
    expect([ground.sideOrientation, tree.sideOrientation]).toEqual(orientations);
    expect(camera.alpha).toBe(cameraBefore.alpha); expect(camera.beta).toBe(cameraBefore.beta); expect(camera.radius).toBe(cameraBefore.radius);
    expect(camera.target.asArray()).toEqual([212.6, -29.65, 794]);
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ worldFailure: null, world: { authored: true, placementCount: 1 } });
    if (lifetime === "abort") controller.abort(); else stop();
    stop();
    expectAuthoredCamera(camera, cameraBefore); expect(root.scaling.z).toBe(1);
    expect([ground.sideOrientation, tree.sideOrientation]).toEqual(orientations);
    expect(ground.isDisposed()).toBe(false); expect(tree.isDisposed()).toBe(false);
    expect(runtimeBoundaryMocks.detachCamera).toHaveBeenCalledTimes(1); expect(runtimeBoundaryMocks.detachTargeting).toHaveBeenCalledTimes(1);
  });

  it("restores an attached saved world on cancellation and releases runtime boundaries without disposing authored objects", async () => {
    const { root, ground, material, camera, cameraBefore } = createSavedAuthoredWorld(), controller = new AbortController();
    const stop = await startRuntime(baseRuntimeSettings, controller.signal); stops.push(stop);
    const terrainDispose = vi.spyOn(ground, "dispose"), materialDispose = vi.spyOn(material, "dispose");
    controller.abort(); stop();
    expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore); expect(ground.isEnabled()).toBe(true);
    expect(terrainDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
    expect(runtimeBoundaryMocks.registries[0]!.dispose).toHaveBeenCalledTimes(1); expect(runtimeBoundaryMocks.uis[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled(); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rolls back reflected authored coordinates when a later runtime attachment fails", async () => {
    const { root, ground, material, camera, cameraBefore } = createSavedAuthoredWorld();
    runtimeBoundaryMocks.targeting.mockImplementationOnce(() => { throw Error("Targeting fixture failure"); });
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal)).rejects.toThrow("Targeting fixture failure");
    expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore); expect(ground.material).toBe(material);
    expect(ground.isEnabled()).toBe(true); expect(ground.isDisposed()).toBe(false); expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled();
  });

  it("does not replace a malformed saved world with a newly imported source world", async () => {
    const { root, ground, camera, cameraBefore } = createSavedAuthoredWorld(); root.metadata.nativeWorldRoot.manifestSha256 = "invalid";
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled(); expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore);
    expect(ground.isEnabled()).toBe(true); expect(window.__nativeSlice?.snapshot()?.worldFailure).toContain("invalid schema or manifest identity");
  });
  const savedAuthoredTestWorld: NativeSliceTestWorld = {
    name: "authored",
    sectionLoadCount: 0,
    worldRootScalingZWhileRunning: 1,
    prepare() {
      const { root, ground, material } = createSavedAuthoredWorld();
      return {
        worldRootScalingZ: () => root.scaling.z,
        expectRestoredAfterRuntimeRelease() {
          expect(root.scaling.z).toBe(-1); expect(ground.isDisposed()).toBe(false); expect(ground.material).toBe(material);
        },
      };
    },
  };
  registerFlamePresentationWorldCases(harness, savedAuthoredTestWorld);
  registerPackageInspectionWorldCase(harness, savedAuthoredTestWorld);
});

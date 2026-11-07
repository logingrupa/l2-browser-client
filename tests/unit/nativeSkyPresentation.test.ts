import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { createNativeSkyPresentation, nativeSkySource } from "../../src/scene/world/nativeSkyPresentation";

describe("stored native sky presentation lifetime", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); });
  function authored() {
    const root = new TransformNode("sky", scene); root.scaling.z = -1; root.position.set(1, 2, 3);
    root.metadata = { nativeSkyRoot: { schemaVersion: 1, ...nativeSkySource, sourceSnapshot: true } };
    const origin = new TransformNode("source origin", scene); origin.parent = root; origin.position.set(-2.922, -245.03, -2644.03);
    const meshes = [0, 1, 2].map(index => {
      const mesh = MeshBuilder.CreateBox(`part${index}`, {}, scene); mesh.parent = origin;
      mesh.material = new StandardMaterial(`source${index}`, scene); mesh.material.fogEnabled = true;
      mesh.sideOrientation = 0; return mesh;
    });
    return { root, origin, meshes };
  }
  it("retains authored geometry, offsets and materials and restores presentation state on abort", async () => {
    const { root, origin, meshes } = authored(), abort = new AbortController();
    const world = MeshBuilder.CreateBox("world", {}, scene), laterGroup = MeshBuilder.CreateBox("authored group2", {}, scene);
    laterGroup.renderingGroupId = 2;
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);
    const positions = meshes.map(mesh => mesh.getVerticesData("position")), materials = meshes.map(mesh => mesh.material);
    const sky = await createNativeSkyPresentation(scene, abort.signal);
    expect(sky?.inspection()).toMatchObject({ authored: true, meshes: 3, status: "source-snapshot" });
    expect(root.scaling.z).toBe(1); expect(meshes[0]!.sideOrientation).toBe(1);
    expect(world.renderingGroupId).toBe(1); expect(laterGroup.renderingGroupId).toBe(2);
    const added = MeshBuilder.CreateBox("later actor", {}, scene);
    const camera = new FreeCamera("camera", new Vector3(8, 9, 10), scene); camera.getViewMatrix(true);
    scene.onBeforeCameraRenderObservable.notifyObservers(camera);
    expect(added.renderingGroupId).toBe(1);
    expect(root.position.asArray()).toEqual([9, 11, 13]); expect(origin.position.asArray()).toEqual([-2.922, -245.03, -2644.03]);
    expect(meshes.map(mesh => mesh.getVerticesData("position"))).toEqual(positions);
    abort.abort(); sky?.dispose();
    expect(root.position.asArray()).toEqual([1, 2, 3]); expect(root.scaling.z).toBe(-1);
    expect(world.renderingGroupId).toBe(0); expect(added.renderingGroupId).toBe(0); expect(laterGroup.renderingGroupId).toBe(2);
    expect(meshes.map(mesh => mesh.material)).toEqual(materials); expect(meshes.every(mesh => !mesh.isDisposed() && mesh.material?.fogEnabled && !mesh.material.disableDepthWrite)).toBe(true);
    expect(meshes[0]!.sideOrientation).toBe(0);
    expect(scene.getAutoClearDepthStencilSetup(1)).toEqual({ autoClear: false, depth: false, stencil: false });
  });
  it("preserves an authored RH sky orientation and restores it on normal disposal", async () => {
    const { root, meshes } = authored(); root.scaling.z = 1; meshes[0]!.sideOrientation = 1;
    const sky = await createNativeSkyPresentation(scene, new AbortController().signal);
    expect(meshes[0]!.sideOrientation).toBe(1); sky?.dispose(); expect(root.scaling.z).toBe(1);
  });
  it.each(["identity", "parent", "duplicate", "missing-part"])("rejects %s without mutating authored state", async failure => {
    const { root, meshes } = authored();
    if (failure === "identity") root.metadata.nativeSkyRoot.manifestSha256 = "changed";
    if (failure === "parent") root.parent = new TransformNode("other", scene);
    if (failure === "duplicate") authored();
    if (failure === "missing-part") meshes[0]!.dispose();
    await expect(createNativeSkyPresentation(scene, new AbortController().signal)).rejects.toThrow();
    expect(root.scaling.z).toBe(-1); expect(root.position.asArray()).toEqual([1, 2, 3]);
  });
  it("returns absent only for a missing optional source and rejects corrupted bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]))));
    expect(await createNativeSkyPresentation(scene, new AbortController().signal)).toBeNull();
    await expect(createNativeSkyPresentation(scene, new AbortController().signal)).rejects.toThrow("hash/length mismatch");
    expect(scene.meshes).toHaveLength(0);
  });
});

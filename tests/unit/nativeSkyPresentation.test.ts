import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { createNativeSkyPresentation, nativeSkySource } from "../../src/scene/world/nativeSkyPresentation";
import { decodeJsonDocument, fixtureTileId, jsonBytes, readFixtureTileFiles, sha256Hex } from "../support/nativeTileFixtureStore";

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({ LoadAssetContainerAsync: vi.fn() }));

function skyGlb(): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));
  const size = (text.byteLength + 3) & ~3, bytes = new Uint8Array(20 + size), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(text, 20); return bytes;
}

type TileSky = "resource" | "gap" | "absent";

function tileSkyStore(tileSky: TileSky, materialRoots: number) {
  const fixture = readFixtureTileFiles(), tile = decodeJsonDocument(fixture.tile.bytes), glb = skyGlb(), responses = new Map<string, Uint8Array<ArrayBuffer>>();
  const sourceId = `interlude:${fixtureTileId}.Model1.SkyZoneInfo0`;
  const skyManifest = jsonBytes({ schemaVersion: 1, kind: "native-sky-source-bundle", id: sourceId, tileId: fixtureTileId,
    counts: { materialRoots }, files: { "sky.glb": { bytes: glb.byteLength, sha256: sha256Hex(glb) } } });
  const skyManifestSha256 = sha256Hex(skyManifest), skyFolder = `/l2/skies/${skyManifestSha256}`;
  const gaps = tile.gaps as Record<string, unknown>[];
  if (tileSky !== "gap") tile.gaps = gaps.filter(row => row.step !== "sky");
  if (tileSky === "resource") {
    tile.resources = [{ kind: "sky", manifest: `${skyFolder}/manifest.json`, manifestSha256: skyManifestSha256, manifestBytes: skyManifest.byteLength }];
    responses.set(`${skyFolder}/manifest.json`, skyManifest).set(`${skyFolder}/sky.glb`, glb);
  }
  const tileBytes = jsonBytes(tile), tileSha256 = sha256Hex(tileBytes), tilePath = `/l2/tiles/${tileSha256}/tile.json`;
  responses.set(tilePath, tileBytes).set("/l2/catalog.json", jsonBytes({ schemaVersion: 1, models: [],
    tiles: [{ id: fixtureTileId, manifest: tilePath, manifestSha256: tileSha256, manifestBytes: tileBytes.byteLength }] }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const value = responses.get(url);
    return new Response(value?.slice().buffer ?? "missing", { status: value ? 200 : 404 });
  }));
  vi.stubGlobal("location", { search: `?map=${fixtureTileId}`, protocol: "http:" });
  return { sourceId, skyManifestSha256 };
}

function containerWithMeshes(scene: Scene, count: number) {
  const container = new AssetContainer(scene);
  for (let index = 0; index < count; index++) {
    const mesh = MeshBuilder.CreateBox(`tile sky part ${index}`, {}, scene);
    mesh.material = new StandardMaterial(`tile sky material ${index}`, scene);
    container.meshes.push(mesh); container.rootNodes.push(mesh);
  }
  container.removeAllFromScene();
  return container;
}

describe("stored native sky presentation lifetime", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); vi.mocked(LoadAssetContainerAsync).mockReset(); });
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

describe("selected tile sky presentation", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); vi.mocked(LoadAssetContainerAsync).mockReset(); });

  it("presents the tile sky resource with one mesh per material root", async () => {
    const { sourceId, skyManifestSha256 } = tileSkyStore("resource", 2);
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 2));
    const sky = await createNativeSkyPresentation(scene, new AbortController().signal);
    expect(sky?.inspection()).toMatchObject({ authored: false, meshes: 2, sourceId, manifestSha256: skyManifestSha256, tileId: fixtureTileId, tileSkyGap: null });
    sky?.dispose();
    expect(scene.meshes).toHaveLength(0);
  });

  it("refuses a tile sky whose meshes differ from its material root count", async () => {
    tileSkyStore("resource", 3);
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 2));
    await expect(createNativeSkyPresentation(scene, new AbortController().signal)).rejects.toThrow("each of its 3 material roots");
    expect(scene.meshes).toHaveLength(0);
  });

  it("names the tile sky gap reason when the tile has no sky resource", async () => {
    tileSkyStore("gap", 1);
    await expect(createNativeSkyPresentation(scene, new AbortController().signal)).rejects.toThrow(`Native tile ${fixtureTileId} sky is a gap: step-pending:sky.`);
    expect(LoadAssetContainerAsync).not.toHaveBeenCalled();
  });

  it("presents no sky for a tile whose sky step passed without a SkyZoneInfo zone", async () => {
    tileSkyStore("absent", 1);
    await expect(createNativeSkyPresentation(scene, new AbortController().signal)).resolves.toBeNull();
    expect(LoadAssetContainerAsync).not.toHaveBeenCalled();
  });
});

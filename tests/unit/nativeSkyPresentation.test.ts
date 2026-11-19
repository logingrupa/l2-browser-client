import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { loadNativeMaterial, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  createNativeSkyPresentation, sharedSkyPortalZoneVolumesUnresolvedReason, sharedSkyViewGateUnresolvedReason, sharedSkyViewport160UnresolvedReason,
  sharedSkyVisibilityUnstagedReason, worldGroupDepthClear, type SharedSkyViewTrigger,
} from "../../src/scene/world/nativeSkyPresentation";
import { sharedSkyVisibilityRules } from "../../src/scene/world/bspVisibility/sharedSkyVisibilityRules";
import { BLEND_CONSTANTS } from "../../src/materials/ue2/model/constants/blendConstants";
import { swatchTexturePng, syntheticSkyColourModifierProgram, textureImageFor } from "../support/materialProgramFixture";
import { jsonBytes, sha256Hex } from "../support/nativeTileFixtureStore";

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({ LoadAssetContainerAsync: vi.fn() }));
vi.mock("../../src/materials/ue2/babylon/loadNativeMaterial", async importOriginal =>
  ({ ...await importOriginal<typeof import("../../src/materials/ue2/babylon/loadNativeMaterial")>(), loadNativeMaterial: vi.fn() }));

function skyGlb(): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));
  const size = (text.byteLength + 3) & ~3, bytes = new Uint8Array(20 + size), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(text, 20); return bytes;
}

const sharedSkySourceId = "interlude:skylevel.Model29.SkyZoneInfo0";
const skyBackgroundRoot = "l2_skies.Shaders.SkybackgroundColor";
const skyBackgroundProgramSha256 = "d".repeat(64);
const skyBackgroundColourBgraHex = "ce9600ff";
const whiteChipImage = textureImageFor(swatchTexturePng());
const listedSkyBackground = { mapReference: "L2_Skies.Shaders.SkybackgroundColor", root: skyBackgroundRoot,
  program: { directory: `native-materials/${skyBackgroundProgramSha256}`, programSha256: skyBackgroundProgramSha256 }, gapReasons: [] };

function loadedSkyBackgroundProgram(materialId: string): LoadedNativeMaterial {
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSkyColourModifierProgram(skyBackgroundRoot, whiteChipImage, skyBackgroundColourBgraHex))));
  return { materialId, program, plan: compileMaterialStagePlan(program),
    texturePixels: new Map([[whiteChipImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]), textureMipChains: new Map() };
}

interface SharedSkyStoreSettings {
  readonly materialRoots: number;
  readonly listedMaterials?: readonly unknown[];
  readonly catalogHasSky?: boolean;
  readonly corruptGlb?: boolean;
}

function sharedSkyStore({ materialRoots, listedMaterials = [], catalogHasSky = true, corruptGlb = false }: SharedSkyStoreSettings) {
  const glb = skyGlb(), responses = new Map<string, Uint8Array<ArrayBuffer>>();
  const skySnapshot = jsonBytes({ schemaVersion: 1, kind: "native-shared-sky-snapshot", map: "skylevel", materials: listedMaterials });
  const skyManifest = jsonBytes({ schemaVersion: 1, kind: "native-shared-sky-bundle", id: sharedSkySourceId, map: "skylevel",
    counts: { materialRoots }, files: { "sky.glb": { bytes: glb.byteLength, sha256: sha256Hex(glb) },
      "sky.json": { bytes: skySnapshot.byteLength, sha256: sha256Hex(skySnapshot) } } });
  const skyManifestSha256 = sha256Hex(skyManifest), skyFolder = `/l2/skies/${skyManifestSha256}`;
  responses.set(`${skyFolder}/manifest.json`, skyManifest).set(`${skyFolder}/sky.glb`, corruptGlb ? new Uint8Array([1, 2, 3]) : glb)
    .set(`${skyFolder}/sky.json`, skySnapshot);
  const skies = catalogHasSky ? [{ id: "skylevel", manifest: `${skyFolder}/manifest.json`, manifestSha256: skyManifestSha256, manifestBytes: skyManifest.byteLength }] : [];
  responses.set("/l2/catalog.json", jsonBytes({ schemaVersion: 1, models: [], skies }));
  const fetcher = vi.fn(async (url: string) => {
    const value = responses.get(url);
    return new Response(value?.slice().buffer ?? "missing", { status: value ? 200 : 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("location", { search: "?map=20_21", protocol: "http:" });
  return { skyManifestSha256, fetcher };
}

function containerWithMeshes(scene: Scene, count: number, sourceReferences: readonly string[] = []) {
  const container = new AssetContainer(scene);
  for (let index = 0; index < count; index++) {
    const mesh = MeshBuilder.CreateBox(`shared sky part ${index}`, {}, scene);
    const gltfMaterial = new PBRMaterial(sourceReferences[index] ?? `shared sky material ${index}`, scene);
    gltfMaterial.metadata = { gltf: { extras: { nativeSourceReference: sourceReferences[index] ?? skyBackgroundRoot, sourceSnapshot: true } } };
    mesh.material = gltfMaterial;
    container.materials.push(gltfMaterial);
    container.meshes.push(mesh); container.rootNodes.push(mesh);
  }
  container.removeAllFromScene();
  return container;
}

describe("shared sky presentation", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); vi.mocked(LoadAssetContainerAsync).mockReset(); vi.mocked(loadNativeMaterial).mockReset(); });

  it("draws the one shared skylevel record on a selected tile through the UE2 library program its snapshot lists", async () => {
    const { skyManifestSha256 } = sharedSkyStore({ materialRoots: 1, listedMaterials: [listedSkyBackground] });
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 1, [skyBackgroundRoot]));
    vi.mocked(loadNativeMaterial).mockImplementation(async materialId => loadedSkyBackgroundProgram(materialId));
    const sky = await createNativeSkyPresentation(scene, new AbortController().signal, null, null, null);
    const drawn = scene.meshes.find(mesh => mesh.name === "shared sky part 0")!.material;
    expect(drawn).toBeInstanceOf(ShaderMaterial);
    expect(drawn?.name).toBe(`UE2 material: ${skyBackgroundRoot}`);
    expect(sky?.inspection()).toMatchObject({ status: "shared-sky", meshes: 1, sourceId: sharedSkySourceId, manifestSha256: skyManifestSha256,
      drawGate: "always", gaps: [sharedSkyViewGateUnresolvedReason, sharedSkyVisibilityUnstagedReason], skyVisibility: null });
    expect(scene.getAutoClearDepthStencilSetup(1)).toMatchObject({ autoClear: true, depth: true, stencil: false });
    expect(sky?.inspection().librarySurfaces).toEqual([{ mesh: "shared sky part 0", sourceReference: skyBackgroundRoot,
      programMaterialId: skyBackgroundProgramSha256, status: "library-compiled", reasons: [] }]);
    sky?.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials.some(material => material.name.startsWith("UE2 material:"))).toBe(false);
  });

  it("follows the camera, draws world meshes after the sky and restores them on abort", async () => {
    sharedSkyStore({ materialRoots: 1, listedMaterials: [listedSkyBackground] });
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 1, [skyBackgroundRoot]));
    vi.mocked(loadNativeMaterial).mockImplementation(async materialId => loadedSkyBackgroundProgram(materialId));
    const world = MeshBuilder.CreateBox("world", {}, scene), laterGroup = MeshBuilder.CreateBox("group2", {}, scene);
    laterGroup.renderingGroupId = 2;
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);
    const abort = new AbortController();
    const sky = await createNativeSkyPresentation(scene, abort.signal, null, null, null);
    expect(world.renderingGroupId).toBe(1); expect(laterGroup.renderingGroupId).toBe(2);
    const added = MeshBuilder.CreateBox("later actor", {}, scene);
    const camera = new FreeCamera("camera", new Vector3(8, 9, 10), scene); camera.getViewMatrix(true);
    scene.onBeforeCameraRenderObservable.notifyObservers(camera);
    expect(added.renderingGroupId).toBe(1);
    expect(scene.transformNodes.find(node => node.name === "Native shared sky · skylevel")!.position.asArray()).toEqual([8, 9, 10]);
    abort.abort(); sky?.dispose();
    expect(world.renderingGroupId).toBe(0); expect(added.renderingGroupId).toBe(0); expect(laterGroup.renderingGroupId).toBe(2);
    expect(scene.getAutoClearDepthStencilSetup(1)).toEqual({ autoClear: false, depth: false, stencil: false });
  });

  it("reports texturesReady from the library material each sky mesh draws with, not the glTF material it replaced", async () => {
    sharedSkyStore({ materialRoots: 1, listedMaterials: [listedSkyBackground] });
    const container = containerWithMeshes(scene, 1, [skyBackgroundRoot]);
    const readyTexture = { isReady: () => true } as unknown as BaseTexture, unreadyTexture = { isReady: () => false } as unknown as BaseTexture;
    vi.spyOn(container.materials[0]!, "getActiveTextures").mockReturnValue([unreadyTexture]);
    vi.mocked(LoadAssetContainerAsync).mockResolvedValue(container);
    vi.mocked(loadNativeMaterial).mockImplementation(async materialId => loadedSkyBackgroundProgram(materialId));
    const sky = await createNativeSkyPresentation(scene, new AbortController().signal, null, null, null);
    const drawnTextures = vi.spyOn(scene.meshes.find(mesh => mesh.name === "shared sky part 0")!.material!, "getActiveTextures").mockReturnValue([readyTexture]);
    expect(sky?.inspection().texturesReady).toBe(true);
    drawnTextures.mockReturnValue([unreadyTexture]);
    expect(sky?.inspection().texturesReady).toBe(false);
    sky?.dispose();
  });

  it("refuses a shared sky whose meshes differ from its material root count", async () => {
    sharedSkyStore({ materialRoots: 3 });
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 2));
    await expect(createNativeSkyPresentation(scene, new AbortController().signal, null, null, null)).rejects.toThrow("each of its 3 material roots");
    expect(scene.meshes).toHaveLength(0);
  });

  it("draws the sky only while the main view selects a FakeBackdrop node and names the open viewport+0x160 and portal zone routes", async () => {
    sharedSkyStore({ materialRoots: 1, listedMaterials: [listedSkyBackground] });
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 1, [skyBackgroundRoot]));
    vi.mocked(loadNativeMaterial).mockImplementation(async materialId => loadedSkyBackgroundProgram(materialId));
    let mainView: { sharedSkyTriggerNode: number; sharedSkyOtherZoneCandidates: number } | null = null;
    const viewTrigger: SharedSkyViewTrigger = { frame: () => mainView };
    const sky = await createNativeSkyPresentation(scene, new AbortController().signal, null, null, viewTrigger);
    const skyMesh = scene.meshes.find(mesh => mesh.name === "shared sky part 0")!;
    const camera = new FreeCamera("camera", new Vector3(0, 0, 0), scene);
    const renderCamera = () => scene.onBeforeCameraRenderObservable.notifyObservers(camera);
    renderCamera();
    expect(skyMesh.isVisible).toBe(false);
    mainView = { sharedSkyTriggerNode: -1, sharedSkyOtherZoneCandidates: 0 };
    renderCamera();
    expect(skyMesh.isVisible).toBe(false);
    mainView = { sharedSkyTriggerNode: 4297, sharedSkyOtherZoneCandidates: 2 };
    renderCamera();
    expect(skyMesh.isVisible).toBe(true);
    expect(sky?.inspection()).toMatchObject({ drawGate: "fakebackdrop-trigger", drawn: true, triggerNode: 4297,
      gaps: [sharedSkyViewport160UnresolvedReason, sharedSkyPortalZoneVolumesUnresolvedReason, sharedSkyVisibilityUnstagedReason] });
    sky?.dispose();
  });

  it("turns depth writes off on a sky surface left on its glTF material, since only the library background writes depth", async () => {
    sharedSkyStore({ materialRoots: 2, listedMaterials: [listedSkyBackground] });
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 2, [skyBackgroundRoot, "l2_skies.Shaders.Unlisted"]));
    vi.mocked(loadNativeMaterial).mockImplementation(async materialId => loadedSkyBackgroundProgram(materialId));
    const sky = await createNativeSkyPresentation(scene, new AbortController().signal, null, null, null);
    const [library, gltf] = ["shared sky part 0", "shared sky part 1"].map(name => scene.meshes.find(mesh => mesh.name === name)!.material!);
    expect([library!.disableDepthWrite, gltf!.disableDepthWrite]).toEqual([false, true]);
    sky?.dispose();
  });

  it("leaves back face rejection of every sky material to the node walk, so the back-facing two-sided haze ring band draws as native", async () => {
    sharedSkyStore({ materialRoots: 2, listedMaterials: [listedSkyBackground] });
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => containerWithMeshes(scene, 2, [skyBackgroundRoot, "l2_skies.Shaders.Unlisted"]));
    vi.mocked(loadNativeMaterial).mockImplementation(async materialId => loadedSkyBackgroundProgram(materialId));
    const sky = await createNativeSkyPresentation(scene, new AbortController().signal, null, null, null);
    const materials = ["shared sky part 0", "shared sky part 1"].map(name => scene.meshes.find(mesh => mesh.name === name)!.material!);
    expect(materials.map(material => material.backFaceCulling)).toEqual([BLEND_CONSTANTS.sharedSkyBackFaceCulling.runtimeDefault, BLEND_CONSTANTS.sharedSkyBackFaceCulling.runtimeDefault]);
    expect(BLEND_CONSTANTS.sharedSkyBackFaceCulling.runtimeDefault).toBe(false);
    sky?.dispose();
  });

  it("sets the world group depth clear from the RM-24 clear rule and refuses a clear Babylon cannot give between groups", () => {
    expect(worldGroupDepthClear(sharedSkyVisibilityRules.depthClear, engine)).toEqual({ autoClear: true, depth: true, stencil: false });
    expect(() => worldGroupDepthClear({ ...sharedSkyVisibilityRules.depthClear, colorCleared: true }, engine)).toThrow("colour");
  });

  it("presents no sky while the catalog has no skylevel record and rejects corrupted sky bytes", async () => {
    sharedSkyStore({ materialRoots: 1, catalogHasSky: false });
    await expect(createNativeSkyPresentation(scene, new AbortController().signal, null, null, null)).resolves.toBeNull();
    vi.unstubAllGlobals();
    sharedSkyStore({ materialRoots: 1, corruptGlb: true });
    await expect(createNativeSkyPresentation(scene, new AbortController().signal, null, null, null)).rejects.toThrow();
    expect(LoadAssetContainerAsync).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0);
  });
});

import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { drawNativeSessionSeed } from "../../assets/native/nativeSessionSeed";
import { loadNativeMaterial } from "../../materials/ue2/babylon/loadNativeMaterial";
import type { NativeMaterialUniforms } from "../../materials/ue2/babylon/material";
import { indexNone } from "./bspVisibility/core/bspNodeArrays";
import { BLEND_CONSTANTS } from "../../materials/ue2/model/constants/blendConstants";
import { sharedSkyVisibilityRules, type SharedSkyDepthClear } from "./bspVisibility/sharedSkyVisibilityRules";
import { validateSectionGlb } from "./loadNativeSection";
import { readSharedSkySource, type NativeSharedSkySource } from "./nativeSharedSkySource";
import { bindNativeSkyLibraryMaterials, loadNativeSkyMaterialsListing, type NativeSkyLibraryBinding } from "./nativeSkyLibraryMaterials";
import { driveNativeSkyVisibility, loadNativeSkyVisibility, type NativeSkyVisibilityDriver } from "./nativeSkyVisibility";
import { readNativeSourceReference } from "./nativeSourceReference";
import type { SkyEnvironmentColourSources } from "./skyEnvironmentColours";

export const sharedSkyViewGateUnresolvedReason = "shared-sky-view-gate-unresolved";
export const sharedSkyVisibilityUnstagedReason = "shared-sky-visibility-unstaged";
export const sharedSkyViewport160UnresolvedReason = "shared-sky-viewport160-unresolved";
export const sharedSkyPortalZoneVolumesUnresolvedReason = "shared-sky-portal-zone-volumes-unresolved";

export interface SharedSkyMainViewTrigger {
  readonly sharedSkyTriggerNode: number;
  readonly sharedSkyOtherZoneCandidates: number;
}

export interface SharedSkyViewTrigger {
  frame(): SharedSkyMainViewTrigger | null;
}

export interface WorldGroupDepthClear {
  readonly autoClear: boolean;
  readonly depth: boolean;
  readonly stencil: boolean;
}

const direct3dClearDepthFlag = 2;
const clearedDepth = 1;
const worldRenderingGroup = 1;

export function worldGroupDepthClear(clear: SharedSkyDepthClear, engine: AbstractEngine): WorldGroupDepthClear {
  if (clear.colorCleared) throw new Error("The shared sky clear rule clears colour, which Babylon does not clear between rendering groups.");
  if (clear.depth !== clearedDepth || engine.useReverseDepthBuffer) throw new Error(`The shared sky clear rule clears depth to ${clear.depth}, which this engine does not.`);
  const depth = (clear.flags & direct3dClearDepthFlag) !== 0;
  return { autoClear: depth || clear.stencilCleared, depth, stencil: clear.stencilCleared };
}

function requireSkyMesh(mesh: AbstractMesh): Mesh {
  if (!(mesh instanceof Mesh)) throw new Error(`${mesh.name} is not a Mesh, so its sky draw queue cannot be rewritten.`);
  return mesh;
}

function viewGateGaps(viewTrigger: SharedSkyViewTrigger | null, mainView: SharedSkyMainViewTrigger | null): string[] {
  if (viewTrigger === null) return [sharedSkyViewGateUnresolvedReason];
  return [sharedSkyViewport160UnresolvedReason, ...(mainView !== null && mainView.sharedSkyOtherZoneCandidates > 0 ? [sharedSkyPortalZoneVolumesUnresolvedReason] : [])];
}

interface LoadedSharedSky {
  readonly source: NativeSharedSkySource;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

async function loadSharedSky(signal: AbortSignal): Promise<LoadedSharedSky | null> {
  const source = await readSharedSkySource(signal);
  if (source === null) return null;
  const bytes = await fetchVerifiedNativeResource(source.glb.resource, source.glb.sha256, signal, source.glb.bytes);
  return { source, bytes };
}

export async function createNativeSkyPresentation(scene: Scene, signal: AbortSignal, skyMaterialUniforms: (() => NativeMaterialUniforms) | null,
  environmentColours: SkyEnvironmentColourSources | null, viewTrigger: SharedSkyViewTrigger | null) {
  signal.throwIfAborted();
  if (!scene.useRightHandedSystem) throw new Error("Native sky needs the world right-handed coordinate adapter.");
  const loaded = await loadSharedSky(signal);
  if (!loaded) return null;
  const { source, bytes } = loaded;
  validateSectionGlb(bytes);
  let container: AssetContainer | undefined, skyRoot: TransformNode | undefined;
  try {
    container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: ".glb" });
    signal.throwIfAborted();
    if (scene.isDisposed) throw new Error("Sky scene disposed while loading.");
    skyRoot = new TransformNode("Native shared sky · skylevel", scene);
    skyRoot.metadata = { nativeSharedSky: { schemaVersion: 1, manifestSha256: source.manifestSha256, sourceId: source.sourceId } };
    for (const node of container.rootNodes) node.parent = skyRoot;
    container.addAllToScene();
  } catch (error) { container?.dispose(); skyRoot?.dispose(); throw error; }
  const root = skyRoot;
  const skyMeshes = root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0);
  let libraryBinding: NativeSkyLibraryBinding, visibilityDriver: NativeSkyVisibilityDriver | null;
  try {
    if (skyMeshes.length !== source.materialRoots || skyMeshes.some(mesh => !mesh.material)) {
      throw new Error(`Shared sky requires one material mesh for each of its ${source.materialRoots} material roots.`);
    }
    const partMeshes = skyMeshes.map(mesh => ({ mesh: requireSkyMesh(mesh), sourceReference: readNativeSourceReference(mesh.material) }));
    const listing = await loadNativeSkyMaterialsListing(source.snapshot, signal);
    libraryBinding = await bindNativeSkyLibraryMaterials({ scene, meshes: skyMeshes, listing, sessionSeed: drawNativeSessionSeed(), materialUniforms: skyMaterialUniforms,
      environmentColours, loadProgram: loadNativeMaterial, signal });
    const visibility = await loadNativeSkyVisibility(source, signal);
    visibilityDriver = visibility === null ? null : driveNativeSkyVisibility(scene, partMeshes, visibility);
  } catch (error) { container.dispose(); root.dispose(); throw error; }
  const materials = [...new Set(skyMeshes.map(mesh => mesh.material!))];
  for (const material of materials) { material.fogEnabled = false; material.backFaceCulling = BLEND_CONSTANTS.sharedSkyBackFaceCulling.runtimeDefault; }
  skyMeshes.forEach((mesh, index) => { if (libraryBinding.surfaces[index]!.status !== "library-compiled") mesh.material!.disableDepthWrite = true; });
  const skySet = new Set(skyMeshes), worldGroups = new Map<AbstractMesh, number>();
  const rootPosition = root.position.clone();
  const autoClear = { ...scene.getAutoClearDepthStencilSetup(worldRenderingGroup) };
  const worldClear = worldGroupDepthClear(sharedSkyVisibilityRules.depthClear, scene.getEngine());
  let disposed = false, mainView: SharedSkyMainViewTrigger | null = null, drawn = viewTrigger === null;
  const drawWorldMeshAfterSkyRoom = (mesh: AbstractMesh) => {
    if (skySet.has(mesh) || mesh.renderingGroupId !== 0 || worldGroups.has(mesh)) return;
    worldGroups.set(mesh, 0); mesh.renderingGroupId = 1;
  };
  for (const mesh of skyMeshes) { mesh.renderingGroupId = 0; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; mesh.isVisible = drawn; }
  for (const mesh of scene.meshes) drawWorldMeshAfterSkyRoom(mesh);
  scene.setRenderingAutoClearDepthStencil(worldRenderingGroup, worldClear.autoClear, worldClear.depth, worldClear.stencil);
  const meshesNotifiedSinceLastDraw = new Set<AbstractMesh>();
  let meshCountCheckedBeforeDraw = scene.meshes.length;
  const added = scene.onNewMeshAddedObservable.add(mesh => meshesNotifiedSinceLastDraw.add(mesh));
  const followCameraAndSeparateMeshesAddedBeforeDraw = scene.onBeforeCameraRenderObservable.add(camera => {
    if (meshCountCheckedBeforeDraw !== scene.meshes.length) {
      for (const mesh of scene.meshes) drawWorldMeshAfterSkyRoom(mesh);
      meshCountCheckedBeforeDraw = scene.meshes.length;
    }
    for (const mesh of meshesNotifiedSinceLastDraw) if (!mesh.isDisposed()) drawWorldMeshAfterSkyRoom(mesh);
    meshesNotifiedSinceLastDraw.clear();
    root.position.copyFrom(rootPosition).addInPlace(camera.globalPosition);
    root.computeWorldMatrix(true);
    mainView = viewTrigger?.frame() ?? null;
    drawn = viewTrigger === null || (mainView !== null && mainView.sharedSkyTriggerNode !== indexNone);
    if (visibilityDriver !== null) visibilityDriver.step(drawn);
    else for (const mesh of skyMeshes) mesh.isVisible = drawn;
  });
  const dispose = () => {
    if (disposed) return; disposed = true;
    libraryBinding.dispose();
    signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(onDispose); scene.onBeforeCameraRenderObservable.remove(followCameraAndSeparateMeshesAddedBeforeDraw); scene.onNewMeshAddedObservable.remove(added);
    meshesNotifiedSinceLastDraw.clear();
    for (const [mesh, group] of worldGroups) if (!mesh.isDisposed() && mesh.renderingGroupId === 1) mesh.renderingGroupId = group;
    scene.setRenderingAutoClearDepthStencil(worldRenderingGroup, autoClear.autoClear, autoClear.depth, autoClear.stencil);
    container.dispose(); root.dispose();
  };
  const onDispose = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  return { dispose,
    inspection: () => ({ status: disposed ? "disposed" : "shared-sky", manifestSha256: source.manifestSha256, sourceId: source.sourceId,
    meshes: skyMeshes.length, vertices: skyMeshes.reduce((n, mesh) => n + mesh.getTotalVertices(), 0),
    triangles: skyMeshes.reduce((n, mesh) => n + mesh.getTotalIndices() / 3, 0),
    texturesReady: skyMeshes.every(mesh => mesh.material?.getActiveTextures().every(texture => texture.isReady()) ?? true),
    mode: viewTrigger === null ? "shared SkyLevel drawn on every tile; browser camera-follow background"
      : "shared SkyLevel drawn when the main view selects a FakeBackdrop node; browser camera-follow background",
    drawGate: viewTrigger === null ? "always" : "fakebackdrop-trigger", drawn, triggerNode: mainView?.sharedSkyTriggerNode ?? indexNone,
    gaps: [...viewGateGaps(viewTrigger, mainView), ...(visibilityDriver === null ? [sharedSkyVisibilityUnstagedReason] : visibilityDriver.gaps())],
    skyVisibility: visibilityDriver?.inspection() ?? null,
    librarySurfaces: libraryBinding.surfaces, environmentColours: libraryBinding.environmentColours(),
    nativeCloudMotion: "unverified", nativeVisibleParity: "unverified",
  }) };
}

export type NativeSkyPresentation = NonNullable<Awaited<ReturnType<typeof createNativeSkyPresentation>>>;

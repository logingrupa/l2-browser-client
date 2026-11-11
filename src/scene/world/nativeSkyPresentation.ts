import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { sha256 } from "../../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { validateSectionGlb } from "./loadNativeSection";
import { selectNativeSkyLiteral, type NativeEnvironmentTables } from "./nativeEnvironmentTables";
import { createNativeSkyLiteralComparison } from "./nativeSkyLiteralComparison";
import { readSelectedTileSkySource } from "./nativeTileSkySource";
import { surfaceMaterialProgramId } from "./lighting/surfaceMaterialProgram";
import { selectedNativeTileIdentity } from "./selectedNativeTile";

export const nativeSkySource = {
  manifestSha256: "f7a0b5ef1463d0b5fe47b210585e00d6011be3c3e3bddfec76df0eb08042f80b",
  sourceId: "interlude:20_20.Model798.SkyZoneInfo0",
  sourceMapSha256: "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4",
  modelSha256: "b8c5a64fb1682fa9865c202459c7516cf2690112a34ebb33a972cc2278c7f983",
  modelBytes: 451180,
  materialRoots: 3,
} as const;

interface LoadedSkySource {
  readonly manifestSha256: string;
  readonly sourceId: string;
  readonly materialRoots: number;
  readonly tileId: string | null;
  readonly tileSkyGap: string | null;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

async function fetchPinnedSkyGlb(signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
  const response = await fetch(nativeResourceUrl(`/l2/skies/${nativeSkySource.manifestSha256}/sky.glb`), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Sky source returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  if (bytes.byteLength !== nativeSkySource.modelBytes || await sha256(bytes) !== nativeSkySource.modelSha256) {
    throw new Error("Sky source hash/length mismatch.");
  }
  return bytes;
}

async function loadSkySource(signal: AbortSignal, tileSelected: boolean): Promise<LoadedSkySource | null> {
  if (!tileSelected) {
    const bytes = await fetchPinnedSkyGlb(signal);
    return bytes && { manifestSha256: nativeSkySource.manifestSha256, sourceId: nativeSkySource.sourceId, materialRoots: nativeSkySource.materialRoots,
      tileId: null, tileSkyGap: null, bytes };
  }
  const tileSky = await readSelectedTileSkySource(globalThis.location, signal);
  if (tileSky === null || tileSky.status === "absent") return null;
  if (tileSky.status === "gap") throw new Error(`Native tile ${tileSky.tileId} sky is a gap: ${tileSky.reason}.`);
  const bytes = await fetchVerifiedNativeResource(tileSky.glb.resource, tileSky.glb.sha256, signal, tileSky.glb.bytes);
  return { manifestSha256: tileSky.manifestSha256, sourceId: tileSky.sourceId, materialRoots: tileSky.materialRoots, tileId: tileSky.tileId,
    tileSkyGap: tileSky.gapReason, bytes };
}

export async function createNativeSkyPresentation(scene: Scene, signal: AbortSignal) {
  signal.throwIfAborted();
  const tileSelected = selectedNativeTileIdentity(globalThis.location) !== null;
  const candidates = tileSelected ? [] : scene.transformNodes.filter(node => node.metadata?.nativeSkyRoot);
  if (candidates.length > 1) throw new Error("Multiple authored native sky roots.");
  let root: TransformNode | undefined = candidates[0], container: AssetContainer | undefined;
  const authored = !!root;
  let source: Omit<LoadedSkySource, "bytes"> = { manifestSha256: nativeSkySource.manifestSha256, sourceId: nativeSkySource.sourceId,
    materialRoots: nativeSkySource.materialRoots, tileId: null, tileSkyGap: null };
  if (!scene.useRightHandedSystem) throw new Error("Native sky needs the world right-handed coordinate adapter.");
  if (root) {
    const marker = root.metadata.nativeSkyRoot;
    if (marker.schemaVersion !== 1 || marker.manifestSha256 !== nativeSkySource.manifestSha256 ||
      marker.sourceId !== nativeSkySource.sourceId || marker.sourceMapSha256 !== nativeSkySource.sourceMapSha256 ||
      marker.sourceSnapshot !== true || root.parent || root.isWorldMatrixFrozen ||
      root.rotation.lengthSquared() !== 0 || root.rotationQuaternion && !root.rotationQuaternion.equalsToFloats(0, 0, 0, 1) ||
      root.scaling.x !== 1 || root.scaling.y !== 1 || Math.abs(root.scaling.z) !== 1) {
      throw new Error("Authored sky root has an unsupported identity or coordinate adapter.");
    }
  } else {
    const loaded = await loadSkySource(signal, tileSelected);
    if (!loaded) return null;
    const { bytes, ...identity } = loaded;
    source = identity;
    validateSectionGlb(bytes);
    try {
      container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: ".glb" });
      signal.throwIfAborted();
      if (scene.isDisposed) throw new Error("Sky scene disposed while loading.");
      root = new TransformNode("Native sky · stored source state", scene);
      root.metadata = { nativeSkyRoot: { schemaVersion: 1, manifestSha256: source.manifestSha256, sourceId: source.sourceId, tileId: source.tileId,
        sourceSnapshot: true } };
      for (const node of container.rootNodes) node.parent = root;
      container.addAllToScene();
    } catch (error) { container?.dispose(); root?.dispose(); throw error; }
  }
  const skyRoot = root;
  const skyMeshes = skyRoot.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0);
  if (skyMeshes.length !== source.materialRoots || skyMeshes.some(mesh => !mesh.material)) {
    if (!authored) { container?.dispose(); skyRoot.dispose(); }
    throw new Error(`Sky snapshot requires one material mesh for each of its ${source.materialRoots} material roots.`);
  }
  let librarySurfaces;
  try {
    librarySurfaces = skyMeshes.map(mesh => ({ mesh: mesh.name, programMaterialId: surfaceMaterialProgramId(mesh.material) }))
      .map(surface => ({ ...surface, status: surface.programMaterialId === null ? "program-unconverted" as const : "library-environment-clock-unwired" as const }));
  } catch (error) {
    if (!authored) { container?.dispose(); skyRoot.dispose(); }
    throw error;
  }
  const skySet = new Set(skyMeshes), worldGroups = new Map<AbstractMesh, number>();
  const savedRoot = { position: skyRoot.position.clone(), z: skyRoot.scaling.z };
  const savedMeshes = skyMeshes.map(mesh => ({ mesh, group: mesh.renderingGroupId, pickable: mesh.isPickable,
    active: mesh.alwaysSelectAsActiveMesh, orientation: mesh instanceof Mesh ? mesh.sideOrientation : null }));
  const materials = [...new Set(skyMeshes.map(mesh => mesh.material!))].map(material => ({ material,
    fog: material.fogEnabled, depthWrite: material.disableDepthWrite }));
  const autoClear = { ...scene.getAutoClearDepthStencilSetup(1) };
  let disposed = false;
  let comparison: ReturnType<typeof createNativeSkyLiteralComparison> | undefined;
  const drawWorldMeshAfterSkyRoom = (mesh: AbstractMesh) => {
    if (skySet.has(mesh) || mesh.renderingGroupId !== 0 || worldGroups.has(mesh)) return;
    worldGroups.set(mesh, 0); mesh.renderingGroupId = 1;
  };
  skyRoot.scaling.z = 1;
  for (const { mesh, orientation } of savedMeshes) {
    if (authored && savedRoot.z === -1 && mesh instanceof Mesh && orientation !== null) mesh.sideOrientation = 1 - orientation;
    mesh.renderingGroupId = 0; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
  }
  for (const entry of materials) { entry.material.fogEnabled = false; entry.material.disableDepthWrite = true; }
  for (const mesh of scene.meshes) drawWorldMeshAfterSkyRoom(mesh);
  scene.setRenderingAutoClearDepthStencil(1, true, true, true);
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
    skyRoot.position.copyFrom(savedRoot.position).addInPlace(camera.globalPosition);
    skyRoot.computeWorldMatrix(true);
  });
  const dispose = () => {
    if (disposed) return; disposed = true;
    comparison?.dispose();
    signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(onDispose); scene.onBeforeCameraRenderObservable.remove(followCameraAndSeparateMeshesAddedBeforeDraw); scene.onNewMeshAddedObservable.remove(added);
    meshesNotifiedSinceLastDraw.clear();
    for (const [mesh, group] of worldGroups) if (!mesh.isDisposed() && mesh.renderingGroupId === 1) mesh.renderingGroupId = group;
    scene.setRenderingAutoClearDepthStencil(1, autoClear.autoClear, autoClear.depth, autoClear.stencil);
    for (const entry of materials) { entry.material.fogEnabled = entry.fog; entry.material.disableDepthWrite = entry.depthWrite; }
    if (authored) {
      skyRoot.position.copyFrom(savedRoot.position); skyRoot.scaling.z = savedRoot.z;
      for (const entry of savedMeshes) {
        entry.mesh.renderingGroupId = entry.group; entry.mesh.isPickable = entry.pickable; entry.mesh.alwaysSelectAsActiveMesh = entry.active;
        if (entry.mesh instanceof Mesh && entry.orientation !== null) entry.mesh.sideOrientation = entry.orientation;
      }
    } else { container?.dispose(); skyRoot.dispose(); }
  };
  const onDispose = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  return { dispose,
    applyEnvironmentLiteral(data: NativeEnvironmentTables, file: string, key: string) {
      if (disposed) throw new Error("Sky presentation was disposed.");
      const literal = selectNativeSkyLiteral(data, file, key);
      comparison ??= createNativeSkyLiteralComparison(skyMeshes);
      comparison.apply(literal);
    },
    restoreEnvironmentLiteral() { comparison?.restore(); },
    inspection: () => ({ status: disposed ? "disposed" : "source-snapshot", authored,
    manifestSha256: source.manifestSha256, sourceId: source.sourceId, tileId: source.tileId, tileSkyGap: source.tileSkyGap,
    meshes: skyMeshes.length, vertices: skyMeshes.reduce((n, mesh) => n + mesh.getTotalVertices(), 0),
    triangles: skyMeshes.reduce((n, mesh) => n + mesh.getTotalIndices() / 3, 0),
    texturesReady: materials.every(entry => entry.material.getActiveTextures().every(texture => texture.isReady())),
    mode: "source sky room; browser camera-follow background; optional literal color comparison",
    comparison: comparison?.inspection() ?? null, librarySurfaces,
    nativeTimeOfDay: "unverified", nativeCloudMotion: "unverified", nativeVisibleParity: "unverified",
  }) };
}

export type NativeSkyPresentation = NonNullable<Awaited<ReturnType<typeof createNativeSkyPresentation>>>;

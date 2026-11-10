import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { assetPackageLimits, readAssetPackage } from "../../assets/package/readAssetPackage";
import {
  decodeNativeJsonResource, fetchVerifiedNativeResource, inspectNativeWorldScene, loadNativeGlbContainer, nativeMeshBounds, terrainInfoChunkPlanWindow, validateSectionGlb,
  type NativeSection, type NativeSectionManifest,
} from "./loadNativeSection";
import { attachTileVisibility, type AttachedTileVisibility } from "./bspVisibility/attachTileVisibility";
import { attachTileLighting, type AttachedTileLighting } from "./lighting/attachTileLighting";
import { parseNativeBspSectionExtras, type NativeBspNodeRange, type NativeBspSection, type NativeTileBspResource } from "./nativeBspResources";
import { loadNativeTileMovers, type NativeTileMovers } from "./loadNativeTileMovers";
import { loadTileMapEmitterPlacements } from "./tileMapEmitterPlacements";
import { disposeNativeModelInstances, instantiateNativeModelPlacements, type NativeModelInstance } from "./nativeModelPlacements";
import {
  describeNativeTileGapRow, parseNativeTileChunkManifest, type NativeTileChunkManifest, type NativeTileChunkModel, type NativeTileChunkPlacement,
  type NativeTileChunkTerrain, type NativeTileVector,
} from "./nativeTileChunkManifest";
import { readNativeTileManifest, type NativeTileManifest } from "./nativeTileManifest";

export interface NativeTileTerrainChunk {
  readonly chunkId: string;
  readonly terrain: NativeTileChunkTerrain | null;
  readonly gaps: readonly string[];
}

export interface NativeTileSpawnAnchor {
  readonly playerStart: string;
  readonly authoredSourceLocation: NativeTileVector;
  readonly terrainSurfacePosition: readonly number[];
  readonly authoredHeightAboveTerrainMetres: number;
  readonly rule: typeof tileSpawnAnchorRule;
}

export interface NativeTileBspChunk {
  readonly chunkId: string;
  readonly resource: string;
  readonly sections: readonly NativeBspSection[];
  readonly nodeRanges: readonly NativeBspNodeRange[];
  readonly meshes: readonly AbstractMesh[];
}

export interface NativeTileSectionView extends Pick<NativeSectionManifest, "models" | "placements" | "bsp" | "terrainPatches" | "unsupportedRuntimeMaterials"> {
  readonly kind: "native-tile-runtime";
  readonly tileId: string;
  readonly terrainChunks: readonly NativeTileTerrainChunk[];
  readonly bspChunks: readonly NativeTileBspChunk[];
  readonly anchor: NativeTileSpawnAnchor;
  readonly terrain: NativeSectionManifest["terrain"];
  readonly gaps: readonly string[];
}

interface LoadedChunkTerrain {
  readonly chunk: NativeTileChunkManifest;
  readonly terrain: NativeTileChunkTerrain;
  readonly bytes: number;
  readonly meshes: readonly AbstractMesh[];
}

interface AnchorOnChunkTerrain {
  readonly chunk: LoadedChunkTerrain;
  readonly surface: Vector3;
}

const maximumChunkTerrainBytes = 128 * 1024 * 1024;
const maximumChunkBspBytes = 128 * 1024 * 1024;
const sourceUnitsToGltfMetres = 0.01;
const tileSpawnAnchorRule = "authored PlayerStart XY on the chunk terrain surface; authored Z kept as a diagnostic";
const surfaceRayClearanceMetres = 1;
const staticMeshStep = "meshes";

function authoredAnchorPosition(manifest: NativeTileManifest): Vector3 {
  const [x, y, z] = manifest.anchor.location;
  return new Vector3(x, z, y).scale(sourceUnitsToGltfMetres);
}

function terrainSurfaceHeight(meshes: readonly AbstractMesh[], position: Vector3, minimumY: number, maximumY: number): number | null {
  const ray = new Ray(new Vector3(position.x, maximumY + surfaceRayClearanceMetres, position.z), new Vector3(0, -1, 0),
    maximumY - minimumY + 2 * surfaceRayClearanceMetres);
  const heights = meshes.map(mesh => mesh.intersects(Ray.Transform(ray, mesh.computeWorldMatrix(true).clone().invert()), false).pickedPoint?.y)
    .filter((height): height is number => height !== undefined);
  return heights.length ? Math.max(...heights) : null;
}

function anchorOnChunkTerrain(loaded: readonly LoadedChunkTerrain[], authored: Vector3): AnchorOnChunkTerrain {
  for (const entry of loaded) {
    const { minimum, maximum } = nativeMeshBounds(entry.meshes);
    if (authored.x < minimum.x || authored.x > maximum.x || authored.z < minimum.z || authored.z > maximum.z) continue;
    const height = terrainSurfaceHeight(entry.meshes, authored, minimum.y, maximum.y);
    if (height !== null) return { chunk: entry, surface: new Vector3(authored.x, height, authored.z) };
  }
  throw new Error("The tile anchor lies outside every chunk terrain.");
}

function tileModelsById(chunks: readonly NativeTileChunkManifest[]): ReadonlyMap<string, NativeTileChunkModel> {
  const models = new Map<string, NativeTileChunkModel>(), placementIds = new Set<string>();
  for (const model of chunks.flatMap(chunk => chunk.models)) {
    const listed = models.get(model.id);
    if (listed && listed.archiveSha256 !== model.archiveSha256) throw new Error(`Native tile lists model ${model.id} with two archives.`);
    models.set(model.id, listed ?? model);
    for (const placement of model.placements) {
      if (placementIds.has(placement.id)) throw new Error(`Native tile lists placement ${placement.id} twice.`);
      placementIds.add(placement.id);
    }
  }
  return models;
}

async function loadTileModelTemplate(scene: Scene, model: NativeTileChunkModel, signal: AbortSignal): Promise<AssetContainer> {
  const archive = await fetchVerifiedNativeResource(model.archive, model.archiveSha256, signal);
  if (archive.byteLength > assetPackageLimits.archiveBytes) throw new Error(`Native tile model archive exceeds ${assetPackageLimits.archiveBytes} bytes: ${model.id}`);
  const asset = await readAssetPackage(archive);
  signal.throwIfAborted();
  const modelFile = asset.manifest.kind === "model" ? asset.manifest.model?.file : undefined;
  const glb = modelFile === undefined ? undefined : asset.files.get(modelFile);
  if (asset.manifest.id !== model.id || glb === undefined) throw new Error(`Native tile model archive ${model.archive} is not the model ${model.id}.`);
  return loadNativeGlbContainer(scene, model.archive, new Uint8Array(glb));
}

async function loadChunkBsp(scene: Scene, tileId: string, chunkId: string, bsp: NativeTileBspResource, signal: AbortSignal) {
  const bytes = await fetchVerifiedNativeResource(bsp.resource, bsp.sha256, signal);
  if (bytes.byteLength > maximumChunkBspBytes) throw new Error(`Native tile chunk BSP exceeds ${maximumChunkBspBytes} bytes: ${chunkId}`);
  const { sections, nodeRanges } = parseNativeBspSectionExtras(validateSectionGlb(bytes).extras);
  const container = await loadNativeGlbContainer(scene, bsp.resource, bytes);
  const meshes = container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
  if (meshes.length !== sections.length) {
    container.dispose();
    throw new Error(`Native tile chunk BSP ${chunkId} holds ${meshes.length} meshes for ${sections.length} sections.`);
  }
  for (const mesh of meshes) mesh.metadata = { ...mesh.metadata, nativeTileBsp: { tileId, chunkId, resource: bsp.resource } };
  const chunk: NativeTileBspChunk = { chunkId, resource: bsp.resource, sections, nodeRanges, meshes };
  return { container, chunk };
}

function chunkMeshGapCount(chunks: readonly NativeTileChunkManifest[]): number {
  return chunks.filter(chunk => chunk.gaps.some(row => row.step === staticMeshStep && row.status !== "pass")).length;
}

export async function loadNativeTileChunks(scene: Scene, signal: AbortSignal, tileId: string): Promise<NativeSection | null> {
  signal.throwIfAborted();
  if (scene.isDisposed || !scene.useRightHandedSystem) throw new Error("Native tile requires a live right-handed scene.");
  const lifetime = new AbortController(), containers: AssetContainer[] = [], templates = new Map<string, AssetContainer>();
  const instances: NativeModelInstance<NativeTileChunkPlacement>[] = [];
  let tileMovers: NativeTileMovers | null = null, tileVisibility: AttachedTileVisibility | null = null, tileLighting: AttachedTileLighting | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(observer);
    tileMovers?.dispose();
    tileVisibility?.dispose();
    tileLighting?.dispose();
    disposeNativeModelInstances(instances);
    for (const container of [...containers, ...templates.values()]) container.dispose();
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const pinnedManifest = await readNativeTileManifest(tileId, lifetime.signal);
    if (!pinnedManifest) { dispose(); return null; }
    const manifest = pinnedManifest.manifest;
    const chunks: NativeTileChunkManifest[] = [];
    for (const chunkRecord of manifest.chunks) {
      const chunk = parseNativeTileChunkManifest(decodeNativeJsonResource(
        await fetchVerifiedNativeResource(chunkRecord.manifest, chunkRecord.manifestSha256, lifetime.signal, chunkRecord.manifestBytes), "Native tile chunk manifest"));
      if (chunk.tileId !== tileId || chunk.chunkId !== chunkRecord.chunkId) throw new Error(`Native tile chunk manifest differs from its record ${chunkRecord.chunkId}.`);
      chunks.push(chunk);
    }
    const loaded: LoadedChunkTerrain[] = [];
    for (const chunk of chunks) {
      if (!chunk.terrain) continue;
      const bytes = await fetchVerifiedNativeResource(chunk.terrain.resource, chunk.terrain.sha256, lifetime.signal);
      if (bytes.byteLength > maximumChunkTerrainBytes) throw new Error(`Native tile chunk terrain exceeds ${maximumChunkTerrainBytes} bytes: ${chunk.chunkId}`);
      const container = await loadNativeGlbContainer(scene, chunk.terrain.resource, bytes);
      if (disposed || scene.isDisposed) { container.dispose(); throw new Error("Native tile was disposed during loading."); }
      containers.push(container);
      const meshes = container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
      if (!meshes.length) throw new Error(`Native tile chunk terrain has no geometry: ${chunk.chunkId}`);
      for (const mesh of meshes) {
        mesh.metadata = { ...mesh.metadata, worldTerrain: true, worldSupportsWalking: true, nativeTileChunk: { tileId, chunkId: chunk.chunkId } };
        mesh.isPickable = true;
      }
      loaded.push({ chunk, terrain: chunk.terrain, bytes: bytes.byteLength, meshes });
    }
    const authoredAnchor = authoredAnchorPosition(manifest);
    const { chunk: anchorChunk, surface: spawnCandidate } = anchorOnChunkTerrain(loaded, authoredAnchor);
    const anchor: NativeTileSpawnAnchor = { playerStart: manifest.anchor.playerStart, authoredSourceLocation: manifest.anchor.location,
      terrainSurfacePosition: spawnCandidate.asArray(), authoredHeightAboveTerrainMetres: authoredAnchor.y - spawnCandidate.y, rule: tileSpawnAnchorRule };
    const models = tileModelsById(chunks);
    for (const model of models.values()) {
      const template = await loadTileModelTemplate(scene, model, lifetime.signal);
      if (disposed || scene.isDisposed) { template.dispose(); throw new Error("Native tile was disposed during loading."); }
      templates.set(model.id, template);
    }
    instances.push(...instantiateNativeModelPlacements(scene, templates, chunks.flatMap(chunk => chunk.models.flatMap(model => model.placements))));
    const bspChunks: NativeTileBspChunk[] = [];
    for (const chunk of chunks) {
      if (!chunk.bsp) continue;
      const { container, chunk: bspChunk } = await loadChunkBsp(scene, tileId, chunk.chunkId, chunk.bsp, lifetime.signal);
      if (disposed || scene.isDisposed) { container.dispose(); throw new Error("Native tile was disposed during loading."); }
      containers.push(container);
      bspChunks.push(bspChunk);
    }
    tileVisibility = await attachTileVisibility(scene, manifest,
      { bspChunks, placements: instances, terrainMeshes: loaded.flatMap(entry => entry.meshes) }, lifetime.signal);
    if (disposed || scene.isDisposed) throw new Error("Native tile was disposed during loading.");
    const chunkOrdinalById = new Map(manifest.chunks.map((record, ordinal) => [record.chunkId, ordinal]));
    const visibilityBinding = tileVisibility.binding;
    tileLighting = await attachTileLighting(scene, manifest, { bspChunks: bspChunks.map(chunk => ({ ...chunk, chunkOrdinal: chunkOrdinalById.get(chunk.chunkId)! })),
      staticMeshes: instances.flatMap(instance => instance.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0)),
      terrainMeshes: loaded.flatMap(entry => entry.meshes), cameraFrame: () => visibilityBinding?.frame() ?? null }, lifetime.signal);
    if (disposed || scene.isDisposed) throw new Error("Native tile was disposed during loading.");
    const mapEmitterPlacements = await loadTileMapEmitterPlacements(manifest, lifetime.signal);
    if (disposed || scene.isDisposed) throw new Error("Native tile was disposed during loading.");
    const moverResource = manifest.resources.find(resource => resource.kind === "movers");
    if (moverResource) {
      tileMovers = await loadNativeTileMovers(scene, moverResource, lifetime.signal);
      if (disposed || scene.isDisposed) throw new Error("Native tile was disposed during loading.");
      if (tileMovers.manifest.tileId !== tileId) throw new Error(`Native tile mover manifest names tile ${tileMovers.manifest.tileId}, not ${tileId}.`);
    }
    const moverTargets = tileMovers?.targets ?? [];
    const bspMeshes = bspChunks.flatMap(chunk => chunk.meshes);
    for (const container of containers) container.addAllToScene();
    const terrainMeshes = loaded.flatMap(entry => entry.meshes);
    const terrainChunks = chunks.map(chunk => ({ chunkId: chunk.chunkId, terrain: chunk.terrain,
      gaps: chunk.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) }));
    const view: NativeTileSectionView = { kind: "native-tile-runtime", tileId, terrainChunks, bspChunks, anchor, models: [], placements: [],
      terrain: { file: "terrain.glb", sha256: anchorChunk.terrain.sha256, bytes: anchorChunk.bytes, materialStatus: "neutral-inspection" },
      gaps: manifest.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) };
    const meshGapCount = chunkMeshGapCount(chunks);
    const extent = nativeMeshBounds(terrainMeshes);
    lifetime.signal.throwIfAborted();
    return { manifest: view, manifestSha256: pinnedManifest.manifestSha256, terrainMeshes, supportMeshes: [], ...extent, spawnCandidate, moverTargets,
      tileVisibility: tileVisibility.binding, environmentClock: tileLighting.environmentClock,
      inspection: () => ({ ...inspectNativeWorldScene({ terrainMeshes, instances, modelCount: templates.size, disposed, preview: null, previewEnabled: false,
        materialFailure: null, unsupportedRuntimeMaterials: [], bspMeshes, sectionWindow: terrainInfoChunkPlanWindow }),
        terrainChunks, tileAnchor: anchor, meshGapCount, bspSections: bspChunks.reduce((sum, chunk) => sum + chunk.sections.length, 0),
        bspResources: bspChunks.map(chunk => chunk.resource), moverCount: moverTargets.length,
        moverCollisionMeshCount: moverTargets.flatMap(target => target.meshes).filter(mesh => mesh.metadata?.worldCollision === true).length,
        movers: moverTargets.map(target => target.inspection()), bspVisibility: tileVisibility!.inspection(), lighting: tileLighting!.inspection(),
        mapEmitterPlacements: { gap: mapEmitterPlacements.gap, placements: mapEmitterPlacements.inspection(exportIndex => visibilityBinding?.memberVisible(exportIndex) ?? true) } }),
      setTerrainPreview() {}, dispose };
  } catch (error) { dispose(); throw error; }
}

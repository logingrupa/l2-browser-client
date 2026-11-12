import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { nativeMeshBounds, type NativeSection, type NativeSectionManifest } from "./loadNativeSection";
import { attachNativeTileSystems, type AttachedNativeTileSystems, type NativeTileChunkSystemContents } from "./attachNativeTileSystems";
import type { NativeBspNodeRange, NativeBspSection } from "./nativeBspResources";
import { collisionCellContextFor } from "./movement/collisionCellContext";
import {
  anchorOnChunkTerrain, authoredAnchorPosition, describeTerrainChunks, loadChunkBsp, loadChunkTerrain, loadTileModelTemplate, readTileChunkManifests, tileSpawnAnchor,
  type LoadedChunkTerrain, type TileSpawnAnchorRule,
} from "./nativeTileChunkContents";
import { inspectNativeTileSection } from "./nativeTileSectionInspection";
import { disposeNativeModelInstances, instantiateNativeModelPlacements, type NativeModelInstance } from "./nativeModelPlacements";
import {
  describeNativeTileGapRow, type NativeTileChunkManifest, type NativeTileChunkModel, type NativeTileChunkPlacement, type NativeTileChunkTerrain,
  type NativeTileVector,
} from "./nativeTileChunkManifest";
import { readNativeTileManifest } from "./nativeTileManifest";
import { streamNativeTileChunks } from "./streamNativeTileChunks";

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
  readonly rule: TileSpawnAnchorRule;
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

const disposedDuringLoading = () => new Error("Native tile was disposed during loading.");

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

function chunkSystemContentsOfTile(chunks: readonly NativeTileChunkManifest[], terrainMeshesByChunkId: ReadonlyMap<string, readonly AbstractMesh[]>,
  bspChunks: readonly NativeTileBspChunk[], instances: readonly NativeModelInstance<NativeTileChunkPlacement>[]): NativeTileChunkSystemContents[] {
  const chunkIdByPlacementId = new Map(chunks.flatMap(chunk => chunk.models.flatMap(model => model.placements.map(placement => [placement.id, chunk.chunkId] as const))));
  return chunks.map(chunk => ({ chunkId: chunk.chunkId, bspChunk: bspChunks.find(bspChunk => bspChunk.chunkId === chunk.chunkId) ?? null,
    instances: instances.filter(instance => chunkIdByPlacementId.get(instance.source.id) === chunk.chunkId), terrainMeshes: terrainMeshesByChunkId.get(chunk.chunkId) ?? [] }));
}

export async function loadNativeTileChunks(scene: Scene, signal: AbortSignal, tileId: string): Promise<NativeSection | null> {
  signal.throwIfAborted();
  if (scene.isDisposed || !scene.useRightHandedSystem) throw new Error("Native tile requires a live right-handed scene.");
  const collisionCellContext = collisionCellContextFor(scene);
  if (collisionCellContext !== null) return streamNativeTileChunks(scene, signal, tileId, collisionCellContext);
  const lifetime = new AbortController(), containers: AssetContainer[] = [], templates = new Map<string, AssetContainer>();
  const instances: NativeModelInstance<NativeTileChunkPlacement>[] = [];
  let systems: AttachedNativeTileSystems | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(observer);
    systems?.dispose();
    disposeNativeModelInstances(instances);
    for (const container of [...containers, ...templates.values()]) container.dispose();
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const pinnedManifest = await readNativeTileManifest(tileId, lifetime.signal);
    if (!pinnedManifest) { dispose(); return null; }
    const manifest = pinnedManifest.manifest;
    const chunks = await readTileChunkManifests(manifest, lifetime.signal);
    const loaded: LoadedChunkTerrain[] = [], terrainMeshesByChunkId = new Map<string, readonly AbstractMesh[]>();
    for (const chunk of chunks) {
      if (!chunk.terrain) continue;
      const terrain = await loadChunkTerrain(scene, chunk, chunk.terrain, lifetime.signal);
      if (disposed || scene.isDisposed) { terrain.container.dispose(); throw disposedDuringLoading(); }
      containers.push(terrain.container);
      for (const mesh of terrain.meshes) mesh.metadata = { ...mesh.metadata, worldSupportsWalking: true };
      loaded.push(terrain);
      terrainMeshesByChunkId.set(chunk.chunkId, terrain.meshes);
    }
    const authoredAnchor = authoredAnchorPosition(manifest);
    const { chunk: anchorChunk, surface: spawnCandidate } = anchorOnChunkTerrain(loaded, authoredAnchor);
    const anchor = tileSpawnAnchor(manifest, authoredAnchor, spawnCandidate);
    for (const model of tileModelsById(chunks).values()) {
      const template = await loadTileModelTemplate(scene, model, lifetime.signal);
      if (disposed || scene.isDisposed) { template.dispose(); throw disposedDuringLoading(); }
      templates.set(model.id, template);
    }
    instances.push(...instantiateNativeModelPlacements(scene, templates, chunks.flatMap(chunk => chunk.models.flatMap(model => model.placements))));
    const bspChunks: NativeTileBspChunk[] = [];
    for (const chunk of chunks) {
      if (!chunk.bsp) continue;
      const { container, chunk: bspChunk } = await loadChunkBsp(scene, tileId, chunk.chunkId, chunk.bsp, lifetime.signal);
      if (disposed || scene.isDisposed) { container.dispose(); throw disposedDuringLoading(); }
      containers.push(container);
      bspChunks.push(bspChunk);
    }
    const terrainMeshes = loaded.flatMap(entry => entry.meshes);
    const attached = await attachNativeTileSystems(scene, manifest, chunkSystemContentsOfTile(chunks, terrainMeshesByChunkId, bspChunks, instances), lifetime.signal,
      () => disposed || scene.isDisposed);
    systems = attached;
    for (const container of containers) container.addAllToScene();
    const view: NativeTileSectionView = { kind: "native-tile-runtime", tileId, terrainChunks: describeTerrainChunks(chunks), bspChunks, anchor, models: [], placements: [],
      terrain: { file: "terrain.glb", sha256: anchorChunk.terrain.sha256, bytes: anchorChunk.bytes, materialStatus: "neutral-inspection" },
      gaps: manifest.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) };
    const extent = nativeMeshBounds(terrainMeshes);
    const countedMeshes = () => [...terrainMeshes, ...bspChunks.flatMap(chunk => chunk.meshes), ...instances.flatMap(instance => instance.root.getChildMeshes())];
    lifetime.signal.throwIfAborted();
    return { manifest: view, manifestSha256: pinnedManifest.manifestSha256, terrainMeshes, supportMeshes: [], ...extent, spawnCandidate,
      tileMovers: attached.movers, tileVisibility: attached.visibility.binding, environmentClock: attached.lighting.environmentClock,
      inspection: () => inspectNativeTileSection({ tileId, chunks, terrainMeshes, instances, bspChunks, modelCount: templates.size, disposed, anchor,
        systems: attached, loadedChunkCount: chunks.length, countedMeshes: countedMeshes() }),
      setTerrainPreview() {}, dispose };
  } catch (error) { dispose(); throw error; }
}

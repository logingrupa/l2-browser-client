import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { readTileCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import {
  fetchVerifiedNativeResource, inspectNativeWorldScene, loadNativeGlbContainer, nativeMeshBounds,
  type NativeSection, type NativeSectionManifest,
} from "./loadNativeSection";
import { describeNativeTileGapRow, parseNativeTileChunkManifest, type NativeTileChunkManifest, type NativeTileChunkTerrain } from "./nativeTileChunkManifest";
import { parseNativeTileManifest, type NativeTileManifest } from "./nativeTileManifest";

export interface NativeTileTerrainChunk {
  readonly chunkId: string;
  readonly terrain: NativeTileChunkTerrain | null;
  readonly gaps: readonly string[];
}

export interface NativeTileSectionView extends Pick<NativeSectionManifest, "models" | "placements" | "bsp" | "terrainPatches" | "unsupportedRuntimeMaterials"> {
  readonly kind: "native-tile-runtime";
  readonly tileId: string;
  readonly terrainChunks: readonly NativeTileTerrainChunk[];
  readonly terrain: NativeSectionManifest["terrain"];
  readonly gaps: readonly string[];
}

interface LoadedChunkTerrain {
  readonly chunk: NativeTileChunkManifest;
  readonly terrain: NativeTileChunkTerrain;
  readonly bytes: number;
  readonly meshes: readonly AbstractMesh[];
}

const maximumChunkTerrainBytes = 128 * 1024 * 1024;
const sourceUnitsToGltfMetres = 0.01;

function decodeJsonResource(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not UTF-8 JSON.`); }
}

function anchorSpawnCandidate(manifest: NativeTileManifest): Vector3 {
  const [x, y, z] = manifest.anchor.location;
  return new Vector3(x, z, y).scale(sourceUnitsToGltfMetres);
}

function chunkTerrainContaining(loaded: readonly LoadedChunkTerrain[], spawnCandidate: Vector3): LoadedChunkTerrain {
  const anchorChunk = loaded.find(({ meshes }) => {
    const { minimum, maximum } = nativeMeshBounds(meshes);
    return spawnCandidate.x >= minimum.x && spawnCandidate.x <= maximum.x && spawnCandidate.z >= minimum.z && spawnCandidate.z <= maximum.z;
  });
  if (!anchorChunk) throw new Error("The tile anchor lies outside every chunk terrain.");
  return anchorChunk;
}

async function selectedTileRecord(signal: AbortSignal, tileId: string) {
  const catalog = await readNativeCatalogUnlessNotStaged(signal);
  if (!catalog) return null;
  const records = catalog.tiles.map(readTileCatalogRecord).filter(record => record.tile === tileId);
  if (records.length > 1) throw new Error(`Native catalog lists tile ${tileId} twice.`);
  return records[0] ?? null;
}

export async function loadNativeTileChunks(scene: Scene, signal: AbortSignal, tileId: string): Promise<NativeSection | null> {
  signal.throwIfAborted();
  if (scene.isDisposed || !scene.useRightHandedSystem) throw new Error("Native tile requires a live right-handed scene.");
  const lifetime = new AbortController(), containers: AssetContainer[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(observer);
    for (const container of containers) container.dispose();
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const record = await selectedTileRecord(lifetime.signal, tileId);
    if (!record) { dispose(); return null; }
    const manifest = parseNativeTileManifest(decodeJsonResource(
      await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, lifetime.signal, record.manifestBytes), "Native tile manifest"));
    if (manifest.tileId !== tileId) throw new Error(`Native tile manifest names tile ${manifest.tileId}, not ${tileId}.`);
    const chunks: NativeTileChunkManifest[] = [];
    for (const chunkRecord of manifest.chunks) {
      const chunk = parseNativeTileChunkManifest(decodeJsonResource(
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
    const spawnCandidate = anchorSpawnCandidate(manifest);
    const anchorChunk = chunkTerrainContaining(loaded, spawnCandidate);
    for (const container of containers) container.addAllToScene();
    const terrainMeshes = loaded.flatMap(entry => entry.meshes);
    const terrainChunks = chunks.map(chunk => ({ chunkId: chunk.chunkId, terrain: chunk.terrain,
      gaps: chunk.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) }));
    const view: NativeTileSectionView = { kind: "native-tile-runtime", tileId, terrainChunks, models: [], placements: [],
      terrain: { file: "terrain.glb", sha256: anchorChunk.terrain.sha256, bytes: anchorChunk.bytes, materialStatus: "neutral-inspection" },
      gaps: manifest.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) };
    const extent = nativeMeshBounds(terrainMeshes);
    lifetime.signal.throwIfAborted();
    return { manifest: view, manifestSha256: record.manifestSha256, terrainMeshes, supportMeshes: [], ...extent, spawnCandidate,
      inspection: () => ({ ...inspectNativeWorldScene({ terrainMeshes, instances: [], modelCount: 0, disposed, preview: null, previewEnabled: false,
        materialFailure: null, unsupportedRuntimeMaterials: [], bspMeshes: [] }), terrainChunks }),
      setTerrainPreview() {}, dispose };
  } catch (error) { dispose(); throw error; }
}

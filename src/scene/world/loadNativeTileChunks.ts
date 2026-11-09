import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { readTileCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import {
  fetchVerifiedNativeResource, inspectNativeWorldScene, loadNativeGlbContainer, nativeMeshBounds, terrainInfoChunkPlanWindow,
  type NativeSection, type NativeSectionManifest,
} from "./loadNativeSection";
import {
  describeNativeTileGapRow, parseNativeTileChunkManifest, type NativeTileChunkManifest, type NativeTileChunkTerrain, type NativeTileVector,
} from "./nativeTileChunkManifest";
import { parseNativeTileManifest, type NativeTileManifest } from "./nativeTileManifest";

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

export interface NativeTileSectionView extends Pick<NativeSectionManifest, "models" | "placements" | "bsp" | "terrainPatches" | "unsupportedRuntimeMaterials"> {
  readonly kind: "native-tile-runtime";
  readonly tileId: string;
  readonly terrainChunks: readonly NativeTileTerrainChunk[];
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
const sourceUnitsToGltfMetres = 0.01;
const tileSpawnAnchorRule = "authored PlayerStart XY on the chunk terrain surface; authored Z kept as a diagnostic";
const surfaceRayClearanceMetres = 1;

function decodeJsonResource(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not UTF-8 JSON.`); }
}

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
    const authoredAnchor = authoredAnchorPosition(manifest);
    const { chunk: anchorChunk, surface: spawnCandidate } = anchorOnChunkTerrain(loaded, authoredAnchor);
    const anchor: NativeTileSpawnAnchor = { playerStart: manifest.anchor.playerStart, authoredSourceLocation: manifest.anchor.location,
      terrainSurfacePosition: spawnCandidate.asArray(), authoredHeightAboveTerrainMetres: authoredAnchor.y - spawnCandidate.y, rule: tileSpawnAnchorRule };
    for (const container of containers) container.addAllToScene();
    const terrainMeshes = loaded.flatMap(entry => entry.meshes);
    const terrainChunks = chunks.map(chunk => ({ chunkId: chunk.chunkId, terrain: chunk.terrain,
      gaps: chunk.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) }));
    const view: NativeTileSectionView = { kind: "native-tile-runtime", tileId, terrainChunks, anchor, models: [], placements: [],
      terrain: { file: "terrain.glb", sha256: anchorChunk.terrain.sha256, bytes: anchorChunk.bytes, materialStatus: "neutral-inspection" },
      gaps: manifest.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) };
    const extent = nativeMeshBounds(terrainMeshes);
    lifetime.signal.throwIfAborted();
    return { manifest: view, manifestSha256: record.manifestSha256, terrainMeshes, supportMeshes: [], ...extent, spawnCandidate,
      inspection: () => ({ ...inspectNativeWorldScene({ terrainMeshes, instances: [], modelCount: 0, disposed, preview: null, previewEnabled: false,
        materialFailure: null, unsupportedRuntimeMaterials: [], bspMeshes: [], sectionWindow: terrainInfoChunkPlanWindow }), terrainChunks, tileAnchor: anchor }),
      setTerrainPreview() {}, dispose };
  } catch (error) { dispose(); throw error; }
}

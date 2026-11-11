import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { assetPackageLimits, readAssetPackage } from "../../assets/package/readAssetPackage";
import { sourcePositionToWorld } from "../../world/sourceFrame";
import { decodeNativeJsonResource, fetchVerifiedNativeResource, loadNativeGlbContainer, nativeMeshBounds, validateSectionGlb } from "./loadNativeSection";
import type { NativeTileBspChunk, NativeTileSpawnAnchor, NativeTileTerrainChunk } from "./loadNativeTileChunks";
import { parseNativeBspSectionExtras, type NativeTileBspResource } from "./nativeBspResources";
import {
  describeNativeTileGapRow, parseNativeTileChunkManifest, type NativeTileChunkManifest, type NativeTileChunkModel, type NativeTileChunkTerrain,
} from "./nativeTileChunkManifest";
import type { NativeTileManifest } from "./nativeTileManifest";

export interface LoadedChunkTerrain {
  readonly container: AssetContainer;
  readonly terrain: NativeTileChunkTerrain;
  readonly bytes: number;
  readonly meshes: readonly AbstractMesh[];
}

export interface TerrainChunkForAnchor {
  readonly terrain: NativeTileChunkTerrain;
  readonly bytes: number;
  readonly meshes: readonly AbstractMesh[];
}

export interface AnchorOnChunkTerrain<Entry extends TerrainChunkForAnchor> {
  readonly chunk: Entry;
  readonly surface: Vector3;
}

const maximumChunkTerrainBytes = 128 * 1024 * 1024;
const maximumChunkBspBytes = 128 * 1024 * 1024;
const tileSpawnAnchorRule = "authored PlayerStart XY on the chunk terrain surface; authored Z kept as a diagnostic";
const surfaceRayClearanceMetres = 1;
const staticMeshStep = "meshes";

export type TileSpawnAnchorRule = typeof tileSpawnAnchorRule;

export function authoredAnchorPosition(manifest: NativeTileManifest): Vector3 {
  const [x, y, z] = manifest.anchor.location;
  const world = sourcePositionToWorld({ x, y, z });
  return new Vector3(world.x, world.y, world.z);
}

function terrainSurfaceHeight(meshes: readonly AbstractMesh[], position: Vector3, minimumY: number, maximumY: number): number | null {
  const ray = new Ray(new Vector3(position.x, maximumY + surfaceRayClearanceMetres, position.z), new Vector3(0, -1, 0),
    maximumY - minimumY + 2 * surfaceRayClearanceMetres);
  const heights = meshes.map(mesh => mesh.intersects(Ray.Transform(ray, mesh.computeWorldMatrix(true).clone().invert()), false).pickedPoint?.y)
    .filter((height): height is number => height !== undefined);
  return heights.length ? Math.max(...heights) : null;
}

export function anchorOnChunkTerrain<Entry extends TerrainChunkForAnchor>(loaded: readonly Entry[], authored: Vector3): AnchorOnChunkTerrain<Entry> {
  for (const entry of loaded) {
    const { minimum, maximum } = nativeMeshBounds(entry.meshes);
    if (authored.x < minimum.x || authored.x > maximum.x || authored.z < minimum.z || authored.z > maximum.z) continue;
    const height = terrainSurfaceHeight(entry.meshes, authored, minimum.y, maximum.y);
    if (height !== null) return { chunk: entry, surface: new Vector3(authored.x, height, authored.z) };
  }
  throw new Error("The tile anchor lies outside every chunk terrain.");
}

export function tileSpawnAnchor(manifest: NativeTileManifest, authored: Vector3, spawnCandidate: Vector3): NativeTileSpawnAnchor {
  return { playerStart: manifest.anchor.playerStart, authoredSourceLocation: manifest.anchor.location,
    terrainSurfacePosition: spawnCandidate.asArray(), authoredHeightAboveTerrainMetres: authored.y - spawnCandidate.y, rule: tileSpawnAnchorRule };
}

export async function readTileChunkManifests(manifest: NativeTileManifest, signal: AbortSignal): Promise<NativeTileChunkManifest[]> {
  const chunks: NativeTileChunkManifest[] = [];
  for (const chunkRecord of manifest.chunks) {
    const chunk = parseNativeTileChunkManifest(decodeNativeJsonResource(
      await fetchVerifiedNativeResource(chunkRecord.manifest, chunkRecord.manifestSha256, signal, chunkRecord.manifestBytes), "Native tile chunk manifest"));
    if (chunk.tileId !== manifest.tileId || chunk.chunkId !== chunkRecord.chunkId) throw new Error(`Native tile chunk manifest differs from its record ${chunkRecord.chunkId}.`);
    chunks.push(chunk);
  }
  return chunks;
}

export async function loadChunkTerrain(scene: Scene, chunk: NativeTileChunkManifest, terrain: NativeTileChunkTerrain, signal: AbortSignal): Promise<LoadedChunkTerrain> {
  const bytes = await fetchVerifiedNativeResource(terrain.resource, terrain.sha256, signal);
  if (bytes.byteLength > maximumChunkTerrainBytes) throw new Error(`Native tile chunk terrain exceeds ${maximumChunkTerrainBytes} bytes: ${chunk.chunkId}`);
  const container = await loadNativeGlbContainer(scene, terrain.resource, bytes);
  const meshes = container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
  if (!meshes.length) {
    container.dispose();
    throw new Error(`Native tile chunk terrain has no geometry: ${chunk.chunkId}`);
  }
  for (const mesh of meshes) {
    mesh.metadata = { ...mesh.metadata, worldTerrain: true, nativeTileChunk: { tileId: chunk.tileId, chunkId: chunk.chunkId } };
    mesh.isPickable = true;
  }
  return { container, terrain, bytes: bytes.byteLength, meshes };
}

export async function loadTileModelTemplate(scene: Scene, model: NativeTileChunkModel, signal: AbortSignal): Promise<AssetContainer> {
  const archive = await fetchVerifiedNativeResource(model.archive, model.archiveSha256, signal);
  if (archive.byteLength > assetPackageLimits.archiveBytes) throw new Error(`Native tile model archive exceeds ${assetPackageLimits.archiveBytes} bytes: ${model.id}`);
  const asset = await readAssetPackage(archive);
  signal.throwIfAborted();
  const modelFile = asset.manifest.kind === "model" ? asset.manifest.model?.file : undefined;
  const glb = modelFile === undefined ? undefined : asset.files.get(modelFile);
  if (asset.manifest.id !== model.id || glb === undefined) throw new Error(`Native tile model archive ${model.archive} is not the model ${model.id}.`);
  return loadNativeGlbContainer(scene, model.archive, new Uint8Array(glb));
}

export async function loadChunkBsp(scene: Scene, tileId: string, chunkId: string, bsp: NativeTileBspResource, signal: AbortSignal) {
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

export function chunkMeshGapCount(chunks: readonly NativeTileChunkManifest[]): number {
  return chunks.filter(chunk => chunk.gaps.some(row => row.step === staticMeshStep && row.status !== "pass")).length;
}

export function describeTerrainChunks(chunks: readonly NativeTileChunkManifest[]): NativeTileTerrainChunk[] {
  return chunks.map(chunk => ({ chunkId: chunk.chunkId, terrain: chunk.terrain, gaps: chunk.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) }));
}

function isCollisionMesh(mesh: AbstractMesh): boolean {
  return mesh.metadata?.worldSupportsWalking === true || mesh.metadata?.worldCollision === true;
}

export function tileMeshCounts(meshes: readonly AbstractMesh[]) {
  const liveMeshes = meshes.filter(mesh => !mesh.isDisposed() && mesh.getTotalVertices() > 0);
  return {
    meshCount: liveMeshes.length,
    vertexCount: liveMeshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0),
    collisionMeshCount: liveMeshes.filter(isCollisionMesh).length,
  };
}

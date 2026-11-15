import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { assetPackageLimits, readAssetPackage } from "../../assets/package/readAssetPackage";
import { committedMovementRules } from "../../runtime/committedMovementRules";
import { sourcePositionToWorld, worldPositionToSource } from "../../world/sourceFrame";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource, loadNativeGlbContainer, validateSectionGlb } from "./loadNativeSection";
import type { CollisionPrimitive } from "./movement/core/collisionTrace";
import type { CollisionWorld } from "./movement/core/collisionWorld";
import { singleLineCheck } from "./movement/core/lineCheck";
import type { WorldResidencyFootprint } from "./worldResidencyRing";
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

export interface TileAnchorCandidate {
  readonly tileId: string;
  readonly chunkId: string;
  readonly footprint: WorldResidencyFootprint;
}

export interface TileAnchorFloor {
  readonly position: Vector3;
  readonly primitiveKind: CollisionPrimitive["kind"];
}

export interface TileAnchorPlacement<Candidate extends TileAnchorCandidate> {
  readonly chunk: Candidate;
  readonly floor: TileAnchorFloor;
}

export type TileAnchorFloorProbe = (authored: Vector3) => TileAnchorFloor | null;

const maximumChunkTerrainBytes = 128 * 1024 * 1024;
const maximumChunkBspBytes = 128 * 1024 * 1024;
const tileSpawnAnchorRule = "authored PlayerStart XY in the chunk plan footprint; first collision hit below the authored location; authored Z kept as a diagnostic";
const staticMeshStep = "meshes";
const zeroExtent = { x: 0, y: 0, z: 0 };

export const tileAnchorOutsideChunkFootprints = "tile-anchor-outside-every-chunk-footprint";
export const tileAnchorHasNoFloor = "tile-anchor-has-no-floor";

export type TileSpawnAnchorRule = typeof tileSpawnAnchorRule;

export function authoredAnchorPosition(manifest: NativeTileManifest): Vector3 {
  const [x, y, z] = manifest.anchor.location;
  const world = sourcePositionToWorld({ x, y, z });
  return new Vector3(world.x, world.y, world.z);
}

const footprintHolds = (footprint: WorldResidencyFootprint, x: number, z: number) =>
  x >= footprint.minimumX && x <= footprint.maximumX && z >= footprint.minimumZ && z <= footprint.maximumZ;

export function collisionFloorBelow(world: CollisionWorld, authored: Vector3, lowestTerrainHeightMetres: number): TileAnchorFloor | null {
  const start = worldPositionToSource(authored);
  const lowestTerrainZ = worldPositionToSource({ x: authored.x, y: lowestTerrainHeightMetres, z: authored.z }).z;
  const end = { ...start, z: Math.min(lowestTerrainZ, world.lowestBspPointZ() ?? Infinity) - committedMovementRules.pawn.maxStepHeight };
  if (!(end.z < start.z)) return null;
  const hit = singleLineCheck(world, { start, end, extent: zeroExtent }, committedMovementRules);
  if (hit === null) return null;
  const floor = sourcePositionToWorld(hit.location);
  return { position: new Vector3(floor.x, floor.y, floor.z), primitiveKind: hit.primitive.kind };
}

export function anchorOnChunkFloor<Candidate extends TileAnchorCandidate>(candidates: readonly Candidate[], authored: Vector3,
  floorBelow: TileAnchorFloorProbe): TileAnchorPlacement<Candidate> {
  const chunk = candidates.find(candidate => footprintHolds(candidate.footprint, authored.x, authored.z));
  if (chunk === undefined) throw new Error(`${tileAnchorOutsideChunkFootprints}: the authored PlayerStart XY lies in no loaded chunk plan footprint.`);
  const floor = floorBelow(authored);
  if (floor === null) throw new Error(`${tileAnchorHasNoFloor}: no collision lies below the authored PlayerStart in ${chunk.tileId}/${chunk.chunkId}.`);
  return { chunk, floor };
}

export function tileSpawnAnchor(manifest: NativeTileManifest, authored: Vector3, placement: TileAnchorPlacement<TileAnchorCandidate>): NativeTileSpawnAnchor {
  const { chunk, floor } = placement;
  return { playerStart: manifest.anchor.playerStart, authoredSourceLocation: manifest.anchor.location, anchorChunk: { tileId: chunk.tileId, chunkId: chunk.chunkId },
    floorPosition: floor.position.asArray(), floorPrimitiveKind: floor.primitiveKind, authoredHeightAboveFloorMetres: authored.y - floor.position.y,
    rule: tileSpawnAnchorRule };
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

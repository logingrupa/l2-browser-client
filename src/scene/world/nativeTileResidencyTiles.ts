import { readTileCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import type { CollisionCellFootprint } from "./movement/core/collisionWorld";
import type { CollisionBspTree } from "./movement/core/collisionCell";
import { loadChunkCollisionCell, loadTileBspTree, nativeTileCollisionCellId } from "./movement/loadCollisionCells";
import { readTileChunkManifests } from "./nativeTileChunkContents";
import { chunkSourceFootprint, residencyFootprintFromSource, tileTerrainGridFromProbeCell, type TileTerrainGrid } from "./nativeTileChunkFootprints";
import type { NativeTileChunkManifest } from "./nativeTileChunkManifest";
import { readNativeTileManifest, type NativeTileManifest, type NativeTileResource } from "./nativeTileManifest";
import type { ResidencyChunk } from "./nativeTileChunkResidency";

export interface ResidencyTile {
  readonly tileId: string;
  readonly manifest: NativeTileManifest;
  readonly manifestSha256: string;
  readonly chunks: readonly NativeTileChunkManifest[];
  readonly chunkManifestsById: ReadonlyMap<string, NativeTileChunkManifest>;
  readonly tileCollision: NativeTileResource;
  readonly grid: TileTerrainGrid;
  readonly residencyChunks: readonly ResidencyChunk[];
  readonly expectedSourceFootprints: ReadonlyMap<string, CollisionCellFootprint>;
  tileBspTree(): Promise<CollisionBspTree>;
}

const tileCollisionResourceKind = "native-tile-collision";
const tileIdPattern = /^\d{2}_\d{2}$/;

export async function readCatalogTileIds(signal: AbortSignal): Promise<ReadonlySet<string>> {
  const catalog = await readNativeCatalogUnlessNotStaged(signal);
  return new Set(catalog === null ? [] : catalog.tiles.map(readTileCatalogRecord).map(record => record.tile));
}

export async function readResidencyTile(tileId: string, lifetimeSignal: AbortSignal): Promise<ResidencyTile | null> {
  if (!tileIdPattern.test(tileId)) throw new Error(`Residency tile id ${JSON.stringify(tileId)} is not XX_YY.`);
  const pinned = await readNativeTileManifest(tileId, lifetimeSignal);
  if (pinned === null) return null;
  const manifest = pinned.manifest;
  const tileCollision = manifest.resources.find(resource => resource.kind === tileCollisionResourceKind);
  if (tileCollision === undefined) throw new Error(`Native tile ${tileId} pins no ${tileCollisionResourceKind} resource.`);
  const chunks = await readTileChunkManifests(manifest, lifetimeSignal);
  const probeChunk = chunks.find(chunk => chunk.collision !== null);
  if (probeChunk === undefined) throw new Error(`Native tile ${tileId} has no chunk collision resource to derive its chunk footprints.`);
  const grid = tileTerrainGridFromProbeCell(await loadChunkCollisionCell(probeChunk, lifetimeSignal), probeChunk.sectorRange);
  const expectedSourceFootprints = new Map(chunks.map(chunk => [chunk.chunkId, chunkSourceFootprint(grid, chunk.sectorRange)]));
  const residencyChunks = chunks.map(chunk => ({ tileId, chunkId: chunk.chunkId, cellId: nativeTileCollisionCellId(tileId, chunk.chunkId),
    footprint: residencyFootprintFromSource(expectedSourceFootprints.get(chunk.chunkId)!) }));
  let tileBspTreeLoad: Promise<CollisionBspTree> | null = null;
  return { tileId, manifest, manifestSha256: pinned.manifestSha256, chunks, chunkManifestsById: new Map(chunks.map(chunk => [chunk.chunkId, chunk])),
    tileCollision, grid, residencyChunks, expectedSourceFootprints,
    tileBspTree: () => tileBspTreeLoad ??= loadTileBspTree(tileId, tileCollision, lifetimeSignal) };
}

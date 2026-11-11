import { createHash } from "node:crypto";
import { assetFixture } from "../../fixtures/assetPackageFixture";
import { syntheticTileMinimapManifest } from "../../fixtures/tileMinimapManifestFixture";

export interface SyntheticTileCatalogRecord {
  readonly id: string;
  readonly manifest: string;
  readonly manifestSha256: string;
  readonly manifestBytes: number;
}

export interface SyntheticMinimapTiles {
  readonly tiles: readonly SyntheticTileCatalogRecord[];
  readonly resources: ReadonlyMap<string, Uint8Array>;
}

const encoder = new TextEncoder();

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function syntheticTileManifest(tileId: string, minimapPath: string, minimapBytes: Uint8Array): Record<string, unknown> {
  const chunkSha256 = "1".repeat(64);
  return {
    kind: "native-tile-runtime", schemaVersion: 1, tileId, sourceMap: `maps/${tileId}.unr`, sourceSha256: "e".repeat(64),
    frame: { terrainInfo: `${tileId}.TerrainInfo0`, location: [0, 0, 0], terrainScale: [1, 1, 1] },
    anchor: { playerStart: `${tileId}.PlayerStart0`, location: [0, 0, 0] },
    chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${chunkSha256}/native-tile-chunk-runtime/manifest.json`, manifestSha256: chunkSha256, manifestBytes: 100 }],
    resources: [{ kind: "minimap", manifest: minimapPath, manifestSha256: sha256Hex(minimapBytes), manifestBytes: minimapBytes.byteLength }],
    gaps: [],
  };
}

export async function syntheticMinimapTiles(radarTileIds: readonly string[], radarGapTileIds: readonly string[]): Promise<SyntheticMinimapTiles> {
  const archiveBytes = (await assetFixture("texture")).bytes;
  const archiveSha256 = sha256Hex(archiveBytes);
  const resources = new Map<string, Uint8Array>([[`/l2/${archiveSha256}/asset.l2asset`, archiveBytes]]);
  const tiles: SyntheticTileCatalogRecord[] = [];
  const radarTiles = new Set(radarTileIds);
  for (const tileId of [...radarTileIds, ...radarGapTileIds]) {
    const radarArchive = radarTiles.has(tileId) ? { archiveSha256, archiveBytes: archiveBytes.byteLength } : null;
    const minimapBytes = encoder.encode(JSON.stringify(syntheticTileMinimapManifest(tileId, radarArchive)));
    const minimapPath = `/l2/maps/${sha256Hex(minimapBytes)}/native-tile-minimap/manifest.json`;
    const tileBytes = encoder.encode(JSON.stringify(syntheticTileManifest(tileId, minimapPath, minimapBytes)));
    const tileSha256 = sha256Hex(tileBytes);
    const tilePath = `/l2/tiles/${tileSha256}/tile.json`;
    resources.set(minimapPath, minimapBytes).set(tilePath, tileBytes);
    tiles.push({ id: tileId, manifest: tilePath, manifestSha256: tileSha256, manifestBytes: tileBytes.byteLength });
  }
  return { tiles, resources };
}

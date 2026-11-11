import { readTileCatalogRecord } from "../../../src/assets/native/nativeCatalogRecords";

export interface ServedTileManifests {
  readonly catalogUrl: string;
  readonly manifestSha256ByTile: ReadonlyMap<string, string>;
}

export function readServedTileManifests(catalog: unknown, catalogUrl: string): ServedTileManifests {
  const tileRecords: unknown = typeof catalog === "object" && catalog !== null && "tiles" in catalog ? catalog.tiles : undefined;
  if (!Array.isArray(tileRecords)) throw new Error(`served catalog ${catalogUrl} has no tiles list`);
  const manifestSha256ByTile = new Map(tileRecords.map(readTileCatalogRecord).map(record => [record.tile, record.manifestSha256] as const));
  return { catalogUrl, manifestSha256ByTile };
}

export function servedTileManifestSha256(servedTileManifests: ServedTileManifests, tileId: string): string {
  const manifestSha256 = servedTileManifests.manifestSha256ByTile.get(tileId);
  if (manifestSha256 === undefined) throw new Error(`served catalog ${servedTileManifests.catalogUrl} has no tiles record ${tileId}`);
  return manifestSha256;
}

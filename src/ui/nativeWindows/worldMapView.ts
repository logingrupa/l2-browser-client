import { tileIdPattern } from "../../assets/native/nativeCatalogRecords";
import { minimapTexturePosition, type NativeTileMinimap, type NativeTileMinimapProjection } from "../../scene/world/minimapJoin";
import { worldPositionToSource, type WorldPosition } from "../../world/sourceFrame";

export interface WorldMapTile { readonly tileId: string; readonly minimap: NativeTileMinimap | null }

export interface WorldMapCell {
  readonly tileId: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly status: "texture" | "gap";
  readonly reason?: string;
  readonly archive?: string;
}

export interface WorldMapMarker { readonly left: number; readonly top: number; readonly status: "unverified" }

export interface WorldMapViewLabels {
  readonly arrangement: "tile-grid, unverified";
  readonly scale: "one texture pixel per CSS pixel, presentation";
}

export interface WorldMapViewPlan {
  readonly cells: readonly WorldMapCell[];
  readonly marker: WorldMapMarker | null;
  readonly gap: string | null;
  readonly labels: WorldMapViewLabels;
}

export interface WorldMapViewInput {
  readonly controlWidth: number;
  readonly controlHeight: number;
  readonly tiles: readonly WorldMapTile[];
  readonly playerScenePosition: WorldPosition | null;
}

type ProjectedWorldMapTile = WorldMapTile & { readonly minimap: NativeTileMinimap & { readonly projection: NativeTileMinimapProjection } };

const worldMapViewLabels: WorldMapViewLabels = { arrangement: "tile-grid, unverified", scale: "one texture pixel per CSS pixel, presentation" };
const noConvertedTileReason = "no converted tile at the player position";
const localPlayerAbsentReason = "adapter-field-absent:position";
const tileMinimapNotInCatalogReason = "tile minimap resource not in catalog";
const largestTileGridCoordinate = 99;

function tileGridCoordinates(tileId: string): readonly [number, number] {
  const [column, row] = tileId.split("_").map(Number);
  return [column!, row!];
}

function tileIdAt(column: number, row: number): string {
  return `${String(column).padStart(2, "0")}_${String(row).padStart(2, "0")}`;
}

function isProjectedTile(tile: WorldMapTile): tile is ProjectedWorldMapTile {
  return tile.minimap !== null && tile.minimap.projection !== null;
}

function tilesById(tiles: readonly WorldMapTile[]): ReadonlyMap<string, WorldMapTile> {
  const byId = new Map<string, WorldMapTile>();
  for (const tile of tiles) {
    if (!tileIdPattern.test(tile.tileId)) throw new RangeError(`World map tile id ${JSON.stringify(tile.tileId)} is not a two-digit XX_YY tile id.`);
    if (byId.has(tile.tileId)) throw new RangeError(`World map tile id ${tile.tileId} is listed twice.`);
    byId.set(tile.tileId, tile);
  }
  return byId;
}

export function tileHoldingScenePosition(tiles: readonly WorldMapTile[], scenePosition: WorldPosition): ProjectedWorldMapTile | null {
  const nativePosition = worldPositionToSource(scenePosition);
  return tiles.filter(isProjectedTile).find(tile => {
    const [minimumX, minimumY] = tile.minimap.projection.frameMinimumNative, [maximumX, maximumY] = tile.minimap.projection.frameMaximumNative;
    return nativePosition.x >= minimumX && nativePosition.x < maximumX && nativePosition.y >= minimumY && nativePosition.y < maximumY;
  }) ?? null;
}

function worldMapCell(tile: WorldMapTile | undefined, tileId: string, left: number, top: number, width: number, height: number): WorldMapCell {
  const placement = { tileId, left, top, width, height };
  if (tile === undefined || tile.minimap === null) return { ...placement, status: "gap", reason: tileMinimapNotInCatalogReason };
  if (tile.minimap.radarTexture === null || tile.minimap.projection === null) {
    return { ...placement, status: "gap", reason: tile.minimap.gaps.map(gap => gap.reason).join(" ") };
  }
  return { ...placement, status: "texture", archive: tile.minimap.radarTexture.archive };
}

function gapPlan(reason: string): WorldMapViewPlan {
  return { cells: [], marker: null, gap: reason, labels: worldMapViewLabels };
}

function visibleOffsets(origin: number, cellSize: number, controlSize: number): readonly number[] {
  const firstOffset = Math.floor(-origin / cellSize), lastOffset = Math.ceil((controlSize - origin) / cellSize) - 1;
  return Array.from({ length: Math.max(0, lastOffset - firstOffset + 1) }, (_, index) => firstOffset + index);
}

export function planWorldMapView(input: WorldMapViewInput): WorldMapViewPlan {
  const byId = tilesById(input.tiles);
  if (input.playerScenePosition === null) return gapPlan(localPlayerAbsentReason);
  const sortedTiles = [...byId.values()].sort((left, right) => (left.tileId < right.tileId ? -1 : 1));
  const playerTile = tileHoldingScenePosition(sortedTiles, input.playerScenePosition);
  if (playerTile === null) return gapPlan(noConvertedTileReason);
  const projected = minimapTexturePosition(playerTile.minimap, input.playerScenePosition);
  if (projected.position === null) return gapPlan(projected.reason);
  const { textureWidth: cellWidth, textureHeight: cellHeight } = playerTile.minimap.projection;
  const centreLeft = input.controlWidth / 2, centreTop = input.controlHeight / 2;
  const originLeft = centreLeft - projected.position.u * cellWidth, originTop = centreTop - projected.position.v * cellHeight;
  const [playerColumn, playerRow] = tileGridCoordinates(playerTile.tileId);
  const cells: WorldMapCell[] = [];
  for (const rowOffset of visibleOffsets(originTop, cellHeight, input.controlHeight)) {
    for (const columnOffset of visibleOffsets(originLeft, cellWidth, input.controlWidth)) {
      const column = playerColumn + columnOffset, row = playerRow + rowOffset;
      if (column < 0 || row < 0 || column > largestTileGridCoordinate || row > largestTileGridCoordinate) continue;
      const tileId = tileIdAt(column, row);
      cells.push(worldMapCell(byId.get(tileId), tileId, originLeft + columnOffset * cellWidth, originTop + rowOffset * cellHeight, cellWidth, cellHeight));
    }
  }
  return { cells, marker: { left: centreLeft, top: centreTop, status: "unverified" }, gap: null, labels: worldMapViewLabels };
}

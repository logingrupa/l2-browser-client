import { sourcePositionToWorld } from "../../world/sourceFrame";
import type { CollisionCell } from "./movement/core/collisionCell";
import type { CollisionCellFootprint } from "./movement/core/collisionWorld";
import type { NativeTileSectorRange } from "./nativeTileChunkManifest";
import type { WorldResidencyFootprint } from "./worldResidencyRing";

export interface TileTerrainGrid {
  readonly locationX: number;
  readonly locationY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly heightmapWidth: number;
  readonly heightmapHeight: number;
  readonly quadsPerSector: number;
  readonly chunkEdgeSourceUnits: number;
}

export class NativeTileFootprintError extends Error {
  constructor(message: string) {
    super(`Native tile footprint: ${message}`);
    this.name = "NativeTileFootprintError";
  }
}

export function collisionCellTerrainFootprint(cell: CollisionCell): CollisionCellFootprint | null {
  const terrain = cell.terrain;
  if (terrain === null) return null;
  const [locationX, locationY] = terrain.location, [scaleX, scaleY] = terrain.terrainScale;
  const sourceX = (column: number) => locationX + (column - Math.floor(terrain.heightmapWidth / 2)) * scaleX;
  const sourceY = (row: number) => locationY + (row - Math.floor(terrain.heightmapHeight / 2)) * scaleY;
  return {
    minimumX: sourceX(terrain.firstColumn), minimumY: sourceY(terrain.firstRow),
    maximumX: sourceX(terrain.firstColumn + terrain.columns - 1), maximumY: sourceY(terrain.firstRow + terrain.rows - 1),
  };
}

export function chunkSourceFootprint(grid: TileTerrainGrid, sectorRange: NativeTileSectorRange): CollisionCellFootprint {
  const lastColumn = Math.min((sectorRange.lastColumn + 1) * grid.quadsPerSector, grid.heightmapWidth - 1);
  const lastRow = Math.min((sectorRange.lastRow + 1) * grid.quadsPerSector, grid.heightmapHeight - 1);
  const sourceX = (column: number) => grid.locationX + (column - Math.floor(grid.heightmapWidth / 2)) * grid.scaleX;
  const sourceY = (row: number) => grid.locationY + (row - Math.floor(grid.heightmapHeight / 2)) * grid.scaleY;
  return {
    minimumX: sourceX(sectorRange.firstColumn * grid.quadsPerSector), minimumY: sourceY(sectorRange.firstRow * grid.quadsPerSector),
    maximumX: sourceX(lastColumn), maximumY: sourceY(lastRow),
  };
}

export function sameCollisionFootprint(left: CollisionCellFootprint, right: CollisionCellFootprint): boolean {
  return left.minimumX === right.minimumX && left.minimumY === right.minimumY && left.maximumX === right.maximumX && left.maximumY === right.maximumY;
}

export function tileTerrainGridFromProbeCell(cell: CollisionCell, sectorRange: NativeTileSectorRange): TileTerrainGrid {
  const terrain = cell.terrain;
  if (terrain === null) throw new NativeTileFootprintError(`probe cell ${cell.cellId} holds no terrain.`);
  const sectorColumns = sectorRange.lastColumn - sectorRange.firstColumn + 1, sectorRows = sectorRange.lastRow - sectorRange.firstRow + 1;
  const quadsPerSector = (terrain.columns - 1) / sectorColumns;
  if (!Number.isSafeInteger(quadsPerSector) || quadsPerSector < 1 || (terrain.rows - 1) / sectorRows !== quadsPerSector) {
    throw new NativeTileFootprintError(`probe cell ${cell.cellId} spans ${terrain.columns}x${terrain.rows} vertices over ${sectorColumns}x${sectorRows} sectors.`);
  }
  const [locationX, locationY] = terrain.location, [scaleX, scaleY] = terrain.terrainScale;
  const grid: TileTerrainGrid = { locationX, locationY, scaleX, scaleY, heightmapWidth: terrain.heightmapWidth, heightmapHeight: terrain.heightmapHeight,
    quadsPerSector, chunkEdgeSourceUnits: (terrain.columns - 1) * scaleX };
  const decoded = collisionCellTerrainFootprint(cell)!;
  if (!sameCollisionFootprint(chunkSourceFootprint(grid, sectorRange), decoded)) {
    throw new NativeTileFootprintError(`probe cell ${cell.cellId} footprint differs from its sector range rule.`);
  }
  return grid;
}

export function residencyFootprintFromSource(footprint: CollisionCellFootprint): WorldResidencyFootprint {
  const minimum = sourcePositionToWorld({ x: footprint.minimumX, y: footprint.minimumY, z: 0 });
  const maximum = sourcePositionToWorld({ x: footprint.maximumX, y: footprint.maximumY, z: 0 });
  return { minimumX: minimum.x, minimumZ: minimum.z, maximumX: maximum.x, maximumZ: maximum.z };
}

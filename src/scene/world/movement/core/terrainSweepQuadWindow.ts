import { dotProduct, type Vector3 } from "../../../../shared/math/vector3";

export interface TerrainQuadGrid {
  readonly firstColumn: number;
  readonly firstRow: number;
  readonly quadColumns: number;
  readonly quadRows: number;
  readonly edgeToleranceGrowth: number;
}

export interface TerrainQuadWindow {
  readonly firstQuadColumn: number;
  readonly lastQuadColumn: number;
  readonly firstQuadRow: number;
  readonly lastQuadRow: number;
}

const roundingPaddingQuads = 1;

function cornerHorizontalGrowth(firstEdgeNormal: Vector3, secondEdgeNormal: Vector3): number {
  const firstSquared = dotProduct(firstEdgeNormal, firstEdgeNormal), secondSquared = dotProduct(secondEdgeNormal, secondEdgeNormal);
  const shared = dotProduct(firstEdgeNormal, secondEdgeNormal), determinant = firstSquared * secondSquared - shared * shared;
  const firstWeight = (secondSquared - shared) / determinant, secondWeight = (firstSquared - shared) / determinant;
  return Math.hypot(firstWeight * firstEdgeNormal.x + secondWeight * secondEdgeNormal.x, firstWeight * firstEdgeNormal.y + secondWeight * secondEdgeNormal.y);
}

export function edgeToleranceHorizontalGrowth(outwardEdgeNormals: readonly [Vector3, Vector3, Vector3]): number {
  const [edge0, edge1, edge2] = outwardEdgeNormals;
  return Math.max(cornerHorizontalGrowth(edge0, edge1), cornerHorizontalGrowth(edge1, edge2), cornerHorizontalGrowth(edge2, edge0));
}

export function sweptQuadWindow(grid: TerrainQuadGrid, start: Vector3, delta: Vector3, edgeTolerance: number): TerrainQuadWindow {
  const margin = edgeTolerance * grid.edgeToleranceGrowth + roundingPaddingQuads;
  const endX = start.x + delta.x, endY = start.y + delta.y;
  const lowColumn = Math.min(start.x, endX) - margin - grid.firstColumn, highColumn = Math.max(start.x, endX) + margin - grid.firstColumn;
  const lowRow = Math.min(start.y, endY) - margin - grid.firstRow, highRow = Math.max(start.y, endY) + margin - grid.firstRow;
  return {
    firstQuadColumn: Math.max(0, Math.ceil(lowColumn) - 1),
    lastQuadColumn: Math.min(grid.quadColumns - 1, Math.floor(highColumn)),
    firstQuadRow: Math.max(0, Math.ceil(lowRow) - 1),
    lastQuadRow: Math.min(grid.quadRows - 1, Math.floor(highRow)),
  };
}

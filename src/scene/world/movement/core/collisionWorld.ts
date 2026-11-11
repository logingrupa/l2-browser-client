import type { CollisionBspTree, CollisionCell } from "./collisionCell";

export class CollisionWorldError extends Error {
  constructor(message: string) {
    super(`Collision world: ${message}`);
    this.name = "CollisionWorldError";
  }
}

export interface CollisionCellFootprint {
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
}

export interface CollisionHorizontalPosition {
  readonly x: number;
  readonly y: number;
}

export type CollisionReadiness = "ready" | "cell-not-resident" | "no-collision-cell";

export interface CollisionWorldInspection {
  readonly requiredCellCount: number;
  readonly residentCellCount: number;
  readonly missingCellIds: readonly string[];
  readonly revision: number;
}

export interface CollisionWorld {
  requireCell(cellId: string, footprint: CollisionCellFootprint): void;
  addCell(cellId: string, cell: CollisionCell): void;
  removeCell(cellId: string): void;
  collisionReadiness(position: CollisionHorizontalPosition): CollisionReadiness;
  setTileBspTree(tileId: string, tree: CollisionBspTree): void;
  tileBspTree(tileId: string): CollisionBspTree | null;
  residentCells(): readonly CollisionCell[];
  inspection(): CollisionWorldInspection;
  clear(): void;
}

const compareCellIds = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function requireCellId(cellId: unknown, operation: string): asserts cellId is string {
  if (typeof cellId !== "string" || cellId.length === 0) throw new CollisionWorldError(`${operation} needs a non-empty cell id, not ${JSON.stringify(cellId)}.`);
}

function float32Footprint(cellId: string, footprint: CollisionCellFootprint): CollisionCellFootprint {
  const { minimumX, minimumY, maximumX, maximumY } = footprint;
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    throw new CollisionWorldError(`cell ${cellId} footprint must hold finite source units.`);
  }
  if (minimumX > maximumX || minimumY > maximumY) throw new CollisionWorldError(`cell ${cellId} footprint is inverted.`);
  return { minimumX: Math.fround(minimumX), minimumY: Math.fround(minimumY), maximumX: Math.fround(maximumX), maximumY: Math.fround(maximumY) };
}

const sameFootprint = (left: CollisionCellFootprint, right: CollisionCellFootprint) =>
  left.minimumX === right.minimumX && left.minimumY === right.minimumY && left.maximumX === right.maximumX && left.maximumY === right.maximumY;

const footprintHolds = (footprint: CollisionCellFootprint, x: number, y: number) =>
  x >= footprint.minimumX && x <= footprint.maximumX && y >= footprint.minimumY && y <= footprint.maximumY;

export function createCollisionWorld(): CollisionWorld {
  const footprintsByCellId = new Map<string, CollisionCellFootprint>();
  const cellsByCellId = new Map<string, CollisionCell>();
  const bspTreesByTileId = new Map<string, CollisionBspTree>();
  let revision = 0;

  const tileHasResidentCell = (tileId: string) => [...cellsByCellId.values()].some(cell => cell.tileId === tileId);

  return {
    requireCell(cellId, footprint) {
      requireCellId(cellId, "requireCell");
      const requiredFootprint = float32Footprint(cellId, footprint);
      const existingFootprint = footprintsByCellId.get(cellId);
      if (existingFootprint !== undefined) {
        if (!sameFootprint(existingFootprint, requiredFootprint)) throw new CollisionWorldError(`cell ${cellId} is already required with a different footprint.`);
        return;
      }
      footprintsByCellId.set(cellId, requiredFootprint);
      revision += 1;
    },
    addCell(cellId, cell) {
      requireCellId(cellId, "addCell");
      if (!footprintsByCellId.has(cellId)) throw new CollisionWorldError(`cell ${cellId} was never required.`);
      if (cellsByCellId.has(cellId)) throw new CollisionWorldError(`cell ${cellId} is already resident.`);
      if (cell.cellId !== cellId) throw new CollisionWorldError(`cell ${cellId} was given the decoded cell ${cell.cellId}.`);
      cellsByCellId.set(cellId, cell);
      revision += 1;
    },
    removeCell(cellId) {
      requireCellId(cellId, "removeCell");
      if (!footprintsByCellId.has(cellId)) throw new CollisionWorldError(`cell ${cellId} is not known.`);
      const removedCell = cellsByCellId.get(cellId);
      footprintsByCellId.delete(cellId);
      cellsByCellId.delete(cellId);
      if (removedCell !== undefined && !tileHasResidentCell(removedCell.tileId)) bspTreesByTileId.delete(removedCell.tileId);
      revision += 1;
    },
    collisionReadiness(position) {
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new CollisionWorldError("collisionReadiness needs a finite source-unit position.");
      const x = Math.fround(position.x), y = Math.fround(position.y);
      let heldByResidentCell = false;
      for (const [cellId, footprint] of footprintsByCellId) {
        if (!footprintHolds(footprint, x, y)) continue;
        if (!cellsByCellId.has(cellId)) return "cell-not-resident";
        heldByResidentCell = true;
      }
      return heldByResidentCell ? "ready" : "no-collision-cell";
    },
    setTileBspTree(tileId, tree) {
      if (typeof tileId !== "string" || tileId.length === 0) throw new CollisionWorldError("setTileBspTree needs a non-empty tile id.");
      if (bspTreesByTileId.has(tileId)) throw new CollisionWorldError(`tile ${tileId} already holds its BSP tree.`);
      if (!tileHasResidentCell(tileId)) throw new CollisionWorldError(`tile ${tileId} has no resident cell to hold its BSP tree.`);
      bspTreesByTileId.set(tileId, tree);
      revision += 1;
    },
    tileBspTree(tileId) {
      return bspTreesByTileId.get(tileId) ?? null;
    },
    residentCells() {
      return [...cellsByCellId.keys()].sort(compareCellIds).map(cellId => cellsByCellId.get(cellId)!);
    },
    inspection() {
      const missingCellIds = [...footprintsByCellId.keys()].filter(cellId => !cellsByCellId.has(cellId)).sort(compareCellIds);
      return { requiredCellCount: footprintsByCellId.size, residentCellCount: cellsByCellId.size, missingCellIds, revision };
    },
    clear() {
      if (footprintsByCellId.size === 0) return;
      footprintsByCellId.clear();
      cellsByCellId.clear();
      bspTreesByTileId.clear();
      revision += 1;
    },
  };
}

import { describe, expect, it } from "vitest";
import type { CollisionCell } from "../../src/scene/world/movement/core/collisionCell";
import { createCollisionWorld, type CollisionCellFootprint } from "../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import { collisionBspTreeFixtureArrays, collisionChunkFixtureArrays, readCollisionFixturePayload } from "../support/nativeTileCollisionFixture";

const firstCellId = "20_21/chunk-0-0";
const firstFootprint: CollisionCellFootprint = { minimumX: 0, minimumY: 0, maximumX: 4096, maximumY: 4096 };
const insideFirstCell = { x: 2048, y: 1024 };

const decodedCell = (cellId: string, tileId = "20_21"): CollisionCell =>
  decodeNativeTileCollisionCell(readCollisionFixturePayload(collisionChunkFixtureArrays()), { cellId, tileId });
const decodedTree = (tileId = "20_21") => decodeNativeTileBspTree(readCollisionFixturePayload(collisionBspTreeFixtureArrays()), tileId);

describe("collision world cells", () => {
  it("is not ready inside a required cell until the cell is added, and removing the cell drops its requirement", () => {
    const world = createCollisionWorld();
    expect(world.isReady(insideFirstCell)).toBe(true);
    world.requireCell(firstCellId, firstFootprint);
    expect(world.isReady(insideFirstCell)).toBe(false);
    expect(world.inspection()).toEqual({ requiredCellCount: 1, residentCellCount: 0, missingCellIds: [firstCellId], revision: 1 });
    const cell = decodedCell(firstCellId);
    world.addCell(firstCellId, cell);
    expect(world.isReady(insideFirstCell)).toBe(true);
    expect(world.residentCells()).toEqual([cell]);
    expect(world.inspection()).toEqual({ requiredCellCount: 1, residentCellCount: 1, missingCellIds: [], revision: 2 });
    world.removeCell(firstCellId);
    expect(world.residentCells()).toEqual([]);
    expect(world.inspection()).toEqual({ requiredCellCount: 0, residentCellCount: 0, missingCellIds: [], revision: 3 });
    expect(world.isReady(insideFirstCell)).toBe(true);
    world.requireCell(firstCellId, firstFootprint);
    expect(world.isReady(insideFirstCell)).toBe(false);
    expect(world.inspection().revision).toBe(4);
  });

  it("stays ready outside every missing cell footprint", () => {
    const world = createCollisionWorld();
    world.requireCell(firstCellId, firstFootprint);
    expect(world.isReady({ x: 4097, y: 1024 })).toBe(true);
    expect(world.isReady({ x: -1, y: 1024 })).toBe(true);
    expect(world.isReady({ x: 4096, y: 4096 })).toBe(false);
  });

  it("removes a required cell that never became resident in one revision", () => {
    const world = createCollisionWorld();
    world.requireCell(firstCellId, firstFootprint);
    world.removeCell(firstCellId);
    expect(world.inspection()).toEqual({ requiredCellCount: 0, residentCellCount: 0, missingCellIds: [], revision: 2 });
  });

  it("keeps one BSP tree per tile and releases it with the last resident cell of that tile", () => {
    const world = createCollisionWorld(), secondCellId = "20_21/chunk-0-1", tree = decodedTree();
    world.requireCell(firstCellId, firstFootprint);
    world.requireCell(secondCellId, { minimumX: 0, minimumY: 4096, maximumX: 4096, maximumY: 8192 });
    world.addCell(firstCellId, decodedCell(firstCellId));
    world.setTileBspTree("20_21", tree);
    world.addCell(secondCellId, decodedCell(secondCellId));
    expect(world.tileBspTree("20_21")).toBe(tree);
    world.removeCell(firstCellId);
    expect(world.tileBspTree("20_21")).toBe(tree);
    world.removeCell(secondCellId);
    expect(world.tileBspTree("20_21")).toBeNull();
    expect(world.inspection().revision).toBe(7);
  });
});

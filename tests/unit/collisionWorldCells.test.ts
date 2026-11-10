import { describe, expect, it } from "vitest";
import type { CollisionCell } from "../../src/scene/world/movement/core/collisionCell";
import { CollisionWorldError, createCollisionWorld, type CollisionCellFootprint, type CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
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

  it("lists missing cell ids sorted and holds a shared footprint edge not ready until both cells are added", () => {
    const world = createCollisionWorld(), eastCellId = "20_21/chunk-1-0";
    world.requireCell(eastCellId, { minimumX: 4096, minimumY: 0, maximumX: 8192, maximumY: 4096 });
    world.requireCell(firstCellId, firstFootprint);
    expect(world.inspection().missingCellIds).toEqual([firstCellId, eastCellId]);
    const sharedEdge = { x: 4096, y: 2048 };
    world.addCell(firstCellId, decodedCell(firstCellId));
    expect(world.isReady(sharedEdge)).toBe(false);
    expect(world.isReady(insideFirstCell)).toBe(true);
    world.addCell(eastCellId, decodedCell(eastCellId));
    expect(world.isReady(sharedEdge)).toBe(true);
    expect(world.inspection()).toEqual({ requiredCellCount: 2, residentCellCount: 2, missingCellIds: [], revision: 4 });
    expect(world.residentCells().map(cell => cell.cellId)).toEqual([firstCellId, eastCellId]);
  });

  it("compares positions and footprints as float32 source units", () => {
    const world = createCollisionWorld();
    world.requireCell(firstCellId, { minimumX: 0, minimumY: 0, maximumX: 0.1, maximumY: 0.1 });
    expect(world.isReady({ x: Math.fround(0.1), y: 0 })).toBe(false);
    world.requireCell(firstCellId, { minimumX: 0, minimumY: 0, maximumX: Math.fround(0.1), maximumY: Math.fround(0.1) });
    expect(world.inspection().revision).toBe(1);
  });

  it.each([
    ["an empty cell id", (world: CollisionWorld) => world.requireCell("", firstFootprint), /requireCell needs a non-empty cell id/],
    ["a non-finite footprint", (world: CollisionWorld) => world.requireCell(firstCellId, { ...firstFootprint, maximumX: Number.POSITIVE_INFINITY }),
      /cell 20_21\/chunk-0-0 footprint must hold finite source units/],
    ["a not-a-number footprint", (world: CollisionWorld) => world.requireCell(firstCellId, { ...firstFootprint, minimumY: Number.NaN }),
      /cell 20_21\/chunk-0-0 footprint must hold finite source units/],
    ["an inverted footprint", (world: CollisionWorld) => world.requireCell(firstCellId, { ...firstFootprint, minimumX: 5000 }),
      /cell 20_21\/chunk-0-0 footprint is inverted/],
    ["a second require with a different footprint", (world: CollisionWorld) => {
      world.requireCell(firstCellId, firstFootprint);
      world.requireCell(firstCellId, { ...firstFootprint, maximumY: 8192 });
    }, /cell 20_21\/chunk-0-0 is already required with a different footprint/],
    ["adding a cell that was never required", (world: CollisionWorld) => world.addCell(firstCellId, decodedCell(firstCellId)),
      /cell 20_21\/chunk-0-0 was never required/],
    ["adding a cell twice", (world: CollisionWorld) => {
      world.requireCell(firstCellId, firstFootprint);
      world.addCell(firstCellId, decodedCell(firstCellId));
      world.addCell(firstCellId, decodedCell(firstCellId));
    }, /cell 20_21\/chunk-0-0 is already resident/],
    ["adding a cell decoded for another id", (world: CollisionWorld) => {
      world.requireCell(firstCellId, firstFootprint);
      world.addCell(firstCellId, decodedCell("20_21/chunk-9-9"));
    }, /cell 20_21\/chunk-0-0 was given the decoded cell 20_21\/chunk-9-9/],
    ["removing an unknown cell", (world: CollisionWorld) => world.removeCell(firstCellId), /cell 20_21\/chunk-0-0 is not known/],
    ["a BSP tree for a tile with no resident cell", (world: CollisionWorld) => world.setTileBspTree("20_21", decodedTree()),
      /tile 20_21 has no resident cell to hold its BSP tree/],
    ["a second BSP tree for one tile", (world: CollisionWorld) => {
      world.requireCell(firstCellId, firstFootprint);
      world.addCell(firstCellId, decodedCell(firstCellId));
      world.setTileBspTree("20_21", decodedTree());
      world.setTileBspTree("20_21", decodedTree());
    }, /tile 20_21 already holds its BSP tree/],
    ["a non-finite readiness position", (world: CollisionWorld) => world.isReady({ x: Number.NaN, y: 0 }), /isReady needs a finite source-unit position/],
  ])("throws CollisionWorldError for %s", (_case, act, message) => {
    const world = createCollisionWorld();
    expect(() => act(world)).toThrow(CollisionWorldError);
    expect(() => act(createCollisionWorld())).toThrow(message);
  });

  it("clears every cell, requirement and BSP tree in one revision", () => {
    const world = createCollisionWorld();
    world.requireCell(firstCellId, firstFootprint);
    world.addCell(firstCellId, decodedCell(firstCellId));
    world.setTileBspTree("20_21", decodedTree());
    world.clear();
    expect(world.inspection()).toEqual({ requiredCellCount: 0, residentCellCount: 0, missingCellIds: [], revision: 4 });
    expect(world.tileBspTree("20_21")).toBeNull();
    world.clear();
    expect(world.inspection().revision).toBe(4);
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

import { describe, expect, it } from "vitest";
import { decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import { collisionCellTerrainFootprint } from "../../src/runtime/tileCollisionCells";
import { readCollisionFixturePayload } from "../support/nativeTileCollisionFixture";
import { emptyChunkArrays, fixtureCellId, fixtureTileId, mixedChunkArrays, terrainWorldPoint } from "../fixtures/movement/movementCollisionFixtures";

const decodeCell = (arrays: Parameters<typeof readCollisionFixturePayload>[0]) =>
  decodeNativeTileCollisionCell(readCollisionFixturePayload(arrays), { cellId: fixtureCellId, tileId: fixtureTileId });

describe("tile collision cell footprint", () => {
  it("spans the decoded terrain heightmap points of the cell in source units", () => {
    const cell = decodeCell(mixedChunkArrays());
    const terrain = cell.terrain!;
    const minimum = terrainWorldPoint(0, 0), maximum = terrainWorldPoint(terrain.columns - 1, terrain.rows - 1);
    expect(collisionCellTerrainFootprint(cell)).toEqual({ minimumX: minimum.x, minimumY: minimum.y, maximumX: maximum.x, maximumY: maximum.y });
  });

  it("names no footprint for a cell without terrain, so the loader lists it as a chunk gap", () => {
    expect(collisionCellTerrainFootprint(decodeCell(emptyChunkArrays()))).toBeNull();
  });
});

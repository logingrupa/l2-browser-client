import { describe, expect, it } from "vitest";
import { decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import {
  chunkSourceFootprint, collisionCellTerrainFootprint, NativeTileFootprintError, residencyFootprintFromSource, tileTerrainGridFromProbeCell,
} from "../../src/scene/world/nativeTileChunkFootprints";
import { readCollisionFixturePayload } from "../support/nativeTileCollisionFixture";
import { emptyChunkArrays, fixtureCellId, fixtureTileId, mixedChunkArrays, terrainWorldPoint } from "../fixtures/movement/movementCollisionFixtures";

const decodeCell = (arrays: Parameters<typeof readCollisionFixturePayload>[0]) =>
  decodeNativeTileCollisionCell(readCollisionFixturePayload(arrays), { cellId: fixtureCellId, tileId: fixtureTileId });
const singleSector = { firstColumn: 0, lastColumn: 0, firstRow: 0, lastRow: 0 };

describe("tile collision cell footprint", () => {
  it("spans the decoded terrain heightmap points of the cell in source units", () => {
    const cell = decodeCell(mixedChunkArrays());
    const terrain = cell.terrain!;
    const minimum = terrainWorldPoint(0, 0), maximum = terrainWorldPoint(terrain.columns - 1, terrain.rows - 1);
    expect(collisionCellTerrainFootprint(cell)).toEqual({ minimumX: minimum.x, minimumY: minimum.y, maximumX: maximum.x, maximumY: maximum.y });
  });

  it("names no footprint for a cell without terrain", () => {
    expect(collisionCellTerrainFootprint(decodeCell(emptyChunkArrays()))).toBeNull();
  });
});

describe("chunk footprints from the tile terrain grid", () => {
  it("derives the quads per sector and the chunk edge from a probe cell and reproduces its decoded footprint", () => {
    const cell = decodeCell(mixedChunkArrays());
    const grid = tileTerrainGridFromProbeCell(cell, singleSector);
    expect(grid).toMatchObject({ quadsPerSector: 3, heightmapWidth: 4, heightmapHeight: 4, chunkEdgeSourceUnits: 1536 });
    expect(chunkSourceFootprint(grid, singleSector)).toEqual(collisionCellTerrainFootprint(cell));
  });

  it("clamps the last sector of a tile to the last heightmap point", () => {
    const grid = { locationX: 16384, locationY: 114688, scaleX: 128, scaleY: 128, heightmapWidth: 256, heightmapHeight: 256, quadsPerSector: 16, chunkEdgeSourceUnits: 8192 };
    expect(chunkSourceFootprint(grid, { firstColumn: 12, lastColumn: 15, firstRow: 0, lastRow: 3 }))
      .toEqual({ minimumX: 24576, minimumY: 98304, maximumX: 32640, maximumY: 106496 });
  });

  it("refuses a probe cell without terrain or whose vertices do not divide into its sectors", () => {
    expect(() => tileTerrainGridFromProbeCell(decodeCell(emptyChunkArrays()), singleSector)).toThrow(NativeTileFootprintError);
    expect(() => tileTerrainGridFromProbeCell(decodeCell(mixedChunkArrays()), { firstColumn: 0, lastColumn: 1, firstRow: 0, lastRow: 1 })).toThrow(NativeTileFootprintError);
  });

  it("converts a source footprint to scene metres on x and z", () => {
    expect(residencyFootprintFromSource({ minimumX: 0, minimumY: 98304, maximumX: 8192, maximumY: 106496 }))
      .toEqual({ minimumX: 0, minimumZ: expect.closeTo(983.04, 9), maximumX: expect.closeTo(81.92, 9), maximumZ: expect.closeTo(1064.96, 9) });
  });
});

import { describe, expect, it } from "vitest";
import type { CollisionTerrain } from "../../src/scene/world/movement/core/collisionCell";
import { traceTerrain } from "../../src/scene/world/movement/core/terrainTrace";
import { edgeToleranceHorizontalGrowth, sweptQuadWindow, type TerrainQuadGrid } from "../../src/scene/world/movement/core/terrainSweepQuadWindow";
import { committedMovementRules } from "../fixtures/movement/movementCollisionFixtures";

const quadsPerSide = 8;
const flatHeight = 32767;
const flatGrowth = Math.sqrt(5);
const flatGrid: TerrainQuadGrid = { firstColumn: 0, firstRow: 0, quadColumns: quadsPerSide, quadRows: quadsPerSide, edgeToleranceGrowth: flatGrowth };
const verticalDrop = { x: 0, y: 0, z: -20 };

function flatTerrain(): CollisionTerrain {
  const vertexCount = (quadsPerSide + 1) * (quadsPerSide + 1), quadCount = quadsPerSide * quadsPerSide;
  return {
    location: [0, 0, 0], terrainScale: [1, 1, 256], heightmapWidth: 2 * quadsPerSide, heightmapHeight: 2 * quadsPerSide,
    firstColumn: 0, firstRow: 0, columns: quadsPerSide + 1, rows: quadsPerSide + 1,
    heights: new Uint32Array(vertexCount).fill(flatHeight), quadVisibility: new Uint8Array(quadCount).fill(1), edgeTurn: new Uint8Array(quadCount),
  };
}

describe("terrain sweep quad window", () => {
  it("grows a flat lower-right triangle's edge tolerance region by its sharpest corner", () => {
    const outwardEdgeNormals = [{ x: 0, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }] as const;
    expect(edgeToleranceHorizontalGrowth(outwardEdgeNormals)).toBeCloseTo(flatGrowth, 12);
  });

  it("visits only the quads around a vertical ray instead of the whole grid", () => {
    expect(sweptQuadWindow(flatGrid, { x: 4.5, y: 4.5, z: 10 }, verticalDrop, 0))
      .toEqual({ firstQuadColumn: 3, lastQuadColumn: 5, firstQuadRow: 3, lastQuadRow: 5 });
  });

  it("widens the window by the edge tolerance growth and clamps it to the grid", () => {
    expect(sweptQuadWindow(flatGrid, { x: 4.5, y: 4.5, z: 10 }, verticalDrop, 1.5))
      .toEqual({ firstQuadColumn: 0, lastQuadColumn: 7, firstQuadRow: 0, lastQuadRow: 7 });
  });

  it("is empty for a sweep wholly outside the grid", () => {
    const window = sweptQuadWindow(flatGrid, { x: -20, y: -20, z: 10 }, verticalDrop, 0);
    expect(window.lastQuadColumn).toBeLessThan(window.firstQuadColumn);
    expect(window.lastQuadRow).toBeLessThan(window.firstQuadRow);
  });

  it("keeps the first quad in scan order whose widened triangle holds a box sweep outside the sweep's own footprint", () => {
    const hit = traceTerrain(flatTerrain(), { start: { x: -3.5, y: -3.5, z: 10 }, end: { x: -3.5, y: -3.5, z: -10 }, extent: { x: 1.5, y: 1.5, z: 0 } },
      committedMovementRules());
    expect(hit).toEqual({ time: 0.5, normal: { x: 0, y: 0, z: 1 }, quadIndex: quadsPerSide + 2 });
  });
});

import { describe, expect, it } from "vitest";
import { planWorldMapView, tileHoldingScenePosition, type WorldMapTile } from "../../src/ui/nativeWindows/worldMapView";
import { syntheticTileMinimap, syntheticTileTextureSize } from "./support/tileMinimapFixtures";

const size = syntheticTileTextureSize;
const labels = { arrangement: "tile-grid, unverified", scale: "one texture pixel per CSS pixel, presentation" };
const notInCatalogReason = "tile minimap resource not in catalog";

function tile(tileId: string, radar = true): WorldMapTile {
  return { tileId, minimap: syntheticTileMinimap(tileId, { radar }) };
}

const centreOf2021 = { x: 128, y: 0, z: 384 };

describe("tileHoldingScenePosition", () => {
  const tiles = [tile("20_21"), tile("21_21"), tile("20_22")];

  it("finds the tile whose half-open native frame holds the scene position", () => {
    expect(tileHoldingScenePosition(tiles, centreOf2021)?.tileId).toBe("20_21");
    expect(tileHoldingScenePosition(tiles, { x: 300, y: 0, z: 300 })?.tileId).toBe("21_21");
  });

  it("gives a point on a shared edge to the tile whose frame minimum equals it", () => {
    expect(tileHoldingScenePosition(tiles, { x: 256, y: 0, z: 384 })?.tileId).toBe("21_21");
    expect(tileHoldingScenePosition(tiles, { x: 128, y: 0, z: 512 })?.tileId).toBe("20_22");
    expect(tileHoldingScenePosition(tiles, { x: 0, y: 0, z: 256 })?.tileId).toBe("20_21");
  });

  it("returns null outside every frame and for tiles without a projection", () => {
    expect(tileHoldingScenePosition(tiles, { x: -1, y: 0, z: 300 })).toBeNull();
    expect(tileHoldingScenePosition([tile("20_21", false)], centreOf2021)).toBeNull();
  });
});

describe("planWorldMapView", () => {
  it("centres the player's texture position and places (X+1, Y) to the right and (X, Y+1) below at one texture pixel per CSS pixel", () => {
    const plan = planWorldMapView({ controlWidth: size, controlHeight: size, tiles: [tile("20_21"), tile("21_21"), tile("20_22"), tile("21_22")],
      playerScenePosition: { x: 192, y: 0, z: 448 } });
    expect(plan.gap).toBeNull();
    expect(plan.marker).toEqual({ left: size / 2, top: size / 2, status: "unverified" });
    expect(plan.labels).toEqual(labels);
    const cell = (tileId: string) => plan.cells.find(entry => entry.tileId === tileId);
    expect(cell("20_21")).toEqual({ tileId: "20_21", left: -64, top: -64, width: size, height: size, status: "texture",
      archive: syntheticTileMinimap("20_21").radarTexture!.archive });
    expect([cell("21_21")?.left, cell("21_21")?.top]).toEqual([-64 + size, -64]);
    expect([cell("20_22")?.left, cell("20_22")?.top]).toEqual([-64, -64 + size]);
    expect([cell("21_22")?.left, cell("21_22")?.top]).toEqual([-64 + size, -64 + size]);
  });

  it("lists only cells intersecting the control rectangle, in row then column order", () => {
    const plan = planWorldMapView({ controlWidth: size, controlHeight: size, tiles: [tile("20_21")], playerScenePosition: centreOf2021 });
    expect(plan.cells.map(cell => cell.tileId)).toEqual(["20_21"]);
    const wide = planWorldMapView({ controlWidth: 3 * size, controlHeight: 2 * size, tiles: [tile("20_21")], playerScenePosition: { x: 64, y: 0, z: 320 } });
    expect(wide.cells.map(cell => cell.tileId)).toEqual(["18_20", "19_20", "20_20", "21_20", "18_21", "19_21", "20_21", "21_21", "18_22", "19_22", "20_22", "21_22"]);
    for (const cell of wide.cells) {
      expect(cell.left).toBeLessThan(3 * size);
      expect(cell.left + cell.width).toBeGreaterThan(0);
      expect(cell.top).toBeLessThan(2 * size);
      expect(cell.top + cell.height).toBeGreaterThan(0);
    }
  });

  it("shows a missing tile as not in catalog and a tile with a minimap gap with that gap's reason", () => {
    const plan = planWorldMapView({ controlWidth: 3 * size, controlHeight: size, tiles: [tile("20_21"), tile("21_21", false)],
      playerScenePosition: centreOf2021 });
    expect(plan.cells.find(cell => cell.tileId === "19_21")).toMatchObject({ status: "gap", reason: notInCatalogReason });
    expect(plan.cells.find(cell => cell.tileId === "21_21")).toMatchObject({ status: "gap", reason: "minimap-join-unresolved:radar-texture" });
    const absentResource = planWorldMapView({ controlWidth: 3 * size, controlHeight: size, tiles: [tile("20_21"), { tileId: "21_21", minimap: null }],
      playerScenePosition: centreOf2021 });
    expect(absentResource.cells.find(cell => cell.tileId === "21_21")).toMatchObject({ status: "gap", reason: notInCatalogReason });
  });

  it("returns equal plans for equal inputs whatever the tile order", () => {
    const input = { controlWidth: 2 * size, controlHeight: 2 * size, tiles: [tile("20_21"), tile("21_21")], playerScenePosition: centreOf2021 };
    expect(planWorldMapView(input)).toEqual(planWorldMapView({ ...input, tiles: [...input.tiles].reverse() }));
    expect(planWorldMapView(input)).toEqual(planWorldMapView(input));
  });

  it("gives only gap state and no marker for an empty tile list, an unheld position or no local player", () => {
    const empty = planWorldMapView({ controlWidth: size, controlHeight: size, tiles: [], playerScenePosition: centreOf2021 });
    expect(empty.cells.every(cell => cell.status === "gap")).toBe(true);
    expect(empty).toMatchObject({ marker: null, gap: "no converted tile at the player position" });
    expect(planWorldMapView({ controlWidth: size, controlHeight: size, tiles: [tile("20_21")], playerScenePosition: { x: -900, y: 0, z: 0 } }))
      .toMatchObject({ cells: [], marker: null, gap: "no converted tile at the player position" });
    expect(planWorldMapView({ controlWidth: size, controlHeight: size, tiles: [tile("20_21")], playerScenePosition: null }))
      .toMatchObject({ cells: [], marker: null, gap: "adapter-field-absent:position" });
  });

  it("refuses a malformed or repeated tile id, naming it", () => {
    const input = { controlWidth: size, controlHeight: size, playerScenePosition: centreOf2021 };
    expect(() => planWorldMapView({ ...input, tiles: [{ tileId: "20-21", minimap: null }] })).toThrow(/20-21/);
    expect(() => planWorldMapView({ ...input, tiles: [tile("20_21"), { tileId: "20_21", minimap: null }] })).toThrow(/20_21/);
  });
});

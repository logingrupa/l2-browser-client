import { describe, expect, it } from "vitest";
import { parseNativeMinimapRoute } from "../../src/ui/nativeWindows/nativeMinimapRoute";
import { planWorldMapView } from "../../src/ui/nativeWindows/worldMapView";
import { syntheticMinimapRouteManifest } from "../fixtures/minimapRouteManifestFixture";

const worldMap = parseNativeMinimapRoute(syntheticMinimapRouteManifest()).worldMap;
const controlWidth = 300;
const controlHeight = 200;

describe("planWorldMapView", () => {
  it("centres the view origin on the marker at one map pixel per CSS pixel and labels both as presentation", () => {
    const plan = planWorldMapView({ controlWidth, controlHeight, worldMap, playerSourcePosition: { x: 0, y: 0, z: 0 } });
    expect(plan.gap).toBeNull();
    expect(plan.marker).toEqual({ left: 150, top: 100, mapX: 656, mapY: 1312 });
    expect(plan.viewOrigin).toEqual({ left: 150 - 656, top: 100 - 1312 });
    expect(plan.pieces[3]).toMatchObject({ suffix: 4, left: 150 - 656 + 1024, top: 100 - 1312 + 1024 });
    expect(plan.labels).toEqual({ viewOrigin: "centred on the marker, presentation", scale: "one map pixel per CSS pixel, presentation" });
  });

  it("keeps the pieces fixed on the map while the marker position moves the view origin", () => {
    const first = planWorldMapView({ controlWidth, controlHeight, worldMap, playerSourcePosition: { x: 0, y: 0, z: 0 } });
    const moved = planWorldMapView({ controlWidth, controlHeight, worldMap, playerSourcePosition: { x: 8192, y: -8192, z: 0 } });
    expect(moved.marker).toEqual({ left: 150, top: 100, mapX: 697, mapY: 1271 });
    expect(moved.pieces.map(piece => piece.left - first.pieces[0]!.left)).toEqual(first.pieces.map(piece => piece.left - first.pieces[0]!.left - 41));
  });

  it("carries the absent texture of an unconverted piece as its gap", () => {
    const partial = parseNativeMinimapRoute(syntheticMinimapRouteManifest({ convertedPieceSuffixes: [1, 2, 3, 4, 5] })).worldMap;
    const plan = planWorldMapView({ controlWidth, controlHeight, worldMap: partial, playerSourcePosition: { x: 0, y: 0, z: 0 } });
    expect(plan.pieces.map(piece => piece.texture === null ? piece.gap : null)).toEqual([null, null, null, null, null, "world-map-piece-texture-absent"]);
  });

  it("shows the adapter position gap and no pieces or marker without a local player", () => {
    expect(planWorldMapView({ controlWidth, controlHeight, worldMap, playerSourcePosition: null }))
      .toMatchObject({ pieces: [], marker: null, gap: "adapter-field-absent:position" });
  });
});

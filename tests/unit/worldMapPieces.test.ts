import { describe, expect, it } from "vitest";
import { NativeMinimapRouteError, parseNativeMinimapRoute } from "../../src/ui/nativeWindows/nativeMinimapRoute";
import { planWorldMapView, worldMapPosition } from "../../src/ui/nativeWindows/worldMapView";
import { minimapRadarRouteRecipe, syntheticMinimapRouteManifest } from "../fixtures/minimapRouteManifestFixture";

const route = parseNativeMinimapRoute(syntheticMinimapRouteManifest());
const projection = route.worldMap.projection;

describe("world map pieces of the minimap route", () => {
  it("places pieces 1 to 6 in 2 columns by 3 rows at map pixel (1024 column, 1024 row)", () => {
    const plan = planWorldMapView({ controlWidth: 0, controlHeight: 0, worldMap: route.worldMap, playerSourcePosition: { x: -131072, y: -262144, z: 0 } });
    expect(plan.pieces.map(piece => [piece.suffix, piece.left - plan.viewOrigin.left, piece.top - plan.viewOrigin.top, piece.width, piece.height]))
      .toEqual([[1, 0, 0, 1024, 1024], [2, 1024, 0, 1024, 1024], [3, 0, 1024, 1024, 1024], [4, 1024, 1024, 1024, 1024],
        [5, 0, 2048, 1024, 1024], [6, 1024, 2048, 1024, 1024]]);
    expect(plan.pieces.map(piece => piece.texture?.object)).toEqual([1, 2, 3, 4, 5, 6].map(suffix => `L2Font-e.Minimap.int_worldmap${suffix}`));
  });

  it("reads the GetMinimapPosition global branch of the recipe", () => {
    expect(minimapRadarRouteRecipe.worldMap.getMinimapPosition).toMatchObject({ offsetX: 131072, offsetY: 262144, scaleNumerator: 41, scaleDenominator: 8192 });
    expect(projection).toEqual({ offsetX: 131072, offsetY: 262144, scaleNumerator: 41, scaleDenominator: 8192 });
  });

  it("maps a source position with mapX = trunc((X + 131072) * 41 / 8192) and mapY = trunc((Y + 262144) * 41 / 8192)", () => {
    expect(worldMapPosition(projection, { x: 0, y: 0, z: 0 })).toEqual({ mapX: 656, mapY: 1312 });
    expect(worldMapPosition(projection, { x: 100000, y: 150000, z: 0 })).toEqual({ mapX: 1156, mapY: 2062 });
    expect(worldMapPosition(projection, { x: -131072, y: -262144, z: 0 })).toEqual({ mapX: 0, mapY: 0 });
  });

  it("truncates toward zero on both sides of the map origin", () => {
    expect(worldMapPosition(projection, { x: -131073, y: -262145, z: 0 })).toEqual({ mapX: 0, mapY: 0 });
    expect(worldMapPosition(projection, { x: -200000, y: -300000, z: 0 })).toEqual({ mapX: -344, mapY: -189 });
    expect(worldMapPosition(projection, { x: 18160.5, y: 112972.25, z: 0 })).toEqual({ mapX: 746, mapY: 1877 });
  });

  it("refuses a piece whose map pixel contradicts its column and row", () => {
    const manifest = syntheticMinimapRouteManifest();
    const worldMap = manifest.worldMap as { pieces: Record<string, unknown>[] };
    worldMap.pieces[3] = { ...worldMap.pieces[3], originX: 0 };
    expect(() => parseNativeMinimapRoute(manifest)).toThrow(NativeMinimapRouteError);
    expect(() => parseNativeMinimapRoute({ ...syntheticMinimapRouteManifest(), kind: "native-tile-minimap" })).toThrow(/kind/);
  });
});

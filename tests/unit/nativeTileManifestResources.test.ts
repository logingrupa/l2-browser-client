import { describe, expect, it } from "vitest";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

const mapSha256 = "c".repeat(64);
const visibilitySha256 = "7".repeat(64);
const collisionSha256 = "9".repeat(64);

function tileManifest(resources: readonly unknown[]) {
  return {
    kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_21", sourceMap: "maps/20_21.unr", sourceSha256: mapSha256,
    frame: { terrainInfo: "20_21.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] },
    anchor: { playerStart: "20_21.PlayerStart0", location: [0, 0, 0] },
    chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64),
      manifestBytes: 100 }],
    resources, gaps: [],
  };
}

const bspVisibility = { kind: "bsp-visibility", manifest: `/l2/maps/${visibilitySha256}/native-tile-bsp-visibility/asset.json`,
  manifestSha256: visibilitySha256, manifestBytes: 2000 };
const collision = { kind: "native-tile-collision", manifest: `/l2/maps/${collisionSha256}/native-tile-collision/asset.json`,
  manifestSha256: collisionSha256, manifestBytes: 1000 };

const emittersSha256 = "5".repeat(64);
const mapEmitters = { kind: "map-emitters", manifest: `/l2/map-emitters/${emittersSha256}/tile-emitters.json`, manifestSha256: emittersSha256,
  manifestBytes: 900 };

describe("native tile manifest resources", () => {
  it("accepts one pinned map-emitters manifest and refuses it at another path", () => {
    expect(parseNativeTileManifest(tileManifest([bspVisibility, collision, mapEmitters])).resources.map(resource => resource.kind))
      .toEqual(["bsp-visibility", "native-tile-collision", "map-emitters"]);
    expect(() => parseNativeTileManifest(tileManifest([{ ...mapEmitters, manifest: `/l2/maps/${emittersSha256}/tile-emitters.json` }])))
      .toThrow(/at most one record of each kind/);
  });

  it("accepts one pinned bsp-visibility typed payload beside the collision resource", () => {
    expect(parseNativeTileManifest(tileManifest([bspVisibility, collision])).resources.map(resource => resource.kind))
      .toEqual(["bsp-visibility", "native-tile-collision"]);
  });

  it("refuses a second bsp-visibility record, a collision path under the visibility kind and an unknown kind", () => {
    expect(() => parseNativeTileManifest(tileManifest([bspVisibility, bspVisibility]))).toThrow(/at most one record of each kind/);
    expect(() => parseNativeTileManifest(tileManifest([{ ...collision, kind: "bsp-visibility" }]))).toThrow(/at most one record of each kind/);
    expect(() => parseNativeTileManifest(tileManifest([{ ...bspVisibility, kind: "toString" }]))).toThrow(/at most one record of each kind/);
  });
});

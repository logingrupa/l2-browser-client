import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nativeTileResourceKinds, parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

const mapSha256 = "c".repeat(64);
const visibilitySha256 = "7".repeat(64);
const collisionSha256 = "9".repeat(64);
const tileManifestVocabularyPath = join(process.cwd(), "recipes", "world", "tile-manifest-vocabulary.json");

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
  it("reads exactly the resource kinds of the tile manifest vocabulary the Python validator reads", () => {
    const vocabulary = JSON.parse(readFileSync(tileManifestVocabularyPath, "utf8")) as { readonly resourceKinds: readonly string[] };
    expect([...nativeTileResourceKinds].sort()).toEqual([...vocabulary.resourceKinds].sort());
  });

  it("accepts one pinned map-emitters manifest and refuses it at another path", () => {
    expect(parseNativeTileManifest(tileManifest([bspVisibility, collision, mapEmitters])).resources.map(resource => resource.kind))
      .toEqual(["bsp-visibility", "native-tile-collision", "map-emitters"]);
    expect(() => parseNativeTileManifest(tileManifest([{ ...mapEmitters, manifest: `/l2/maps/${emittersSha256}/tile-emitters.json` }])))
      .toThrow(/map-emitters resource must be \/l2\/map-emitters\/<sha256>\/tile-emitters\.json with its SHA-256/);
  });

  it("accepts one pinned bsp-visibility typed payload beside the collision resource", () => {
    expect(parseNativeTileManifest(tileManifest([bspVisibility, collision])).resources.map(resource => resource.kind))
      .toEqual(["bsp-visibility", "native-tile-collision"]);
  });

  it("refuses a second bsp-visibility record, a collision path under the visibility kind and an unknown kind", () => {
    expect(() => parseNativeTileManifest(tileManifest([bspVisibility, bspVisibility]))).toThrow(/lists more than one bsp-visibility resource/);
    expect(() => parseNativeTileManifest(tileManifest([{ ...collision, kind: "bsp-visibility" }])))
      .toThrow(/bsp-visibility resource must be \/l2\/maps\/<sha256>\/native-tile-bsp-visibility\/asset\.json with its SHA-256/);
    expect(() => parseNativeTileManifest(tileManifest([{ ...bspVisibility, kind: "toString" }])))
      .toThrow(/resource kind "toString" is not in the tile manifest vocabulary/);
  });

  it("refuses a resource whose byte length is not a whole number from 1 to 128 MiB", () => {
    for (const manifestBytes of [0, 128 * 1024 * 1024 + 1, 1.5]) {
      expect(() => parseNativeTileManifest(tileManifest([{ ...mapEmitters, manifestBytes }])))
        .toThrow(/map-emitters resource manifestBytes must be a whole number from 1 to 134217728/);
    }
  });
});

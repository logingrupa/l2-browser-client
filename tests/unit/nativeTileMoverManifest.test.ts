import { describe, expect, it } from "vitest";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { nativeMoverMapSha256, parseNativeMoverManifest, parseNativeTileMoverManifest } from "../../src/scene/world/nativeMoverManifest";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

const archiveSha256 = "a".repeat(64);
const modelSha256 = "b".repeat(64);
const mapSha256 = "c".repeat(64);
const modelId = "interlude:l2fortress_02_s.Fort02_indoor";

function tileMover(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `interlude:20_20.Mover${index}`, actorName: `Mover${index}`, exportIndex: 5000 + index, modelId,
    serverObject: { realId: 20200000 + index, id: index, type: 1 },
    closedMatrix: Array.from(Matrix.Translation(index, 0, 0).asArray()), openMatrix: Array.from(Matrix.Translation(index, 1.36, 0).asArray()),
    moveTimeSeconds: 1, initialKey: 0, initiallyClosed: true, keys: [], sounds: [],
    collision: { decision: "gap", slots: [], evidence: ["rule-disagreement:bStatic"] }, ...overrides,
  };
}

function tileMoverManifest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "native-tile-movers", schemaVersion: 1, tileId: "20_20", sourceMap: { path: "maps/20_20.unr", sha256: mapSha256 },
    classEvidence: { unit: "class:Engine.Mover", receiptSha256: "d".repeat(64), classes: [] },
    models: [{ id: modelId, sourceObject: "l2fortress_02_s.Fort02_indoor",
      archive: { resource: `/l2/${archiveSha256}/asset.l2asset`, sha256: archiveSha256, bytes: 500 },
      model: { resource: `/l2/${archiveSha256}/model.glb`, sha256: modelSha256, bytes: 400 } }],
    movers: [tileMover(1), tileMover(24)], gaps: [], ...overrides,
  };
}

describe("native tile mover manifest", () => {
  it("accepts movers whose ids name the manifest's own tile and keeps the declared collision decision", () => {
    const manifest = parseNativeTileMoverManifest(tileMoverManifest());
    expect(manifest.movers.map(mover => mover.id)).toEqual(["interlude:20_20.Mover1", "interlude:20_20.Mover24"]);
    expect(manifest.movers[0]!.collision).toEqual({ decision: "gap", slots: [], evidence: ["rule-disagreement:bStatic"] });
    expect(manifest.models[0]!.model.resource).toBe(`/l2/${archiveSha256}/model.glb`);
  });

  it("accepts a zero server object id but refuses two movers with the same positive one", () => {
    const zero = { realId: 0, id: 0, type: 0 };
    expect(parseNativeTileMoverManifest(tileMoverManifest({ movers: [tileMover(1, { serverObject: zero }), tileMover(2, { serverObject: zero })] }))
      .movers).toHaveLength(2);
    const repeated = { realId: 7, id: 7, type: 1 };
    expect(() => parseNativeTileMoverManifest(tileMoverManifest({ movers: [tileMover(1, { serverObject: repeated }), tileMover(2, { serverObject: repeated })] })))
      .toThrow(/repeats/);
    expect(() => parseNativeTileMoverManifest(tileMoverManifest({ movers: [tileMover(1, { serverObject: { realId: -1, id: 0, type: 0 } })] })))
      .toThrow(/identity, motion or timing/);
  });

  it("rejects a mover id of another tile", () => {
    expect(() => parseNativeTileMoverManifest(tileMoverManifest({ movers: [tileMover(1, { id: "interlude:20_21.Mover1" })] })))
      .toThrow(/identity, motion or timing/);
  });

  it("rejects unused models", () => {
    const manifest = tileMoverManifest();
    const unused = { ...manifest.models[0]!, id: "interlude:l2fortress_02_s.fort02_wall_door", sourceObject: "l2fortress_02_s.fort02_wall_door" };
    expect(() => parseNativeTileMoverManifest({ ...manifest, models: [...manifest.models, unused] })).toThrow(/unused models/);
  });

  it("rejects non-rigid matrices and non-positive move times", () => {
    const scaled = Array.from(Matrix.Scaling(2, 2, 2).asArray());
    expect(() => parseNativeTileMoverManifest(tileMoverManifest({ movers: [tileMover(1, { openMatrix: scaled })] }))).toThrow(/rigid/);
    for (const moveTimeSeconds of [0, -1]) {
      expect(() => parseNativeTileMoverManifest(tileMoverManifest({ movers: [tileMover(1, { moveTimeSeconds })] }))).toThrow(/identity, motion or timing/);
    }
  });

  it("rejects a model resource that is not pinned beside its archive", () => {
    const manifest = tileMoverManifest();
    const model = { ...manifest.models[0]!, model: { resource: `/l2/${modelSha256}/model.glb`, sha256: modelSha256, bytes: 400 } };
    expect(() => parseNativeTileMoverManifest({ ...manifest, models: [model] })).toThrow(/not pinned/);
  });

  it("keeps the 20_20 catalog parser refusing a tile-general id of another tile", () => {
    const archive = "e".repeat(64);
    const catalogManifest = { schemaVersion: 1, kind: "native-map-movers", sourceMap: { packageSha256: nativeMoverMapSha256 },
      models: [{ id: modelId, sourceObject: "l2fortress_02_s.Fort02_indoor", model: { file: `models/${archive}/model.glb`, sha256: modelSha256, bytes: 400 },
        archive: { file: `models/${archive}/asset.l2asset`, sha256: archive, bytes: 500 } }],
      movers: [{ id: "interlude:20_21.Mover1", modelId, serverObject: { realId: 1, id: 1, type: 1 },
        closedMatrix: Array.from(Matrix.Identity().asArray()), openMatrix: Array.from(Matrix.Identity().asArray()),
        moveTimeSeconds: 1, initialKey: 0, initiallyClosed: true }] };
    expect(() => parseNativeMoverManifest(catalogManifest)).toThrow(/identity, motion or timing/);
    expect(parseNativeMoverManifest({ ...catalogManifest, movers: [{ ...catalogManifest.movers[0]!, id: "interlude:20_20.Mover1" }] }).movers).toHaveLength(1);
  });

  it("accepts one movers resource beside the collision resource in the tile manifest and refuses a second", () => {
    const moversSha256 = "f".repeat(64), collisionSha256 = "9".repeat(64);
    const movers = { kind: "movers", manifest: `/l2/movers/${moversSha256}/tile-movers.json`, manifestSha256: moversSha256, manifestBytes: 1000 };
    const collision = { kind: "native-tile-collision", manifest: `/l2/maps/${collisionSha256}/native-tile-collision/asset.json`,
      manifestSha256: collisionSha256, manifestBytes: 1000 };
    const tile = { kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_20", sourceMap: "maps/20_20.unr", sourceSha256: mapSha256,
      frame: { terrainInfo: "20_20.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] },
      anchor: { playerStart: "20_20.PlayerStart0", location: [0, 0, 0] },
      chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64),
        manifestBytes: 100 }],
      resources: [movers, collision], gaps: [] };
    expect(parseNativeTileManifest(tile).resources.map(resource => resource.kind)).toEqual(["movers", "native-tile-collision"]);
    expect(() => parseNativeTileManifest({ ...tile, resources: [movers, movers] })).toThrow(/at most one/);
    expect(() => parseNativeTileManifest({ ...tile, resources: [{ ...movers, manifest: `/l2/maps/${moversSha256}/tile-movers.json` }] })).toThrow(/at most one/);
  });
});

import { describe, expect, it } from "vitest";
import { parseNativeTileChunkManifest } from "../../src/scene/world/nativeTileChunkManifest";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import { decodeJsonDocument, fixtureTileId, readFixtureTileFiles } from "../support/nativeTileFixtureStore";

type Document = Record<string, unknown>;

const fixture = readFixtureTileFiles();
const chunkDocument = () => decodeJsonDocument(fixture.chunk.bytes);
const tileDocument = () => decodeJsonDocument(fixture.tile.bytes);
const chunkRecords = (tile: Document) => tile.chunks as Document[];

function withChunk(change: (chunk: Document) => void): Document {
  const chunk = chunkDocument(); change(chunk); return chunk;
}

function withTile(change: (tile: Document) => void): Document {
  const tile = tileDocument(); change(tile); return tile;
}

function chunkRecord(column: number, row: number): Document {
  return { ...chunkRecords(tileDocument())[0], chunkId: `chunk-${column}-${row}` };
}

describe("native tile chunk manifest parser", () => {
  it("accepts the chunk manifest the Python tile manifest step wrote into the fixture lane store", () => {
    const chunk = parseNativeTileChunkManifest(chunkDocument());
    expect(chunk).toMatchObject({ kind: "native-tile-chunk-runtime", schemaVersion: 1, tileId: fixtureTileId, chunkId: "chunk-0-0",
      sectorRange: { firstColumn: 0, lastColumn: 0, firstRow: 0, lastRow: 0 }, models: [], bsp: null, collision: null,
      terrain: { resource: fixture.terrain.path, sha256: fixture.terrain.sha256, maskUvRule: "extrapolated" } });
    expect(chunk.gaps.map(row => [row.step, row.status, row.reason])).toEqual([
      ["bsp", "pending", "step-pending:bsp"], ["collision", "pending", "step-pending:collision"], ["meshes", "pending", "step-pending:meshes"],
      ["terrain-material", "pending", "step-pending:terrain-material"]]);
    expect(parseNativeTileChunkManifest(chunkDocument())).toEqual(chunk);
  });

  it.each<[string, (chunk: Document) => void, RegExp]>([
    ["a wrong kind", chunk => { chunk.kind = "native-tile-runtime"; }, /kind, schema version or tile id/],
    ["a wrong schema version", chunk => { chunk.schemaVersion = 2; }, /kind, schema version or tile id/],
    ["a malformed chunk id", chunk => { chunk.chunkId = "chunk-a-0"; }, /chunkId must match/],
    ["a sector range that does not start at four times the chunk column", chunk => { chunk.chunkId = "chunk-1-0"; }, /does not match its chunk id/],
    ["a terrain path other than its own hash folder", chunk => {
      (chunk.terrain as Document).resource = `/l2/maps/${"b".repeat(64)}/native-tile-chunk-terrain/terrain.glb`; }, /terrain resource must be/],
    ["a non-hex terrain hash", chunk => { (chunk.terrain as Document).sha256 = "Z".repeat(64); }, /terrain is invalid/],
    ["a mask UV rule other than extrapolated", chunk => { (chunk.terrain as Document).maskUvRule = "qualified"; }, /maskUvRule is not supported/],
    ["a null terrain without a terrain gap row", chunk => { chunk.terrain = null; }, /has no terrain/],
    ["an unknown field", chunk => { chunk.extra = true; }, /kind, schema version or tile id/],
    ["gap rows out of step order", chunk => { (chunk.gaps as Document[]).reverse(); }, /sorted by step/],
  ])("refuses %s", (_, change, message) => {
    expect(() => parseNativeTileChunkManifest(withChunk(change))).toThrow(message);
  });
});

const archiveSha256 = "a".repeat(64);
const modelId = "interlude:Fixture_S.FixtureMesh";
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1];

function chunkPlacement(overrides: Document = {}): Document {
  return { id: "interlude:00_00.StaticMeshActor1", modelId, sourceActor: "00_00.StaticMeshActor1", exportIndex: 7,
    sourceMesh: "Fixture_S.FixtureMesh", matrix: [...identityMatrix], materialOverrides: [],
    collision: { bBlockActors: { status: "omitted-class-default-unresolved" } }, ...overrides };
}

function withModel(placements: Document[], model: Document = {}): Document {
  return withChunk(chunk => {
    chunk.models = [{ id: modelId, archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256, placements, ...model }];
  });
}

describe("native tile chunk manifest models", () => {
  it("accepts zero models", () => {
    expect(parseNativeTileChunkManifest(withChunk(chunk => { chunk.models = []; })).models).toEqual([]);
  });

  it("accepts a model record with a source placement and keeps its matrix and identity", () => {
    const chunk = parseNativeTileChunkManifest(withModel([chunkPlacement()]));
    expect(chunk.models).toEqual([{ id: modelId, archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256,
      placements: [{ ...chunkPlacement(), matrix: identityMatrix }] }]);
  });

  it.each<[string, () => Document, RegExp]>([
    ["a placement whose modelId is not a listed model", () => withModel([chunkPlacement({ modelId: "interlude:Other_S.Mesh" })]), /invalid placement/],
    ["a placement listed under another model", () => withChunk(chunk => {
      chunk.models = [
        { id: modelId, archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256, placements: [chunkPlacement()] },
        { id: "interlude:Other_S.Mesh", archive: `/l2/${"b".repeat(64)}/asset.l2asset`, archiveSha256: "b".repeat(64),
          placements: [chunkPlacement({ id: "interlude:00_00.StaticMeshActor2" })] }];
    }), /invalid placement/],
    ["the same placement id twice", () => withModel([chunkPlacement(), chunkPlacement()]), /invalid placement/],
    ["a matrix of 15 numbers", () => withModel([chunkPlacement({ matrix: identityMatrix.slice(1) })]), /invalid placement/],
    ["a matrix with a non-finite number", () => withModel([chunkPlacement({ matrix: [Number.NaN, ...identityMatrix.slice(1)] })]), /invalid placement/],
    ["a matrix whose last row is not affine", () => withModel([chunkPlacement({ matrix: identityMatrix.map((value, index) => index === 3 ? 1 : value) })]),
      /invalid placement/],
    ["a singular matrix", () => withModel([chunkPlacement({ matrix: identityMatrix.map((value, index) => index === 0 ? 0 : value) })]), /invalid placement/],
    ["a placement with material overrides", () => withModel([chunkPlacement({ materialOverrides: [{ name: "Skins" }] })]), /invalid placement/],
    ["a placement with an unknown field", () => withModel([chunkPlacement({ extra: true })]), /invalid placement/],
    ["a source actor that is not a qualified object", () => withModel([chunkPlacement({ sourceActor: "StaticMeshActor1" })]), /invalid placement/],
    ["a model with no placements", () => withModel([]), /invalid model/],
    ["an archive path of another hash", () => withModel([chunkPlacement()], { archive: `/l2/${"b".repeat(64)}/asset.l2asset` }), /invalid model/],
    ["a non-hex archive hash", () => withModel([chunkPlacement()], { archiveSha256: "Z".repeat(64), archive: `/l2/${"Z".repeat(64)}/asset.l2asset` }),
      /invalid model/],
    ["an archive path outside /l2/", () => withModel([chunkPlacement()], { archive: `/assets/${archiveSha256}/asset.l2asset` }), /invalid model/],
  ])("refuses %s", (_, document, message) => {
    expect(() => parseNativeTileChunkManifest(document())).toThrow(message);
  });
});

const collisionSha256 = "e".repeat(64);

function collisionTileResource(): Document {
  return { kind: "native-tile-collision", manifest: `/l2/maps/${collisionSha256}/native-tile-collision/asset.json`, manifestSha256: collisionSha256,
    manifestBytes: 2197 };
}

describe("native tile collision resources", () => {
  it("accepts a chunk collision resource in place of the collision gap row", () => {
    const resource = `/l2/maps/${collisionSha256}/native-tile-chunk-collision/asset.json`;
    const chunk = parseNativeTileChunkManifest(withChunk(document => {
      document.collision = { resource, sha256: collisionSha256 };
      document.gaps = (document.gaps as Document[]).filter(row => row.step !== "collision");
    }));
    expect(chunk.collision).toEqual({ resource, sha256: collisionSha256 });
  });

  it.each<[string, Document]>([
    ["a path outside its hash folder", { resource: `/l2/maps/${"d".repeat(64)}/native-tile-chunk-collision/asset.json`, sha256: collisionSha256 }],
    ["an extra key", { resource: `/l2/maps/${collisionSha256}/native-tile-chunk-collision/asset.json`, sha256: collisionSha256, bytes: 1 }],
    ["a path outside /l2/", { resource: `/assets/maps/${collisionSha256}/native-tile-chunk-collision/asset.json`, sha256: collisionSha256 }],
  ])("refuses a chunk collision resource with %s", (_, collision) => {
    expect(() => parseNativeTileChunkManifest(withChunk(document => { document.collision = collision; }))).toThrow(/collision must be/);
  });

  it("accepts the native-tile-collision tile resource", () => {
    expect(parseNativeTileManifest(withTile(tile => { tile.resources = [collisionTileResource()]; })).resources).toEqual([collisionTileResource()]);
  });
});

describe("native tile manifest parser", () => {
  it("accepts the fixture tile manifest with its frame, anchor and pinned chunk", () => {
    const tile = parseNativeTileManifest(tileDocument());
    expect(tile).toMatchObject({ kind: "native-tile-runtime", tileId: fixtureTileId, sourceMap: `maps/${fixtureTileId}.unr`,
      frame: { terrainInfo: "Fixture.TerrainInfo0", location: [0, 0, 0], terrainScale: [128, 128, 76] },
      anchor: { playerStart: "Fixture.PlayerStart0", location: [128, 128, 200] }, resources: [] });
    expect(tile.chunks).toEqual([{ chunkId: "chunk-0-0", manifest: fixture.chunk.path, manifestSha256: fixture.chunk.sha256,
      manifestBytes: fixture.chunk.bytes.byteLength }]);
    expect(tile.gaps.map(row => row.step)).toEqual(["audio", "bsp", "collision", "meshes", "minimap", "movers", "sky", "terrain-material"]);
    expect(parseNativeTileManifest(tileDocument())).toEqual(tile);
  });

  it.each<[string, (tile: Document) => void, RegExp]>([
    ["a chunk path outside the chunk manifest folder", tile => {
      chunkRecords(tile)[0]!.manifest = `/l2/maps/${fixture.chunk.sha256}/map-section-runtime/manifest.json`; }, /invalid chunk record/],
    ["duplicate chunk ids", tile => { tile.chunks = [chunkRecord(0, 0), chunkRecord(0, 0)]; }, /lists chunk chunk-0-0 twice/],
    ["chunks out of column, row order", tile => { tile.chunks = [chunkRecord(1, 0), chunkRecord(0, 1)]; }, /sorted by \(column, row\)/],
    ["more than 256 chunks", tile => { tile.chunks = Array.from({ length: 257 }, (_, index) => chunkRecord(Math.floor(index / 16), index % 16)); },
      /1 to 256 chunks/],
    ["a null anchor", tile => { tile.anchor = null; }, /needs an anchor/],
    ["a frame with a fourth field", tile => { (tile.frame as Document).sectorGrid = [1, 1]; }, /frame must hold exactly/],
    ["a resource kind this client cannot read", tile => { tile.resources = [{ kind: "sky" }]; }, /resources hold only native-tile-collision/],
    ["a collision resource outside its hash folder", tile => { tile.resources = [{ ...collisionTileResource(), manifestSha256: "d".repeat(64) }]; },
      /resources hold only native-tile-collision/],
    ["a source map of another tile", tile => { tile.sourceMap = "maps/20_21.unr"; }, /source identity is invalid/],
  ])("refuses %s", (_, change, message) => {
    expect(() => parseNativeTileManifest(withTile(change))).toThrow(message);
  });
});

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
    ["a resource list this client cannot read", tile => { tile.resources = [{ kind: "sky" }]; }, /resources are not supported/],
    ["a source map of another tile", tile => { tile.sourceMap = "maps/20_21.unr"; }, /source identity is invalid/],
  ])("refuses %s", (_, change, message) => {
    expect(() => parseNativeTileManifest(withTile(change))).toThrow(message);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTileCollisionCells } from "../../src/runtime/tileCollisionCells";
import { createCollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import { collisionBspTreeFixtureArrays, collisionChunkFixtureArrays, replaceFixtureArray, writeCollisionFixture } from "../support/nativeTileCollisionFixture";
import { decodeJsonDocument, fixtureTileId, jsonBytes, readFixtureTileFiles, sha256Hex } from "../support/nativeTileFixtureStore";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

type Document = Record<string, unknown>;

interface StoredResource {
  readonly resource: string;
  readonly sha256: string;
  readonly bytes: number;
}

type ChunkCollision = "absent" | "without-terrain" | "with-terrain";

const terrainArrayNames = ["TERR.location", "TERR.terrainScale", "TERR.heightmapSize", "TERR.vertexRectangle", "TERR.heights", "TERR.quadVisibility", "TERR.edgeTurn"];

const collisionArraysWithoutTerrain = () =>
  terrainArrayNames.reduce((arrays, name) => replaceFixtureArray(arrays, name, []), collisionChunkFixtureArrays());

function servedTileStore(chunkCollisions: readonly ChunkCollision[], { pinsTileCollision = true } = {}) {
  const responses = new Map<string, Uint8Array<ArrayBuffer>>();
  const storeCollision = (folder: string, arrays: readonly TypedPayloadFixtureArray[]): StoredResource => {
    const fixture = writeCollisionFixture(arrays);
    const payloadBytes = new Uint8Array(fixture.payloadBytes);
    const assetBytes = jsonBytes({ ...fixture.assetRecord, payload: { file: "payload.bin", sha256: sha256Hex(payloadBytes), bytes: payloadBytes.byteLength } });
    const assetSha256 = sha256Hex(assetBytes), directory = `/l2/maps/${assetSha256}/${folder}`;
    responses.set(`${directory}/asset.json`, assetBytes);
    responses.set(`${directory}/payload.bin`, payloadBytes);
    return { resource: `${directory}/asset.json`, sha256: assetSha256, bytes: assetBytes.byteLength };
  };
  const fixture = readFixtureTileFiles();
  const chunkRecords = chunkCollisions.map((collision, row) => {
    const chunk = decodeJsonDocument(fixture.chunk.bytes);
    chunk.chunkId = `chunk-0-${row}`;
    chunk.sectorRange = { firstColumn: 0, lastColumn: 0, firstRow: row * 4, lastRow: row * 4 };
    if (collision !== "absent") {
      const stored = storeCollision("native-tile-chunk-collision", collision === "with-terrain" ? collisionChunkFixtureArrays() : collisionArraysWithoutTerrain());
      chunk.collision = { resource: stored.resource, sha256: stored.sha256 };
      chunk.gaps = (chunk.gaps as Document[]).filter(gap => gap.step !== "collision");
    }
    const bytes = jsonBytes(chunk), sha256 = sha256Hex(bytes), manifest = `/l2/maps/${sha256}/native-tile-chunk-runtime/manifest.json`;
    responses.set(manifest, bytes);
    return { chunkId: chunk.chunkId, manifest, manifestSha256: sha256, manifestBytes: bytes.byteLength };
  });
  const tileCollision = storeCollision("native-tile-collision", collisionBspTreeFixtureArrays());
  const tile = decodeJsonDocument(fixture.tile.bytes);
  tile.chunks = chunkRecords;
  if (pinsTileCollision) {
    tile.resources = [{ kind: "native-tile-collision", manifest: tileCollision.resource, manifestSha256: tileCollision.sha256, manifestBytes: tileCollision.bytes }];
    tile.gaps = (tile.gaps as Document[]).filter(gap => gap.step !== "collision");
  }
  const tileBytes = jsonBytes(tile), tileSha256 = sha256Hex(tileBytes), tilePath = `/l2/tiles/${tileSha256}/tile.json`;
  responses.set(tilePath, tileBytes);
  responses.set("/l2/catalog.json", jsonBytes({ schemaVersion: 1, models: [],
    tiles: [{ id: fixtureTileId, manifest: tilePath, manifestSha256: tileSha256, manifestBytes: tileBytes.byteLength }] }));
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    const bytes = responses.get(path);
    return bytes === undefined ? new Response("missing", { status: 404 }) : new Response(bytes.slice().buffer);
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("tile collision cell loading", () => {
  it("names chunks without collision or without a terrain footprint as gaps and makes the remaining cell and the tile BSP tree resident", async () => {
    servedTileStore(["absent", "without-terrain", "with-terrain"]);
    const world = createCollisionWorld();
    const load = await loadTileCollisionCells(world, fixtureTileId, new AbortController().signal);
    expect(load).toEqual({ tileId: fixtureTileId, residentCellIds: [`${fixtureTileId}/chunk-0-2`], chunkGaps: [
      { chunkId: "chunk-0-0", reason: "chunk-collision-resource-absent" }, { chunkId: "chunk-0-1", reason: "collision-cell-terrain-absent" }] });
    expect(world.inspection()).toMatchObject({ requiredCellCount: 1, residentCellCount: 1, missingCellIds: [] });
    expect(world.residentCells().map(cell => cell.cellId)).toEqual([`${fixtureTileId}/chunk-0-2`]);
    expect(world.tileBspTree(fixtureTileId)?.nodeCount).toBe(3);
  });

  it("leaves the tile BSP tree out when no chunk cell has a terrain footprint", async () => {
    servedTileStore(["absent", "without-terrain"]);
    const world = createCollisionWorld();
    const load = await loadTileCollisionCells(world, fixtureTileId, new AbortController().signal);
    expect(load.residentCellIds).toEqual([]);
    expect(load.chunkGaps.map(gap => gap.reason)).toEqual(["chunk-collision-resource-absent", "collision-cell-terrain-absent"]);
    expect(world.inspection()).toMatchObject({ requiredCellCount: 0, residentCellCount: 0 });
    expect(world.tileBspTree(fixtureTileId)).toBeNull();
  });

  it("refuses a tile the served catalog does not list and a tile manifest that pins no tile collision resource", async () => {
    servedTileStore(["with-terrain"]);
    await expect(loadTileCollisionCells(createCollisionWorld(), "20_20", new AbortController().signal))
      .rejects.toThrow("Tile 20_20 collision: the served catalog lists no tile record.");
    vi.unstubAllGlobals();
    servedTileStore(["with-terrain"], { pinsTileCollision: false });
    await expect(loadTileCollisionCells(createCollisionWorld(), fixtureTileId, new AbortController().signal))
      .rejects.toThrow(`Tile ${fixtureTileId} collision: the tile manifest pins no native-tile-collision resource.`);
  });
});

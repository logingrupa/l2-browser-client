import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createCollisionWorld, type CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import {
  collisionCellContextFor, collisionFocusSourcePosition, provideCollisionCellContext,
} from "../../src/scene/world/movement/collisionCellContext";
import { loadCollisionCell, loadTileBspTree, nativeTileCollisionCellId } from "../../src/scene/world/movement/loadCollisionCells";
import type { NativeTileChunkManifest } from "../../src/scene/world/nativeTileChunkManifest";
import type { NativeTileResource } from "../../src/scene/world/nativeTileManifest";
import { collisionBspTreeFixtureArrays, collisionChunkFixtureArrays, writeCollisionFixture } from "../support/nativeTileCollisionFixture";
import { jsonBytes, sha256Hex } from "../support/nativeTileFixtureStore";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

interface StoredCollisionResource {
  readonly resource: string;
  readonly sha256: string;
  readonly bytes: number;
}

type AssetRecordEdit = (assetRecord: Record<string, unknown>) => Record<string, unknown>;

const tileId = "20_21";
const footprintOfColumn = (column: number) => ({ minimumX: column * 4096, minimumY: 0, maximumX: (column + 1) * 4096, maximumY: 4096 });

function createFixtureStore() {
  const responses = new Map<string, Uint8Array<ArrayBuffer>>();
  const fetcher = vi.fn(async (path: string) => {
    const bytes = responses.get(path);
    return bytes === undefined ? new Response("missing", { status: 404 }) : new Response(bytes.slice().buffer);
  });
  vi.stubGlobal("fetch", fetcher);
  const store = (folder: string, arrays: readonly TypedPayloadFixtureArray[], editAssetRecord: AssetRecordEdit = record => record): StoredCollisionResource => {
    const fixture = writeCollisionFixture(arrays);
    const payloadBytes = new Uint8Array(fixture.payloadBytes);
    const assetRecord = editAssetRecord({ ...fixture.assetRecord, payload: { file: "payload.bin", sha256: sha256Hex(payloadBytes), bytes: payloadBytes.byteLength } });
    const assetBytes = jsonBytes(assetRecord), assetSha256 = sha256Hex(assetBytes);
    const directory = `/l2/maps/${assetSha256}/${folder}`;
    responses.set(`${directory}/asset.json`, assetBytes);
    responses.set(`${directory}/payload.bin`, payloadBytes);
    return { resource: `${directory}/asset.json`, sha256: assetSha256, bytes: assetBytes.byteLength };
  };
  return { responses, fetcher, store };
}

function chunkManifest(chunkId: string, collision: StoredCollisionResource | null): NativeTileChunkManifest {
  return {
    kind: "native-tile-chunk-runtime", schemaVersion: 1, tileId, chunkId, sectorRange: { firstColumn: 0, lastColumn: 3, firstRow: 0, lastRow: 3 },
    terrain: null, models: [], bsp: null, collision: collision === null ? null : { resource: collision.resource, sha256: collision.sha256 }, gaps: [],
  };
}

const tileCollisionResource = (stored: StoredCollisionResource): NativeTileResource =>
  ({ kind: "native-tile-collision", manifest: stored.resource, manifestSha256: stored.sha256, manifestBytes: stored.bytes });

function requiredWorld(...chunkIds: string[]): CollisionWorld {
  const world = createCollisionWorld();
  chunkIds.forEach((chunkId, column) => world.requireCell(nativeTileCollisionCellId(tileId, chunkId), footprintOfColumn(column)));
  return world;
}

const signal = () => new AbortController().signal;

function flipStoredByte(responses: Map<string, Uint8Array<ArrayBuffer>>, path: string): void {
  const bytes = responses.get(path)!;
  bytes.set([bytes[0]! ^ 1], 0);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("loadCollisionCell", () => {
  it("adds a pinned chunk cell to the world with its tile BSP tree", async () => {
    const { store } = createFixtureStore();
    const chunk = chunkManifest("chunk-0-0", store("native-tile-chunk-collision", collisionChunkFixtureArrays()));
    const tileCollision = tileCollisionResource(store("native-tile-collision", collisionBspTreeFixtureArrays()));
    const world = requiredWorld("chunk-0-0");
    expect(world.isReady({ x: 100, y: 100 })).toBe(false);
    const cell = await loadCollisionCell(world, { chunk, tileCollision }, signal());
    expect(cell.cellId).toBe("20_21/chunk-0-0");
    expect(cell.volumes[0]!.exportIndex).toBe(417);
    expect(world.residentCells()).toEqual([cell]);
    expect(world.isReady({ x: 100, y: 100 })).toBe(true);
    expect(world.tileBspTree(tileId)!.nodeCount).toBe(3);
  });

  it("loads the tile BSP tree once for two chunks of the same tile, loaded together or one after the other", async () => {
    const { store, fetcher } = createFixtureStore();
    const tileStored = store("native-tile-collision", collisionBspTreeFixtureArrays()), tileCollision = tileCollisionResource(tileStored);
    const chunkStored = store("native-tile-chunk-collision", collisionChunkFixtureArrays());
    const world = requiredWorld("chunk-0-0", "chunk-1-0", "chunk-2-0");
    await Promise.all(["chunk-0-0", "chunk-1-0"].map(chunkId => loadCollisionCell(world, { chunk: chunkManifest(chunkId, chunkStored), tileCollision }, signal())));
    await loadCollisionCell(world, { chunk: chunkManifest("chunk-2-0", chunkStored), tileCollision }, signal());
    expect(fetcher.mock.calls.filter(([path]) => path === tileStored.resource)).toHaveLength(1);
    expect(world.inspection()).toMatchObject({ residentCellCount: 3, missingCellIds: [] });
  });

  it("refuses a chunk collision resource whose bytes differ from its SHA-256 pin", async () => {
    const { store, responses } = createFixtureStore();
    const chunkStored = store("native-tile-chunk-collision", collisionChunkFixtureArrays());
    flipStoredByte(responses, chunkStored.resource);
    const tileCollision = tileCollisionResource(store("native-tile-collision", collisionBspTreeFixtureArrays()));
    await expect(loadCollisionCell(requiredWorld("chunk-0-0"), { chunk: chunkManifest("chunk-0-0", chunkStored), tileCollision }, signal()))
      .rejects.toThrow(/hash\/length mismatch/);
  });

  it("refuses a tile collision resource whose length differs from its record", async () => {
    const { store } = createFixtureStore();
    const tileStored = store("native-tile-collision", collisionBspTreeFixtureArrays());
    await expect(loadTileBspTree(tileId, { ...tileCollisionResource(tileStored), manifestBytes: tileStored.bytes + 1 }, signal()))
      .rejects.toThrow(/hash\/length mismatch/);
  });

  it("refuses a payload whose bytes differ from the payload pin in asset.json", async () => {
    const { store, responses } = createFixtureStore();
    const tileStored = store("native-tile-collision", collisionBspTreeFixtureArrays());
    flipStoredByte(responses, tileStored.resource.replace("asset.json", "payload.bin"));
    await expect(loadTileBspTree(tileId, tileCollisionResource(tileStored), signal())).rejects.toThrow(/hash\/length mismatch/);
  });

  it.each([
    ["units that are not source", (record: Record<string, unknown>) => ({ ...record, units: "metre" }), /units must be "source"/],
    ["axes that are not UE2 Z up", (record: Record<string, unknown>) => ({ ...record, axes: "gltf-y-up" }), /axes must be "ue2-z-up"/],
    ["no payload pin", ({ payload: _payload, ...record }: Record<string, unknown>) => record, /has no payload pin/],
    ["a payload pin naming another file", (record: Record<string, unknown>) => ({ ...record, payload: { ...(record.payload as object), file: "../payload.bin" } }),
      /payload pin must name payload\.bin/],
  ])("refuses an asset.json with %s", async (_case, editAssetRecord, message) => {
    const { store } = createFixtureStore();
    const tileStored = store("native-tile-collision", collisionBspTreeFixtureArrays(), editAssetRecord);
    await expect(loadTileBspTree(tileId, tileCollisionResource(tileStored), signal())).rejects.toThrow(message);
  });

  it("refuses a resource path outside /l2/", async () => {
    createFixtureStore();
    const outsidePath = { resource: "/etc/native-tile-chunk-collision/asset.json", sha256: "a".repeat(64), bytes: 1 };
    const tileCollision: NativeTileResource = { kind: "native-tile-collision", manifest: "/etc/asset.json", manifestSha256: "b".repeat(64), manifestBytes: 1 };
    await expect(loadCollisionCell(requiredWorld("chunk-0-0"), { chunk: chunkManifest("chunk-0-0", outsidePath), tileCollision }, signal()))
      .rejects.toThrow(/bounded \/l2 path/);
    await expect(loadTileBspTree(tileId, tileCollision, signal())).rejects.toThrow(/bounded \/l2 path/);
  });

  it("refuses a tile resource that is not native-tile-collision and a chunk without a collision resource", async () => {
    const { store } = createFixtureStore();
    const tileStored = store("native-tile-collision", collisionBspTreeFixtureArrays());
    await expect(loadTileBspTree(tileId, { ...tileCollisionResource(tileStored), kind: "movers" }, signal())).rejects.toThrow(/is not a native-tile-collision resource/);
    await expect(loadCollisionCell(requiredWorld("chunk-0-0"), { chunk: chunkManifest("chunk-0-0", null), tileCollision: tileCollisionResource(tileStored) }, signal()))
      .rejects.toThrow(/20_21\/chunk-0-0 has no collision resource/);
  });

  it("adds nothing when the load is aborted", async () => {
    const { store } = createFixtureStore();
    const chunk = chunkManifest("chunk-0-0", store("native-tile-chunk-collision", collisionChunkFixtureArrays()));
    const tileCollision = tileCollisionResource(store("native-tile-collision", collisionBspTreeFixtureArrays()));
    const world = requiredWorld("chunk-0-0"), lifetime = new AbortController();
    const load = loadCollisionCell(world, { chunk, tileCollision }, lifetime.signal);
    lifetime.abort();
    await expect(load).rejects.toThrow();
    expect(world.inspection()).toMatchObject({ residentCellCount: 0, missingCellIds: ["20_21/chunk-0-0"] });
    expect(world.tileBspTree(tileId)).toBeNull();
  });
});

describe("collision cell context", () => {
  const createScene = () => {
    const engine = new NullEngine();
    return { engine, scene: new Scene(engine) };
  };

  it("hands the world and the focus to the scene, converted to source units, and refuses a second provider", () => {
    const { engine, scene } = createScene();
    const world = createCollisionWorld();
    expect(collisionCellContextFor(scene)).toBeNull();
    const context = { world, focusPosition: () => ({ x: 1.5, y: 2, z: -3.25 }) };
    const withdraw = provideCollisionCellContext(scene, context);
    expect(collisionCellContextFor(scene)).toBe(context);
    expect(collisionFocusSourcePosition(context)).toEqual({ x: 150, y: -325, z: 200 });
    expect(() => provideCollisionCellContext(scene, { world, focusPosition: () => null })).toThrow(/already has a collision cell context provider/);
    withdraw();
    expect(collisionCellContextFor(scene)).toBeNull();
    scene.dispose();
    engine.dispose();
  });

  it("returns a null focus while the runtime has no player", () => {
    expect(collisionFocusSourcePosition({ world: createCollisionWorld(), focusPosition: () => null })).toBeNull();
  });

  it("withdraws the context when the scene is disposed", () => {
    const { engine, scene } = createScene();
    provideCollisionCellContext(scene, { world: createCollisionWorld(), focusPosition: () => null });
    scene.dispose();
    expect(collisionCellContextFor(scene)).toBeNull();
    engine.dispose();
  });
});

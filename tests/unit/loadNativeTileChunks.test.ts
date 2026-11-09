import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { loadNativeSection, type NativeSection } from "../../src/scene/world/loadNativeSection";
import { loadNativeTileChunks, type NativeTileSectionView } from "../../src/scene/world/loadNativeTileChunks";
import { decodeJsonDocument, fixtureTileId, jsonBytes, readFixtureTileFiles, sha256Hex } from "../support/nativeTileFixtureStore";

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({ LoadAssetContainerAsync: vi.fn() }));

type Document = Record<string, unknown>;

function glb(document: object): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(JSON.stringify(document));
  const size = (text.byteLength + 3) & ~3, bytes = new Uint8Array(20 + size), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(text, 20); return bytes;
}

interface TileStoreOptions { readonly secondChunkTerrain?: "loaded" | "hidden"; readonly anchorLocation?: readonly number[] }

function tileStore(options: TileStoreOptions = {}) {
  const fixture = readFixtureTileFiles();
  const secondTerrainBytes = glb({ asset: { version: "2.0" }, extras: { fixture: "second chunk terrain" } });
  const secondTerrainSha256 = sha256Hex(secondTerrainBytes);
  const secondChunk = decodeJsonDocument(fixture.chunk.bytes);
  secondChunk.chunkId = "chunk-0-1";
  secondChunk.sectorRange = { firstColumn: 0, lastColumn: 0, firstRow: 4, lastRow: 4 };
  if (options.secondChunkTerrain === "hidden") {
    secondChunk.terrain = null;
    const pending = (secondChunk.gaps as Document[])[0]!;
    secondChunk.gaps = [...(secondChunk.gaps as Document[]), { ...pending, step: "terrain", status: "gap", reason: "terrain-quads-all-hidden",
      sourceIdentity: { ...(pending.sourceIdentity as Document), object: "Fixture.TerrainInfo0.TerrainSector0" } }]
      .sort((left, right) => String(left.step).localeCompare(String(right.step)));
  } else {
    secondChunk.terrain = { resource: `/l2/maps/${secondTerrainSha256}/native-tile-chunk-terrain/terrain.glb`, sha256: secondTerrainSha256,
      maskUvRule: "extrapolated" };
  }
  const secondChunkBytes = jsonBytes(secondChunk), secondChunkSha256 = sha256Hex(secondChunkBytes);
  const tile = decodeJsonDocument(fixture.tile.bytes);
  if (options.anchorLocation) tile.anchor = { ...(tile.anchor as Document), location: options.anchorLocation };
  tile.chunks = [...(tile.chunks as Document[]), { chunkId: "chunk-0-1", manifestSha256: secondChunkSha256, manifestBytes: secondChunkBytes.byteLength,
    manifest: `/l2/maps/${secondChunkSha256}/native-tile-chunk-runtime/manifest.json` }];
  const tileBytes = jsonBytes(tile), tileSha256 = sha256Hex(tileBytes);
  const tilePath = `/l2/tiles/${tileSha256}/tile.json`;
  const catalog = { schemaVersion: 1, models: [], tiles: [{ id: fixtureTileId, manifest: tilePath, manifestSha256: tileSha256, manifestBytes: tileBytes.byteLength }] };
  const responses = new Map<string, Uint8Array<ArrayBuffer>>([
    ["/l2/catalog.json", jsonBytes(catalog)], [tilePath, tileBytes], [fixture.chunk.path, fixture.chunk.bytes], [fixture.terrain.path, fixture.terrain.bytes],
    [`/l2/maps/${secondChunkSha256}/native-tile-chunk-runtime/manifest.json`, secondChunkBytes],
    [`/l2/maps/${secondTerrainSha256}/native-tile-chunk-terrain/terrain.glb`, secondTerrainBytes],
  ]);
  const terrainCentres = new Map([[fixture.terrain.sha256, { x: 1.28, z: 1.28 }], [secondTerrainSha256, { x: 1.28, z: 5 }]]);
  return { fixture, tilePath, tileSha256, responses, terrainCentres, secondTerrainSha256 };
}

describe("native tile chunk loading", () => {
  let engine: NullEngine, scene: Scene, loaded: NativeSection[];
  beforeEach(() => {
    engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; loaded = [];
    vi.mocked(LoadAssetContainerAsync).mockReset();
  });
  afterEach(() => { for (const section of loaded) section.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function serve(store: ReturnType<typeof tileStore>) {
    const fetcher = vi.fn(async (url: string) => {
      const value = store.responses.get(url);
      return new Response(value?.slice().buffer ?? "missing", { status: value ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async (bytes) => {
      const centre = store.terrainCentres.get(sha256Hex(bytes as Uint8Array))!;
      const container = new AssetContainer(scene), mesh = MeshBuilder.CreateBox(`terrain ${centre.z}`, { width: 2.56, height: 0.1, depth: 2.56 }, scene);
      mesh.position.set(centre.x, 0, centre.z); mesh.metadata = { gltf: { extras: { nativeObject: "Fixture.TerrainInfo0" } } };
      mesh.material = new StandardMaterial(`terrain material ${centre.z}`, scene);
      container.meshes.push(mesh); container.materials.push(mesh.material); container.removeAllFromScene(); return container;
    });
    return fetcher;
  }

  async function load(tileId = fixtureTileId) {
    const section = await loadNativeTileChunks(scene, new AbortController().signal, tileId);
    if (section) loaded.push(section);
    return section;
  }

  it("loads every chunk terrain in manifest order and spawns on the terrain surface at the anchor XY in glTF axes", async () => {
    const store = tileStore(); serve(store);
    const section = (await load())!;
    const view = section.manifest as NativeTileSectionView;
    expect(view).toMatchObject({ kind: "native-tile-runtime", tileId: fixtureTileId, models: [], placements: [],
      terrain: { file: "terrain.glb", sha256: store.fixture.terrain.sha256, bytes: store.fixture.terrain.bytes.byteLength, materialStatus: "neutral-inspection" } });
    expect(view.terrainChunks.map(chunk => chunk.chunkId)).toEqual(["chunk-0-0", "chunk-0-1"]);
    expect(section.manifestSha256).toBe(store.tileSha256);
    expect(section.terrainMeshes.map(mesh => mesh.metadata.nativeTileChunk)).toEqual([
      { tileId: fixtureTileId, chunkId: "chunk-0-0" }, { tileId: fixtureTileId, chunkId: "chunk-0-1" }]);
    expect(section.terrainMeshes.every(mesh => mesh.metadata.worldTerrain && mesh.metadata.worldSupportsWalking && mesh.isPickable)).toBe(true);
    expect(section.spawnCandidate!.asArray().map(value => Number(value.toFixed(6)))).toEqual([1.28, 0.05, 1.28]);
    expect(view.anchor).toMatchObject({ playerStart: "Fixture.PlayerStart0", authoredSourceLocation: [128, 128, 200],
      rule: "authored PlayerStart XY on the chunk terrain surface; authored Z kept as a diagnostic" });
    expect(view.anchor.authoredHeightAboveTerrainMetres).toBeCloseTo(1.95, 6);
    expect(section.inspection().tileAnchor).toEqual(view.anchor);
    expect(section.supportMeshes).toEqual([]);
    expect(section.inspection()).toMatchObject({ modelCount: 0, placementCount: 0, bspMeshes: 0, collisionVerified: false, terrainMaterial: "neutral-inspection" });
    expect(view.gaps).toContain("meshes: step-pending:meshes");
  });

  it("reports the TerrainInfo chunk plan as its source-derived section window", async () => {
    serve(tileStore());
    expect((await load())!.inspection().sectionWindow).toEqual({ basis: "terrain-info-chunk-plan", status: "source-derived" });
  });

  it("returns null for a tile that is not in the catalog", async () => {
    serve(tileStore());
    expect(await load("20_21")).toBeNull();
    expect(LoadAssetContainerAsync).not.toHaveBeenCalled();
  });

  it("loads no mesh for a chunk whose terrain is null and still lists it with its terrain gap reason", async () => {
    serve(tileStore({ secondChunkTerrain: "hidden" }));
    const section = (await load())!;
    expect(section.terrainMeshes.map(mesh => mesh.metadata.nativeTileChunk.chunkId)).toEqual(["chunk-0-0"]);
    const hiddenChunk = section.inspection().terrainChunks!.find(chunk => chunk.chunkId === "chunk-0-1")!;
    expect(hiddenChunk.terrain).toBeNull();
    expect(hiddenChunk.gaps).toContain("terrain: terrain-quads-all-hidden");
  });

  it("refuses an anchor whose XY lies on no chunk terrain and leaves no mesh", async () => {
    serve(tileStore({ anchorLocation: [128, 50_000, 200] }));
    await expect(load()).rejects.toThrow("The tile anchor lies outside every chunk terrain.");
    expect(scene.meshes).toHaveLength(0);
  });

  it("refuses a tile manifest whose bytes differ from the catalog hash and leaves no mesh", async () => {
    const store = tileStore(); serve(store);
    const tileBytes = store.responses.get(store.tilePath)!;
    store.responses.set(store.tilePath, tileBytes.map((value, index) => index === 2 ? value ^ 1 : value));
    await expect(load()).rejects.toThrow("hash/length mismatch");
    expect(scene.meshes).toHaveLength(0);
  });

  it("disposes the chunk terrains already loaded when the signal aborts during a later chunk load", async () => {
    const store = tileStore(); serve(store);
    const controller = new AbortController(), disposals: ReturnType<typeof vi.spyOn>[] = [];
    const servedLoader = vi.mocked(LoadAssetContainerAsync).getMockImplementation()!;
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async (...parameters) => {
      const container: AssetContainer = await servedLoader(...parameters);
      disposals.push(vi.spyOn(container, "dispose"));
      if (disposals.length === 2) controller.abort();
      return container;
    });
    await expect(loadNativeTileChunks(scene, controller.signal, fixtureTileId)).rejects.toThrow("disposed during loading");
    expect(disposals).toHaveLength(2);
    for (const disposal of disposals) expect(disposal).toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0);
  });

  it("routes loadNativeSection to the tile selected by ?map and keeps the default section without it", async () => {
    const store = tileStore(); serve(store);
    vi.stubGlobal("location", { search: `?map=${fixtureTileId}`, protocol: "http:" });
    const routed = await loadNativeSection(scene, new AbortController().signal);
    if (routed) loaded.push(routed);
    expect(routed?.manifest.kind).toBe("native-tile-runtime");
    vi.stubGlobal("location", { search: "", protocol: "http:" });
    expect(await loadNativeSection(scene, new AbortController().signal)).toBeNull();
  });
});

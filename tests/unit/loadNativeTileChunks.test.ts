import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { loadNativeSliceWorld } from "../../src/runtime/loadNativeSliceWorld";
import { loadNativeMovers } from "../../src/scene/world/loadNativeMovers";
import { loadNativeSection, type NativeSection } from "../../src/scene/world/loadNativeSection";
import { loadNativeTileChunks, type NativeTileSectionView } from "../../src/scene/world/loadNativeTileChunks";
import { decodeJsonDocument, fixtureTileId, jsonBytes, readFixtureTileFiles, sha256Hex } from "../support/nativeTileFixtureStore";
import { assetFixture } from "../fixtures/assetPackageFixture";

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({ LoadAssetContainerAsync: vi.fn() }));
vi.mock("../../src/scene/world/loadNativeMovers", () => ({ loadNativeMovers: vi.fn(async () => null) }));
vi.mock("../../src/scene/world/nativeSkyPresentation", () => ({ createNativeSkyPresentation: async () => null }));

type Document = Record<string, unknown>;

function glb(document: object): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(JSON.stringify(document));
  const size = (text.byteLength + 3) & ~3, bytes = new Uint8Array(20 + size), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(text, 20); return bytes;
}

interface TileStoreOptions {
  readonly secondChunkTerrain?: "loaded" | "hidden";
  readonly anchorLocation?: readonly number[];
  readonly secondChunkModels?: readonly Document[];
  readonly archives?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  readonly secondChunkBsp?: { readonly glb: Uint8Array<ArrayBuffer>; readonly served?: Uint8Array<ArrayBuffer> };
  readonly tileMovers?: boolean;
  readonly tileMoverServerRealId?: number;
}

function tileMoverResponses(serverRealId: number): { readonly resource: Document; readonly responses: [string, Uint8Array<ArrayBuffer>][] } {
  const model = glb({ asset: { version: "2.0" }, extras: { fixture: "tile mover model" } }), modelSha256 = sha256Hex(model), archiveSha256 = "a".repeat(64);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const manifest = { kind: "native-tile-movers", schemaVersion: 1, tileId: fixtureTileId, sourceMap: { path: `maps/${fixtureTileId}.unr`, sha256: "c".repeat(64) },
    classEvidence: {}, gaps: [],
    models: [{ id: "interlude:fixture_s.Door", sourceObject: "fixture_s.Door",
      archive: { resource: `/l2/${archiveSha256}/asset.l2asset`, sha256: archiveSha256, bytes: 10 },
      model: { resource: `/l2/${archiveSha256}/model.glb`, sha256: modelSha256, bytes: model.byteLength } }],
    movers: [3, 7].map(index => ({ id: `interlude:${fixtureTileId}.Mover${index}`, actorName: `Mover${index}`, exportIndex: index,
      modelId: "interlude:fixture_s.Door", serverObject: { realId: serverRealId, id: 0, type: 0 }, closedMatrix: [...identity, index, 0, 0, 1],
      openMatrix: [...identity, index, 1, 0, 1], moveTimeSeconds: 1, initialKey: 0, initiallyClosed: true, keys: [], sounds: [],
      collision: { decision: "gap", slots: [], evidence: ["rule-disagreement:bStatic"] } })) };
  const bytes = jsonBytes(manifest), sha256 = sha256Hex(bytes), resource = `/l2/movers/${sha256}/tile-movers.json`;
  return { resource: { kind: "movers", manifest: resource, manifestSha256: sha256, manifestBytes: bytes.byteLength },
    responses: [[resource, bytes], [`/l2/${archiveSha256}/model.glb`, model]] };
}

function chunkBspGlb(sectionCount: number): Uint8Array<ArrayBuffer> {
  const sections = Array.from({ length: sectionCount }, (_, primitive) => ({ primitive, material: "Fixture_T.Floor", unlit: false, lightmap: -1,
    outdoor: true, translucent: false }));
  const nodeRanges = sections.map((_, primitive) => ({ node: primitive, primitive, firstIndex: 0, indexCount: 6 }));
  return glb({ asset: { version: "2.0" }, extras: { nativeBspChunk: "chunk-0-1", nativeBspSections: sections, nativeBspNodeRanges: nodeRanges } });
}

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
  if (options.secondChunkModels) {
    secondChunk.models = options.secondChunkModels;
    secondChunk.gaps = (secondChunk.gaps as Document[]).filter(row => row.step !== "meshes");
  }
  const bspResponses: [string, Uint8Array<ArrayBuffer>][] = [];
  if (options.secondChunkBsp) {
    const bspSha256 = sha256Hex(options.secondChunkBsp.glb), resource = `/l2/maps/${bspSha256}/native-tile-chunk-bsp/bsp.glb`;
    secondChunk.bsp = { resource, sha256: bspSha256 };
    secondChunk.gaps = (secondChunk.gaps as Document[]).filter(row => row.step !== "bsp");
    bspResponses.push([resource, options.secondChunkBsp.served ?? options.secondChunkBsp.glb]);
  }
  const secondChunkBytes = jsonBytes(secondChunk), secondChunkSha256 = sha256Hex(secondChunkBytes);
  const tile = decodeJsonDocument(fixture.tile.bytes);
  if (options.anchorLocation) tile.anchor = { ...(tile.anchor as Document), location: options.anchorLocation };
  const movers = options.tileMovers ? tileMoverResponses(options.tileMoverServerRealId ?? 0) : null;
  if (movers) tile.resources = [movers.resource];
  tile.chunks = [...(tile.chunks as Document[]), { chunkId: "chunk-0-1", manifestSha256: secondChunkSha256, manifestBytes: secondChunkBytes.byteLength,
    manifest: `/l2/maps/${secondChunkSha256}/native-tile-chunk-runtime/manifest.json` }];
  const tileBytes = jsonBytes(tile), tileSha256 = sha256Hex(tileBytes);
  const tilePath = `/l2/tiles/${tileSha256}/tile.json`;
  const catalog = { schemaVersion: 1, models: [], tiles: [{ id: fixtureTileId, manifest: tilePath, manifestSha256: tileSha256, manifestBytes: tileBytes.byteLength }] };
  const responses = new Map<string, Uint8Array<ArrayBuffer>>([
    ["/l2/catalog.json", jsonBytes(catalog)], [tilePath, tileBytes], [fixture.chunk.path, fixture.chunk.bytes], [fixture.terrain.path, fixture.terrain.bytes],
    [`/l2/maps/${secondChunkSha256}/native-tile-chunk-runtime/manifest.json`, secondChunkBytes],
    [`/l2/maps/${secondTerrainSha256}/native-tile-chunk-terrain/terrain.glb`, secondTerrainBytes], ...(options.archives ?? []), ...bspResponses,
    ...(movers?.responses ?? []),
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
      const centre = store.terrainCentres.get(sha256Hex(bytes as Uint8Array));
      if (!centre) {
        const container = new AssetContainer(scene), mesh = MeshBuilder.CreateBox("static mesh", { size: 1 }, scene);
        container.meshes.push(mesh); container.removeAllFromScene(); return container;
      }
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

  it("loads the tile movers resource closed at each closed matrix and marks none of their meshes for collision", async () => {
    serve(tileStore({ tileMovers: true }));
    const section = (await load())!;
    const inspection = section.inspection();
    expect(inspection.moverCount).toBe(2);
    expect(inspection.moverGap).toBeNull();
    expect(inspection.moverCollisionMeshCount).toBe(0);
    expect(inspection.movers!.map(mover => [mover.id, mover.state, mover.matrix[12]])).toEqual([
      [`interlude:${fixtureTileId}.Mover3`, "closed", 3], [`interlude:${fixtureTileId}.Mover7`, "closed", 7]]);
    expect(section.tileMovers!.targets.flatMap(target => target.meshes).every(mesh => mesh.metadata.worldCollision === undefined)).toBe(true);
    section.dispose();
    expect(scene.transformNodes.filter(node => node.name.includes(".Mover"))).toEqual([]);
  });

  it("keeps the tile and reports a movers gap when the tile mover manifest refuses a mover", async () => {
    serve(tileStore({ tileMovers: true, tileMoverServerRealId: -1 }));
    const section = (await load())!;
    expect(section.tileMovers).toBeNull();
    expect(section.inspection()).toMatchObject({ moverCount: 0, moverGap: "movers-invalid:Native tile mover identity, motion or timing is invalid." });
    expect(section.terrainMeshes).toHaveLength(2);
    expect(scene.transformNodes.filter(node => node.name.includes(".Mover"))).toEqual([]);
  });

  it("hands the tile movers to the slice world as its door targets instead of looking up catalog movers by terrain", async () => {
    const store = tileStore({ tileMovers: true }); serve(store);
    const camera = new ArcRotateCamera("slice camera", 0, 0, 10, Vector3.Zero(), scene);
    const world = await loadNativeSliceWorld(scene, camera, { origin: Vector3.Zero(), leatherShirt: true, flamePreviewEnabled: false },
      async (_scene, _camera, signal) => ({ section: await loadNativeTileChunks(_scene, signal, fixtureTileId), release: () => {} }),
      new AbortController().signal, { requireWorld: false, validateLifetime: () => {} });
    expect(world.worldFailure).toBeUndefined();
    expect(loadNativeMovers).not.toHaveBeenCalled();
    expect(world.movers).toBe(world.section!.tileMovers);
    expect(world.movers!.targets.map(target => target.source.id)).toEqual([`interlude:${fixtureTileId}.Mover3`, `interlude:${fixtureTileId}.Mover7`]);
    const tile = decodeJsonDocument(store.responses.get(store.tilePath)!);
    expect(world.movers!.manifestSha256).toBe((tile.resources as Document[])[0]!.manifestSha256);
    world.release();
    expect(scene.transformNodes.filter(node => node.name.includes(".Mover"))).toEqual([]);
  });

  it("loads each chunk model archive pinned by SHA-256 once and instantiates its placements at their source matrices", async () => {
    const modelId = "interlude:Fixture_S.FixtureMesh";
    const archive = await assetFixture("model", { id: modelId });
    const archiveBytes = new Uint8Array(archive.bytes), archiveSha256 = sha256Hex(archiveBytes);
    const placement = (index: number, matrix: number[]) => ({ id: `interlude:${fixtureTileId}.StaticMeshActor${index}`, modelId,
      sourceActor: `${fixtureTileId}.StaticMeshActor${index}`, exportIndex: index, sourceMesh: "Fixture_S.FixtureMesh", matrix,
      materialOverrides: [], collision: {} });
    const matrices = [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 2, 1], [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 1, 3, 1]];
    const store = tileStore({ archives: new Map([[`/l2/${archiveSha256}/asset.l2asset`, archiveBytes]]),
      secondChunkModels: [{ id: modelId, archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256,
        placements: [placement(3, matrices[0]!), placement(5, matrices[1]!)] }] });
    const fetcher = serve(store);
    const section = (await load())!;
    expect(fetcher.mock.calls.filter(([url]) => url === `/l2/${archiveSha256}/asset.l2asset`)).toHaveLength(1);
    const inspection = section.inspection();
    expect(inspection).toMatchObject({ modelCount: 1, placementCount: 2, meshGapCount: 1 });
    expect(inspection.placements.map(entry => [entry.id, entry.modelId, entry.worldMatrix])).toEqual([
      [`interlude:${fixtureTileId}.StaticMeshActor3`, modelId, matrices[0]], [`interlude:${fixtureTileId}.StaticMeshActor5`, modelId, matrices[1]]]);
    section.dispose();
    expect(scene.meshes.filter(mesh => mesh.name === "static mesh")).toEqual([]);
  });

  it("refuses a model archive whose bytes differ from its pinned SHA-256", async () => {
    const modelId = "interlude:Fixture_S.FixtureMesh";
    const archive = await assetFixture("model", { id: modelId });
    const archiveBytes = new Uint8Array(archive.bytes), archiveSha256 = sha256Hex(archiveBytes);
    const tampered = archiveBytes.slice(); tampered[tampered.length - 1]! ^= 1;
    serve(tileStore({ archives: new Map([[`/l2/${archiveSha256}/asset.l2asset`, tampered]]),
      secondChunkModels: [{ id: modelId, archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256,
        placements: [{ id: `interlude:${fixtureTileId}.StaticMeshActor3`, modelId, sourceActor: `${fixtureTileId}.StaticMeshActor3`, exportIndex: 3,
          sourceMesh: "Fixture_S.FixtureMesh", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], materialOverrides: [], collision: {} }] }] }));
    await expect(load()).rejects.toThrow(/hash\/length mismatch/);
    expect(scene.meshes).toEqual([]);
  });

  it("loads each chunk BSP GLB pinned by SHA-256 and keeps its sections and node ranges", async () => {
    const bsp = chunkBspGlb(1);
    serve(tileStore({ secondChunkBsp: { glb: bsp } }));
    const section = (await load())!;
    const view = section.manifest as NativeTileSectionView;
    const resource = `/l2/maps/${sha256Hex(bsp)}/native-tile-chunk-bsp/bsp.glb`;
    expect(view.bspChunks.map(chunk => [chunk.chunkId, chunk.resource, chunk.sections.length, chunk.nodeRanges.length])).toEqual([
      ["chunk-0-1", resource, 1, 1]]);
    expect(section.inspection()).toMatchObject({ bspMeshes: 1, bspSections: 1, bspResources: [resource] });
    expect(view.bspChunks[0]!.meshes[0]!.metadata.nativeTileBsp).toEqual({ tileId: fixtureTileId, chunkId: "chunk-0-1", resource });
  });

  it("refuses a chunk BSP GLB whose bytes differ from its pin or whose sections differ from its meshes", async () => {
    const bsp = chunkBspGlb(1), tampered = bsp.slice(); tampered[tampered.length - 1]! ^= 1;
    serve(tileStore({ secondChunkBsp: { glb: bsp, served: tampered } }));
    await expect(load()).rejects.toThrow(/hash\/length mismatch/);
    serve(tileStore({ secondChunkBsp: { glb: chunkBspGlb(2) } }));
    await expect(load()).rejects.toThrow(/holds 1 meshes for 2 sections/);
    expect(scene.meshes).toEqual([]);
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

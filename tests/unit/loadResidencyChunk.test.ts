import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { createTileModelTemplates, loadResidencyChunk } from "../../src/scene/world/loadResidencyChunk";
import type { CollisionCell } from "../../src/scene/world/movement/core/collisionCell";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import { loadChunkCollisionCell } from "../../src/scene/world/movement/loadCollisionCells";
import { loadChunkBsp, loadChunkTerrain, loadTileModelTemplate, type LoadedChunkTerrain } from "../../src/scene/world/nativeTileChunkContents";
import { collisionCellTerrainFootprint } from "../../src/scene/world/nativeTileChunkFootprints";
import type { NativeTileChunkManifest, NativeTileChunkModel } from "../../src/scene/world/nativeTileChunkManifest";
import type { ResidencyChunk } from "../../src/scene/world/nativeTileChunkResidency";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import type { ResidencyTile } from "../../src/scene/world/nativeTileResidencyTiles";
import { readCollisionFixturePayload } from "../support/nativeTileCollisionFixture";
import { decodeJsonDocument, readFixtureTileFiles } from "../support/nativeTileFixtureStore";
import { emptyChunkArrays, mixedChunkArrays, wallTreeArrays } from "../fixtures/movement/movementCollisionFixtures";

vi.mock("../../src/scene/world/nativeTileChunkContents", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/scene/world/nativeTileChunkContents")>(),
  loadChunkTerrain: vi.fn(), loadChunkBsp: vi.fn(), loadTileModelTemplate: vi.fn(),
}));
vi.mock("../../src/scene/world/movement/loadCollisionCells", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/scene/world/movement/loadCollisionCells")>(),
  loadChunkCollisionCell: vi.fn(),
}));

const tileId = "00_00";
const chunkId = "chunk-0-0";
const cellId = `${tileId}/${chunkId}`;
const sha256 = "c".repeat(64);
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const decodeCell = (arrays: Parameters<typeof readCollisionFixturePayload>[0]): CollisionCell =>
  decodeNativeTileCollisionCell(readCollisionFixturePayload(arrays), { cellId, tileId });

function chunkModel(archiveSha256: string): NativeTileChunkModel {
  return { id: "interlude:Fixture_S.Rock", archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256,
    placements: [{ id: "interlude:00_00.StaticMeshActor1", modelId: "interlude:Fixture_S.Rock", sourceActor: "StaticMeshActor1", exportIndex: 1,
      sourceMesh: "Fixture_S.Rock", matrix: identityMatrix, materialOverrides: [], collision: {} }] };
}

function chunkManifest(overrides: Partial<NativeTileChunkManifest> = {}): NativeTileChunkManifest {
  return { kind: "native-tile-chunk-runtime", schemaVersion: 1, tileId, chunkId, sectorRange: { firstColumn: 0, lastColumn: 0, firstRow: 0, lastRow: 0 },
    terrain: { resource: `/l2/maps/${sha256}/native-tile-chunk-terrain/terrain.glb`, sha256, maskUvRule: "extrapolated" },
    models: [chunkModel("a".repeat(64))], bsp: null,
    collision: { resource: `/l2/maps/${sha256}/native-tile-chunk-collision/asset.json`, sha256 }, gaps: [], ...overrides };
}

function residencyTile(manifest: NativeTileChunkManifest, expectedCell: CollisionCell): ResidencyTile {
  const footprint = collisionCellTerrainFootprint(expectedCell)!;
  const chunk: ResidencyChunk = { tileId, chunkId, cellId, footprint: { minimumX: 0, minimumZ: 0, maximumX: 1, maximumZ: 1 } };
  return { tileId, manifest: parseNativeTileManifest(decodeJsonDocument(readFixtureTileFiles().tile.bytes)), manifestSha256: sha256,
    chunks: [manifest], chunkManifestsById: new Map([[chunkId, manifest]]),
    tileCollision: { kind: "native-tile-collision", manifest: `/l2/maps/${sha256}/native-tile-collision/asset.json`, manifestSha256: sha256, manifestBytes: 1 },
    grid: { locationX: 0, locationY: 0, scaleX: 1, scaleY: 1, heightmapWidth: 4, heightmapHeight: 4, quadsPerSector: 3, chunkEdgeSourceUnits: 3 },
    residencyChunks: [chunk], expectedSourceFootprints: new Map([[chunkId, footprint]]),
    tileBspTree: () => Promise.resolve(decodeNativeTileBspTree(readCollisionFixturePayload(wallTreeArrays()), tileId)) };
}

describe("residency chunk loading", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => {
    engine = new NullEngine(); scene = new Scene(engine);
    vi.mocked(loadChunkCollisionCell).mockReset(); vi.mocked(loadChunkTerrain).mockReset(); vi.mocked(loadChunkBsp).mockReset();
    vi.mocked(loadTileModelTemplate).mockReset();
  });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  function terrainPart(manifest: NativeTileChunkManifest): LoadedChunkTerrain {
    const container = new AssetContainer(scene), mesh = CreateGround("chunk terrain", { width: 2, height: 2 }, scene);
    container.meshes.push(mesh); container.removeAllFromScene();
    return { container, terrain: manifest.terrain!, bytes: 1, meshes: [mesh] };
  }

  function modelTemplate(): AssetContainer {
    const container = new AssetContainer(scene), mesh = CreateBox("rock", { size: 1 }, scene);
    container.meshes.push(mesh); container.removeAllFromScene();
    return container;
  }

  const startLoad = (manifest: NativeTileChunkManifest, expectedCell: CollisionCell, signal = new AbortController().signal) =>
    loadResidencyChunk(scene, residencyTile(manifest, expectedCell), createTileModelTemplates(scene, signal),
      { tileId, chunkId, cellId, footprint: { minimumX: 0, minimumZ: 0, maximumX: 1, maximumZ: 1 } }, signal);

  it("builds terrain, decoded collision and model instances, and lists only the instance meshes as visual", async () => {
    const manifest = chunkManifest(), cell = decodeCell(mixedChunkArrays());
    vi.mocked(loadChunkCollisionCell).mockResolvedValue(cell);
    const terrain = terrainPart(manifest);
    vi.mocked(loadChunkTerrain).mockResolvedValue(terrain);
    vi.mocked(loadTileModelTemplate).mockResolvedValue(modelTemplate());
    const loaded = await startLoad(manifest, cell);
    expect(loaded.collisionCell).toBe(cell);
    expect(loaded.terrainMeshes).toEqual(terrain.meshes);
    expect(loaded.instances.map(instance => instance.source.id)).toEqual(["interlude:00_00.StaticMeshActor1"]);
    expect(loaded.visualMeshes).toHaveLength(1);
    expect(loaded.visualMeshes).not.toContain(terrain.meshes[0]);
    loaded.container.dispose();
    expect(terrain.meshes[0]!.isDisposed()).toBe(true);
    expect(loaded.visualMeshes[0]!.isDisposed()).toBe(true);
  });

  it("refuses a chunk without collision with its collision gap reason and fetches nothing", async () => {
    const manifest = chunkManifest({ collision: null,
      gaps: [{ key: "collision", part: "world", step: "collision", status: "gap", reason: "collision-volume-unsupported" }] });
    await expect(startLoad(manifest, decodeCell(mixedChunkArrays()))).rejects.toThrow("collision-volume-unsupported");
    await expect(startLoad(chunkManifest({ collision: null }), decodeCell(mixedChunkArrays()))).rejects.toThrow("chunk-collision-resource-absent");
    expect(loadChunkCollisionCell).not.toHaveBeenCalled();
  });

  it("refuses a collision cell whose terrain footprint differs from the sector range footprint before loading terrain", async () => {
    const manifest = chunkManifest();
    vi.mocked(loadChunkCollisionCell).mockResolvedValue(decodeCell(mixedChunkArrays()));
    const shifted = decodeCell(mixedChunkArrays());
    const expected: CollisionCell = { ...shifted, terrain: { ...shifted.terrain!, firstColumn: shifted.terrain!.firstColumn + 1 } };
    await expect(startLoad(manifest, expected)).rejects.toThrow(`Native tile chunk ${cellId} collision terrain differs from its sector range footprint.`);
    expect(loadChunkTerrain).not.toHaveBeenCalled();
  });

  it("accepts a collision cell without terrain against any sector range footprint", async () => {
    const manifest = chunkManifest({ terrain: null, models: [] });
    vi.mocked(loadChunkCollisionCell).mockResolvedValue(decodeCell(emptyChunkArrays()));
    const loaded = await startLoad(manifest, decodeCell(mixedChunkArrays()));
    expect(loaded.terrain).toBeNull();
    loaded.container.dispose();
  });

  it("disposes the terrain already built when a model template fails", async () => {
    const manifest = chunkManifest(), cell = decodeCell(mixedChunkArrays());
    vi.mocked(loadChunkCollisionCell).mockResolvedValue(cell);
    const terrain = terrainPart(manifest);
    vi.mocked(loadChunkTerrain).mockResolvedValue(terrain);
    vi.mocked(loadTileModelTemplate).mockRejectedValue(new Error("model archive absent"));
    await expect(startLoad(manifest, cell)).rejects.toThrow("model archive absent");
    expect(terrain.meshes[0]!.isDisposed()).toBe(true);
  });

  it("disposes the terrain already built and instantiates nothing when the load is aborted while templates load", async () => {
    const manifest = chunkManifest(), cell = decodeCell(mixedChunkArrays()), abort = new AbortController();
    vi.mocked(loadChunkCollisionCell).mockResolvedValue(cell);
    const terrain = terrainPart(manifest);
    vi.mocked(loadChunkTerrain).mockResolvedValue(terrain);
    vi.mocked(loadTileModelTemplate).mockImplementation(async () => { abort.abort(); return modelTemplate(); });
    const meshCountBefore = scene.meshes.length;
    await expect(startLoad(manifest, cell, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(terrain.meshes[0]!.isDisposed()).toBe(true);
    expect(scene.meshes).toHaveLength(meshCountBefore);
  });
});

describe("tile model templates", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); vi.mocked(loadTileModelTemplate).mockReset(); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("loads a model once for every chunk that lists it", async () => {
    const template = new AssetContainer(scene);
    vi.mocked(loadTileModelTemplate).mockResolvedValue(template);
    const templates = createTileModelTemplates(scene, new AbortController().signal);
    const [first, second] = await Promise.all([templates.template(chunkModel("a".repeat(64))), templates.template(chunkModel("a".repeat(64)))]);
    expect(first).toBe(template);
    expect(second).toBe(template);
    expect(loadTileModelTemplate).toHaveBeenCalledOnce();
    expect(templates.loadedCount).toBe(1);
  });

  it("refuses a model id listed with a second archive", async () => {
    vi.mocked(loadTileModelTemplate).mockResolvedValue(new AssetContainer(scene));
    const templates = createTileModelTemplates(scene, new AbortController().signal);
    await templates.template(chunkModel("a".repeat(64)));
    await expect(templates.template(chunkModel("b".repeat(64)))).rejects.toThrow("Native tile lists model interlude:Fixture_S.Rock with two archives.");
    expect(loadTileModelTemplate).toHaveBeenCalledOnce();
  });

  it("drops a failed load so a later chunk loads the model again", async () => {
    const template = new AssetContainer(scene);
    vi.mocked(loadTileModelTemplate).mockRejectedValueOnce(new Error("model archive absent")).mockResolvedValueOnce(template);
    const templates = createTileModelTemplates(scene, new AbortController().signal);
    await expect(templates.template(chunkModel("a".repeat(64)))).rejects.toThrow("model archive absent");
    await expect(templates.template(chunkModel("a".repeat(64)))).resolves.toBe(template);
    expect(loadTileModelTemplate).toHaveBeenCalledTimes(2);
  });

  it("disposes loaded templates on dispose and a template that resolves after dispose", async () => {
    const loadedTemplate = new AssetContainer(scene), lateTemplate = new AssetContainer(scene);
    const loadedDispose = vi.spyOn(loadedTemplate, "dispose"), lateDispose = vi.spyOn(lateTemplate, "dispose");
    let resolveLate: (template: AssetContainer) => void = () => undefined;
    vi.mocked(loadTileModelTemplate).mockResolvedValueOnce(loadedTemplate)
      .mockReturnValueOnce(new Promise<AssetContainer>(resolve => { resolveLate = resolve; }));
    const templates = createTileModelTemplates(scene, new AbortController().signal);
    await templates.template(chunkModel("a".repeat(64)));
    const late = templates.template({ ...chunkModel("b".repeat(64)), id: "interlude:Fixture_S.Tree" });
    templates.dispose();
    await Promise.resolve();
    expect(loadedDispose).toHaveBeenCalledOnce();
    resolveLate(lateTemplate);
    await late;
    expect(lateDispose).toHaveBeenCalled();
    expect(templates.loadedCount).toBe(0);
  });
});

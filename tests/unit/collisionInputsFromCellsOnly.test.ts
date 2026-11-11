import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { createCollisionWorld, type CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import {
  createNativeTileChunkResidency, type LoadedResidencyChunk, type NativeTileChunkResidency, type ResidencyChunk,
} from "../../src/scene/world/nativeTileChunkResidency";
import { WorldResidencyError, type WorldResidencySettings } from "../../src/scene/world/worldResidencyRing";
import type { WorldPosition } from "../../src/world/sourceFrame";
import { readCollisionFixturePayload } from "../support/nativeTileCollisionFixture";
import { emptyChunkArrays, wallTreeArrays } from "../fixtures/movement/movementCollisionFixtures";

const tileId = "90_90";
const chunkEdgeMetres = 10;
const settings: WorldResidencySettings = { visualRadiusMetres: 10, collisionRadiusMetres: 20, retainRadiusMetres: 30, lodCullDistanceMetres: 10 };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });

function residencyChunk(column: number, row = 0): ResidencyChunk {
  const chunkId = `chunk-${column}-${row}`;
  return { tileId, chunkId, cellId: `${tileId}/${chunkId}`,
    footprint: { minimumX: column * chunkEdgeMetres, minimumZ: row * chunkEdgeMetres, maximumX: (column + 1) * chunkEdgeMetres, maximumZ: (row + 1) * chunkEdgeMetres } };
}

interface PendingLoad {
  readonly signal: AbortSignal;
  resolve(loaded: LoadedResidencyChunk): void;
  reject(error: Error): void;
}

function recordingCollisionWorld(events: string[]) {
  const world = createCollisionWorld();
  const argumentsSeen: unknown[] = [];
  const recorded: CollisionWorld = {
    ...world,
    requireCell(cellId, footprint) { events.push(`requireCell:${cellId}`); argumentsSeen.push(footprint); world.requireCell(cellId, footprint); },
    addCell(cellId, cell) { events.push(`addCell:${cellId}`); argumentsSeen.push(cell); world.addCell(cellId, cell); },
    removeCell(cellId) { events.push(`removeCell:${cellId}`); world.removeCell(cellId); },
    setTileBspTree(treeTileId, tree) { events.push(`setTileBspTree:${treeTileId}`); argumentsSeen.push(tree); world.setTileBspTree(treeTileId, tree); },
  };
  return { world: recorded, argumentsSeen };
}

function residencyHarness(columns: readonly number[], focusX: number) {
  return residencyHarnessForChunks(columns.map(column => residencyChunk(column)), { x: focusX, y: 0, z: chunkEdgeMetres / 2 });
}

function residencyHarnessForChunks(chunks: readonly ResidencyChunk[], initialFocus: WorldPosition) {
  const engine = new NullEngine(), scene = new Scene(engine);
  const events: string[] = [];
  const { world, argumentsSeen } = recordingCollisionWorld(events);
  const pending = new Map<string, PendingLoad>();
  const loadCalls: string[] = [];
  let focus: WorldPosition | null = initialFocus;
  const residency: NativeTileChunkResidency<LoadedResidencyChunk> = createNativeTileChunkResidency({
    scene, collisionWorld: world, settings, chunks, initialFocus,
    focusPosition: () => focus,
    loadChunk: (chunk, signal) => new Promise<LoadedResidencyChunk>((resolve, reject) => {
      events.push(`load:${chunk.cellId}`); loadCalls.push(chunk.cellId);
      pending.set(chunk.cellId, { signal, resolve, reject });
    }),
  });
  releases.push(() => { residency.dispose(); scene.dispose(); engine.dispose(); });
  const builtChunks = new Map<string, LoadedResidencyChunk>();
  const resolveLoad = async (cellId: string) => {
    const load = pending.get(cellId);
    if (load === undefined) throw new Error(`no pending load for ${cellId}`);
    pending.delete(cellId);
    const container = new AssetContainer(scene);
    const terrain = CreateGround(`terrain ${cellId}`, { width: chunkEdgeMetres, height: chunkEdgeMetres }, scene);
    const visual = CreateBox(`visual ${cellId}`, { size: 1 }, scene);
    container.meshes.push(terrain, visual);
    container.removeAllFromScene();
    const originalDispose = container.dispose.bind(container);
    container.dispose = () => { events.push(`dispose:${cellId}`); originalDispose(); };
    const collisionCell = decodeNativeTileCollisionCell(readCollisionFixturePayload(emptyChunkArrays()), { cellId, tileId });
    const collisionBspTree = decodeNativeTileBspTree(readCollisionFixturePayload(wallTreeArrays()), tileId);
    const loaded: LoadedResidencyChunk = { container, terrainMeshes: [terrain], visualMeshes: [visual], collisionCell, collisionBspTree };
    builtChunks.set(cellId, loaded);
    load.resolve(loaded);
    await flush();
    return loaded;
  };
  const resolveAll = async () => { while (pending.size > 0) await resolveLoad([...pending.keys()][0]!); };
  const renderFrame = () => { scene.onBeforeRenderObservable.notifyObservers(scene); };
  return { scene, world, events, argumentsSeen, pending, loadCalls, residency, resolveLoad, resolveAll, builtChunks, renderFrame,
    setFocus: (x: number, z: number) => { focus = { x, y: 0, z }; },
    setFocusX: (x: number) => { focus = { x, y: 0, z: chunkEdgeMetres / 2 }; } };
}

describe("native tile chunk residency collision inputs", () => {
  it("refuses settings whose collision ring is not wider than the visual ring", () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    releases.push(() => { scene.dispose(); engine.dispose(); });
    expect(() => createNativeTileChunkResidency({ scene, collisionWorld: createCollisionWorld(), settings: { ...settings, collisionRadiusMetres: 10 },
      chunks: [], initialFocus: { x: 0, y: 0, z: 0 }, focusPosition: () => null, loadChunk: () => Promise.reject(new Error("unused")) })).toThrow(WorldResidencyError);
  });

  it("requires every chunk of the collision ring in source units before its load starts and loads at most three at once", async () => {
    const { events, argumentsSeen, loadCalls, resolveLoad } = residencyHarness([0, 1, 2, 3, 4, 5], 25);
    expect(loadCalls).toEqual(["90_90/chunk-2-0", "90_90/chunk-1-0", "90_90/chunk-3-0"]);
    for (const cellId of ["90_90/chunk-0-0", "90_90/chunk-1-0", "90_90/chunk-2-0", "90_90/chunk-3-0", "90_90/chunk-4-0"]) {
      expect(events.indexOf(`requireCell:${cellId}`)).toBeGreaterThanOrEqual(0);
    }
    for (const cellId of loadCalls) expect(events.indexOf(`requireCell:${cellId}`)).toBeLessThan(events.indexOf(`load:${cellId}`));
    expect(events).not.toContain("requireCell:90_90/chunk-5-0");
    expect(argumentsSeen[0]).toEqual({ minimumX: 0, minimumY: 0, maximumX: 1000, maximumY: 1000 });
    await resolveLoad("90_90/chunk-2-0");
    expect(loadCalls).toHaveLength(4);
    expect(loadCalls[3]).toBe("90_90/chunk-0-0");
  });

  it("adds the decoded collision cell and its tile tree only, never a mesh, and culls only visual meshes with one null level", async () => {
    const { world, argumentsSeen, resolveLoad, scene } = residencyHarness([0, 1, 2], 5);
    const nearest = await resolveLoad("90_90/chunk-0-0");
    const farthest = await resolveLoad("90_90/chunk-2-0");
    expect(world.residentCells()).toContain(nearest.collisionCell);
    expect(argumentsSeen).toContain(nearest.collisionCell);
    expect(argumentsSeen).toContain(nearest.collisionBspTree);
    expect(argumentsSeen.some(argument => argument instanceof AbstractMesh)).toBe(false);
    expect(world.tileBspTree(tileId)).toBe(nearest.collisionBspTree);
    for (const loaded of [nearest, farthest]) {
      const [visual] = loaded.visualMeshes, [terrain] = loaded.terrainMeshes;
      expect(visual!.getLODLevels().map(level => ({ distance: level.distanceOrScreenCoverage, mesh: level.mesh }))).toEqual([{ distance: 10, mesh: null }]);
      expect((terrain as typeof visual)!.getLODLevels()).toEqual([]);
    }
    expect(scene.meshes).toContain(nearest.visualMeshes[0]);
    expect(scene.meshes).not.toContain(farthest.visualMeshes[0]);
  });

  it("resolves ready once every chunk of the initial collision ring is resident", async () => {
    const { residency, resolveLoad, world } = residencyHarness([0, 1, 2, 3], 5);
    let ready = false;
    void residency.ready().then(() => { ready = true; });
    await resolveLoad("90_90/chunk-0-0");
    await resolveLoad("90_90/chunk-1-0");
    expect(ready).toBe(false);
    await resolveLoad("90_90/chunk-2-0");
    expect(ready).toBe(true);
    expect(world.inspection().missingCellIds).toEqual([]);
  });

  it("aborts a load whose chunk leaves the collision ring, never adds it and disposes the late result", async () => {
    const { events, pending, renderFrame, resolveLoad, setFocusX, builtChunks } = residencyHarness([0, 1, 2], 5);
    const leaving = pending.get("90_90/chunk-2-0")!;
    setFocusX(-100);
    renderFrame();
    expect(leaving.signal.aborted).toBe(true);
    expect(events).toContain("removeCell:90_90/chunk-2-0");
    await resolveLoad("90_90/chunk-2-0");
    expect(events).not.toContain("addCell:90_90/chunk-2-0");
    expect(events).toContain("dispose:90_90/chunk-2-0");
    expect(builtChunks.get("90_90/chunk-2-0")!.visualMeshes[0]!.isDisposed()).toBe(true);
  });

  it("removes a chunk from the collision world before disposing it once it leaves the retain ring", async () => {
    const { events, residency, renderFrame, resolveAll, setFocusX, world } = residencyHarness([0, 1, 2, 3, 4, 5], 5);
    await resolveAll();
    setFocusX(55);
    renderFrame();
    await resolveAll();
    const removed = events.indexOf("removeCell:90_90/chunk-0-0"), disposed = events.indexOf("dispose:90_90/chunk-0-0");
    expect(removed).toBeGreaterThanOrEqual(0);
    expect(removed).toBeLessThan(disposed);
    expect(world.residentCells().map(cell => cell.cellId)).not.toContain("90_90/chunk-0-0");
    const inspection = residency.inspection();
    expect(inspection.disposedChunkCount).toBeGreaterThan(0);
    expect(inspection.loadedChunkCount + inspection.loadingChunkCount).toBeLessThanOrEqual(inspection.retainedChunkCount);
  });

  it("keeps a failed chunk required, lists its reason and never retries it", async () => {
    const { pending, residency, renderFrame, loadCalls, world, resolveAll } = residencyHarness([0, 1], 5);
    pending.get("90_90/chunk-1-0")!.reject(new Error("collision resource absent"));
    pending.delete("90_90/chunk-1-0");
    await flush();
    await resolveAll();
    renderFrame();
    expect(residency.inspection().failedChunks).toEqual([{ cellId: "90_90/chunk-1-0", reason: "collision resource absent" }]);
    expect(world.inspection().missingCellIds).toEqual(["90_90/chunk-1-0"]);
    expect(loadCalls.filter(cellId => cellId === "90_90/chunk-1-0")).toHaveLength(1);
  });

  it("makes no collision world call when rendered twice with the same focus and reports presentation settings", async () => {
    const { events, residency, renderFrame, resolveAll } = residencyHarness([0, 1, 2], 5);
    await resolveAll();
    renderFrame();
    const callsBefore = events.length;
    renderFrame();
    renderFrame();
    expect(events.length).toBe(callsBefore);
    expect(residency.inspection()).toMatchObject({
      settings: { ...settings, status: "presentation", source: "derived from the converted chunk edge" },
      levelOfDetail: { policy: "null-level-culling", derivatives: "lod-derivative-unplanned" },
      knownChunkCount: 3, visibleChunkCount: 2, requiredChunkCount: 3, retainedChunkCount: 3, loadedChunkCount: 3, loadingChunkCount: 0, failedChunks: [],
      focusCellIds: ["90_90/chunk-0-0"], retainedCellIds: ["90_90/chunk-0-0", "90_90/chunk-1-0", "90_90/chunk-2-0"],
      loadedCellIds: ["90_90/chunk-0-0", "90_90/chunk-1-0", "90_90/chunk-2-0"],
    });
  });

  it("shows a diagonal chunk once the focus walks within the visual ring inside the same chunk, without an explicit update", async () => {
    const chunks = [residencyChunk(0, 0), residencyChunk(1, 0), residencyChunk(0, 1), residencyChunk(1, 1)];
    const { residency, renderFrame, resolveAll, setFocus, scene, builtChunks } = residencyHarnessForChunks(chunks, { x: chunkEdgeMetres / 2, y: 0, z: 0 });
    await resolveAll();
    renderFrame();
    const diagonalVisual = builtChunks.get("90_90/chunk-1-1")!.visualMeshes[0]!;
    expect(scene.meshes).not.toContain(diagonalVisual);
    setFocus(chunkEdgeMetres / 2, chunkEdgeMetres - 0.1);
    renderFrame();
    expect(residency.inspection().focusCellIds).toEqual(["90_90/chunk-0-0"]);
    expect(scene.meshes).toContain(diagonalVisual);
    expect(residency.inspection().visibleChunkCount).toBe(4);
  });

  it("removes every cell and disposes every container on dispose", async () => {
    const { residency, resolveLoad, pending, world, events } = residencyHarness([0, 1, 2], 5);
    await resolveLoad("90_90/chunk-0-0");
    const stillLoading = pending.get("90_90/chunk-1-0")!;
    residency.dispose();
    expect(stillLoading.signal.aborted).toBe(true);
    expect(world.inspection()).toMatchObject({ requiredCellCount: 0, residentCellCount: 0 });
    expect(events).toContain("dispose:90_90/chunk-0-0");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { streamNativeTileChunks } from "../../src/scene/world/streamNativeTileChunks";
import { attachNativeTileSystems, type AttachedNativeTileSystems, type NativeTileChunkSystemContents } from "../../src/scene/world/attachNativeTileSystems";
import { createTileModelTemplates, type LoadedTileResidencyChunk, type TileModelTemplates } from "../../src/scene/world/loadResidencyChunk";
import {
  createNativeTileChunkResidency, type NativeTileChunkResidency, type NativeTileChunkResidencyOptions, type ResidencyChunk, type ResidencyChunkEventListener,
  type ResidentChunk,
} from "../../src/scene/world/nativeTileChunkResidency";
import { readCatalogTileIds, readResidencyTile, type ResidencyTile } from "../../src/scene/world/nativeTileResidencyTiles";
import type { CollisionCellContext } from "../../src/scene/world/movement/collisionCellContext";
import type { CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import type { NativeTileBspChunk } from "../../src/scene/world/loadNativeTileChunks";
import { residencyDrawLimitRules } from "../../src/scene/world/worldResidencyRing";

vi.mock("../../src/scene/world/nativeTileResidencyTiles", () => ({ readResidencyTile: vi.fn(), readCatalogTileIds: vi.fn() }));
vi.mock("../../src/scene/world/nativeTileChunkResidency", () => ({ createNativeTileChunkResidency: vi.fn() }));
vi.mock("../../src/scene/world/loadResidencyChunk", () => ({ createTileModelTemplates: vi.fn(), loadResidencyChunk: vi.fn(async () => ({})) }));
vi.mock("../../src/scene/world/attachNativeTileSystems", () => ({ attachNativeTileSystems: vi.fn() }));
vi.mock("../../src/scene/world/nativeTileSectionInspection", () => ({ inspectNativeTileSection: vi.fn(() => ({})) }));
vi.mock("../../src/scene/world/nativeTileChunkContents", () => ({
  authoredAnchorPosition: vi.fn(() => new Vector3(0, 2, 0)),
  anchorOnChunkTerrain: vi.fn(() => ({ chunk: { terrain: { sha256: "a".repeat(64) }, bytes: 64 }, surface: new Vector3(0, 0, 0) })),
  tileSpawnAnchor: vi.fn(() => ({ playerStart: "Fixture.PlayerStart0" })),
  describeTerrainChunks: vi.fn(() => []),
}));

const selectedTileId = "20_20", readableNeighbourTileId = "20_21", unreadableNeighbourTileId = "21_21";
const chunkEdgeSourceUnits = 4096;

function residencyChunk(tileId: string, chunkId: string): ResidencyChunk {
  return { tileId, chunkId, cellId: `${tileId}:${chunkId}`, footprint: { minimumX: 0, minimumZ: 0, maximumX: 1, maximumZ: 1 } };
}

function residencyTile(tileId: string, chunkIds: readonly string[]): ResidencyTile {
  const tile = { tileId, manifest: { tileId, anchor: { location: [0, 0, 0], playerStart: "Fixture.PlayerStart0" }, gaps: [], resources: [], chunks: [] },
    manifestSha256: "b".repeat(64), chunks: chunkIds.map(chunkId => ({ chunkId })), grid: { chunkEdgeSourceUnits },
    residencyChunks: chunkIds.map(chunkId => residencyChunk(tileId, chunkId)) };
  return tile as unknown as ResidencyTile;
}

interface RecordedTileSystems {
  readonly tileId: string;
  readonly added: string[];
  readonly removed: string[];
  readonly bound: Set<string>;
  readonly cullingSettings: boolean[];
  readonly dispose: Mock<() => void>;
}

describe("streamed native tile chunks", () => {
  let engine: NullEngine, scene: Scene;
  let residencyOptions: NativeTileChunkResidencyOptions<LoadedTileResidencyChunk> | null;
  let resident: ResidentChunk<LoadedTileResidencyChunk>[], chunkListeners: Set<ResidencyChunkEventListener<LoadedTileResidencyChunk>>;
  let residencyDispose: Mock<() => void>, addedChunks: ResidencyChunk[][];
  let templateDisposals: Map<string, Mock<() => void>>, recordedSystems: RecordedTileSystems[], tilesWhoseSystemsFail: Set<string>;
  const context: CollisionCellContext = { world: {} as CollisionWorld, focusPosition: () => null };

  function loadedChunk(chunk: ResidencyChunk): LoadedTileResidencyChunk {
    const terrainMesh = MeshBuilder.CreateBox(`terrain ${chunk.cellId}`, { size: 1 }, scene);
    const bspChunk: NativeTileBspChunk = { chunkId: chunk.chunkId, resource: `/l2/bsp/${chunk.cellId}`, sections: [], nodeRanges: [], meshes: [] };
    const loaded = { terrainMeshes: [terrainMesh], terrain: { meshes: [terrainMesh] }, bspChunk, instances: [] };
    return loaded as unknown as LoadedTileResidencyChunk;
  }

  function becomeResident(chunk: ResidencyChunk) {
    const entry = { chunk, loaded: loadedChunk(chunk) };
    resident.push(entry);
    for (const listener of [...chunkListeners]) listener.chunkLoaded(entry);
  }

  function leaveResidency(cellId: string) {
    const entry = resident.find(candidate => candidate.chunk.cellId === cellId)!;
    resident = resident.filter(candidate => candidate !== entry);
    for (const listener of [...chunkListeners]) listener.chunkDisposed(entry);
  }

  const systemsOf = (tileId: string) => recordedSystems.filter(systems => systems.tileId === tileId);

  beforeEach(() => {
    engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true;
    residencyOptions = null; resident = []; chunkListeners = new Set(); addedChunks = []; residencyDispose = vi.fn<() => void>(); templateDisposals = new Map();
    recordedSystems = []; tilesWhoseSystemsFail = new Set();
    vi.mocked(readCatalogTileIds).mockResolvedValue(new Set([selectedTileId, readableNeighbourTileId, unreadableNeighbourTileId]));
    vi.mocked(readResidencyTile).mockImplementation(async tileId => {
      if (tileId === unreadableNeighbourTileId) throw new Error(`Native tile ${tileId} pins no native-tile-collision resource.`);
      if (tileId === selectedTileId) return residencyTile(tileId, ["chunk-0-0", "chunk-3-0"]);
      if (tileId === readableNeighbourTileId) return residencyTile(tileId, ["chunk-0-0"]);
      return null;
    });
    vi.mocked(createNativeTileChunkResidency).mockImplementation(options => {
      residencyOptions = options as unknown as NativeTileChunkResidencyOptions<LoadedTileResidencyChunk>;
      const residency: NativeTileChunkResidency<LoadedTileResidencyChunk> = {
        ready: async () => {},
        subscribeChunkEvents: listener => { chunkListeners.add(listener); return () => { chunkListeners.delete(listener); }; },
        addChunks: chunks => { addedChunks.push([...chunks]); },
        residentChunks: () => [...resident],
        inspection: () => ({ loadedChunkCount: resident.length }) as unknown as ReturnType<NativeTileChunkResidency<LoadedTileResidencyChunk>["inspection"]>,
        dispose: residencyDispose,
      };
      return residency as unknown as ReturnType<typeof createNativeTileChunkResidency>;
    });
    vi.mocked(createTileModelTemplates).mockImplementation(() => {
      const dispose = vi.fn<() => void>();
      const templates: TileModelTemplates = { template: async () => { throw new Error("no templates in this test"); }, loadedCount: 0, dispose };
      templateDisposals.set(`templates ${templateDisposals.size}`, dispose);
      return templates;
    });
    vi.mocked(attachNativeTileSystems).mockImplementation(async (_scene, manifest, { initialChunks }) => {
      if (tilesWhoseSystemsFail.has(manifest.tileId)) throw new Error(`Native tile ${manifest.tileId} lighting payload refused.`);
      const recorded: RecordedTileSystems = { tileId: manifest.tileId, added: [], removed: [], bound: new Set(initialChunks.map(chunk => chunk.chunkId)),
        cullingSettings: [], dispose: vi.fn<() => void>() };
      recordedSystems.push(recorded);
      const binding = { frame: () => null, setCulling: (enabled: boolean) => { recorded.cullingSettings.push(enabled); } };
      return {
        visibility: { binding, inspection: () => ({ gap: null, culling: recorded.cullingSettings.at(-1) ?? false, targetChunkIds: [...recorded.bound].sort(), unmappedChunks: [] }) },
        lighting: { environmentClock: null, inspection: () => ({ gap: null, sectionCount: recorded.bound.size,
          sections: [...recorded.bound].map(chunkId => ({ chunkId, lighting: "lightmapped" })) }) },
        movers: null, moverGap: null, mapEmitterPlacements: { gap: null, inspection: () => [] },
        addChunk: async (contents: NativeTileChunkSystemContents) => { recorded.added.push(contents.chunkId); recorded.bound.add(contents.chunkId); },
        removeChunk: (chunkId: string) => { recorded.removed.push(chunkId); recorded.bound.delete(chunkId); },
        boundChunkIds: () => [...recorded.bound].sort(),
        dispose: recorded.dispose,
      } as unknown as AttachedNativeTileSystems;
    });
  });

  afterEach(() => { scene.dispose(); engine.dispose(); vi.clearAllMocks(); });

  async function streamWithStartupChunks(startupChunks: readonly ResidencyChunk[]) {
    const residencyFactory = vi.mocked(createNativeTileChunkResidency).getMockImplementation()!;
    vi.mocked(createNativeTileChunkResidency).mockImplementationOnce(options => {
      const residency = residencyFactory(options);
      queueMicrotask(() => { for (const chunk of startupChunks) becomeResident(chunk); });
      return residency;
    });
    return (await streamNativeTileChunks(scene, new AbortController().signal, selectedTileId, context))!;
  }

  it("attaches the selected tile's systems with its startup chunks and a startup neighbour chunk to its own tile's systems", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0"), residencyChunk(readableNeighbourTileId, "chunk-0-0")]);
    await vi.waitFor(() => expect(systemsOf(readableNeighbourTileId)[0]?.added).toEqual(["chunk-0-0"]));
    const selectedCall = vi.mocked(attachNativeTileSystems).mock.calls.find(([, manifest]) => manifest.tileId === selectedTileId)!;
    expect(selectedCall[2].initialChunks.map(contents => contents.chunkId)).toEqual(["chunk-0-0"]);
    expect([...systemsOf(selectedTileId)[0]!.bound]).toEqual(["chunk-0-0"]);
    expect(residencyOptions!.chunks.map(chunk => chunk.cellId)).toEqual([
      `${selectedTileId}:chunk-0-0`, `${selectedTileId}:chunk-3-0`, `${readableNeighbourTileId}:chunk-0-0`]);
    const neighbourCall = vi.mocked(attachNativeTileSystems).mock.calls.find(([, manifest]) => manifest.tileId === readableNeighbourTileId)!;
    for (const call of [selectedCall, neighbourCall]) expect(call[2].drawLimitRules).toEqual(residencyDrawLimitRules(residencyOptions!.settings));
    section.dispose();
  });

  it("binds a selected-tile chunk that loads after startup, unbinds it when it is disposed and binds it again when it reloads", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    const [selectedSystems] = systemsOf(selectedTileId);
    becomeResident(residencyChunk(selectedTileId, "chunk-3-0"));
    await Promise.resolve();
    expect(selectedSystems!.added).toEqual(["chunk-3-0"]);
    expect(section.inspection().streamedTiles!.find(tile => tile.tileId === selectedTileId)!.systems).toMatchObject({ attached: true,
      residentChunkIds: ["chunk-0-0", "chunk-3-0"], boundChunkIds: ["chunk-0-0", "chunk-3-0"], chunkFailures: [],
      visibility: { gap: null, targetChunkIds: ["chunk-0-0", "chunk-3-0"] }, lighting: { gap: null, lightmappedChunkIds: ["chunk-0-0", "chunk-3-0"] } });
    leaveResidency(`${selectedTileId}:chunk-3-0`);
    expect(selectedSystems!.removed).toEqual(["chunk-3-0"]);
    expect([...selectedSystems!.bound]).toEqual(["chunk-0-0"]);
    becomeResident(residencyChunk(selectedTileId, "chunk-3-0"));
    await Promise.resolve();
    expect(selectedSystems!.added).toEqual(["chunk-3-0", "chunk-3-0"]);
    expect([...selectedSystems!.bound].sort()).toEqual(["chunk-0-0", "chunk-3-0"]);
    section.dispose();
  });

  it("gives a neighbour tile its own systems on its first resident chunk and releases them on its last disposed chunk", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    expect(systemsOf(readableNeighbourTileId)).toEqual([]);
    becomeResident(residencyChunk(readableNeighbourTileId, "chunk-0-0"));
    await vi.waitFor(() => expect(systemsOf(readableNeighbourTileId)[0]?.added).toEqual(["chunk-0-0"]));
    const neighbourCall = vi.mocked(attachNativeTileSystems).mock.calls.find(([, manifest]) => manifest.tileId === readableNeighbourTileId)!;
    expect(neighbourCall[2].initialChunks).toEqual([]);
    expect(section.inspection().streamedTiles!.find(tile => tile.tileId === readableNeighbourTileId)!.systems)
      .toMatchObject({ attached: true, boundChunkIds: ["chunk-0-0"], lighting: { lightmappedChunkIds: ["chunk-0-0"] } });
    leaveResidency(`${readableNeighbourTileId}:chunk-0-0`);
    expect(systemsOf(readableNeighbourTileId)[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(section.inspection().streamedTiles!.find(tile => tile.tileId === readableNeighbourTileId)!.systems).toBeNull();
    becomeResident(residencyChunk(readableNeighbourTileId, "chunk-0-0"));
    await vi.waitFor(() => expect(systemsOf(readableNeighbourTileId)).toHaveLength(2));
    section.dispose();
    expect(systemsOf(readableNeighbourTileId)[1]!.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected tile's systems after its last chunk leaves, since the section hands them to its callers", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    leaveResidency(`${selectedTileId}:chunk-0-0`);
    const [selectedSystems] = systemsOf(selectedTileId);
    expect(selectedSystems!.removed).toEqual(["chunk-0-0"]);
    expect(selectedSystems!.dispose).not.toHaveBeenCalled();
    expect(section.inspection().streamedTiles!.find(tile => tile.tileId === selectedTileId)!.systems).toMatchObject({ attached: true, boundChunkIds: [] });
    section.dispose();
  });

  it("switches culling on every streamed tile's visibility, including a tile attached after the switch", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    section.tileVisibility!.setCulling(true);
    becomeResident(residencyChunk(readableNeighbourTileId, "chunk-0-0"));
    await vi.waitFor(() => expect(systemsOf(readableNeighbourTileId)).toHaveLength(1));
    expect(systemsOf(selectedTileId)[0]!.cullingSettings).toEqual([false, true]);
    expect(systemsOf(readableNeighbourTileId)[0]!.cullingSettings).toEqual([true]);
    section.tileVisibility!.setCulling(false);
    expect(systemsOf(readableNeighbourTileId)[0]!.cullingSettings).toEqual([true, false]);
    section.dispose();
  });

  it("lists a neighbour tile whose systems cannot attach as a systems gap and keeps the section", async () => {
    tilesWhoseSystemsFail.add(readableNeighbourTileId);
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    becomeResident(residencyChunk(readableNeighbourTileId, "chunk-0-0"));
    const neighbourSystems = () => section.inspection().streamedTiles!.find(tile => tile.tileId === readableNeighbourTileId)!.systems;
    await vi.waitFor(() => expect(neighbourSystems()?.gap).toBe(`Native tile ${readableNeighbourTileId} lighting payload refused.`));
    expect(neighbourSystems()).toMatchObject({ attached: false, residentChunkIds: ["chunk-0-0"], boundChunkIds: [], visibility: null, lighting: null });
    section.dispose();
  });

  it("keeps the section and lists an unreadable neighbour tile as a streamed tile gap", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    expect(section.inspection().streamedTiles!.map(({ tileId, chunkCount, gap }) => ({ tileId, chunkCount, gap }))).toEqual([
      { tileId: selectedTileId, chunkCount: 2, gap: null },
      { tileId: readableNeighbourTileId, chunkCount: 1, gap: null },
      { tileId: unreadableNeighbourTileId, chunkCount: 0, gap: `Native tile ${unreadableNeighbourTileId} pins no native-tile-collision resource.` },
    ]);
    section.dispose();
  });

  it("adds the catalog neighbours of a newly focused tile once and reads each tile once", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    residencyOptions!.onFocusChunks!([residencyChunk(selectedTileId, "chunk-0-0")]);
    residencyOptions!.onFocusChunks!([residencyChunk(readableNeighbourTileId, "chunk-0-0")]);
    residencyOptions!.onFocusChunks!([residencyChunk(readableNeighbourTileId, "chunk-0-0")]);
    await vi.waitFor(() => expect(addedChunks).toHaveLength(1));
    for (let flush = 0; flush < 5; flush += 1) await Promise.resolve();
    expect(addedChunks).toHaveLength(1);
    expect(addedChunks[0]!.map(chunk => chunk.cellId)).toEqual([`${selectedTileId}:chunk-0-0`, `${selectedTileId}:chunk-3-0`]);
    expect(vi.mocked(readResidencyTile).mock.calls.map(([tileId]) => tileId).sort()).toEqual([selectedTileId, readableNeighbourTileId, unreadableNeighbourTileId]);
    expect(section.inspection().streamedTiles!.find(tile => tile.tileId === unreadableNeighbourTileId)!.gap).toMatch(/pins no native-tile-collision/);
    section.dispose();
  });

  it("releases the systems, the residency and the model templates of every tile on dispose and stops hearing chunk events", async () => {
    const section = await streamWithStartupChunks([residencyChunk(selectedTileId, "chunk-0-0")]);
    const loadSignal = new AbortController().signal;
    await residencyOptions!.loadChunk(residencyChunk(selectedTileId, "chunk-3-0"), loadSignal);
    await residencyOptions!.loadChunk(residencyChunk(readableNeighbourTileId, "chunk-0-0"), loadSignal);
    expect(templateDisposals.size).toBe(2);
    section.dispose();
    section.dispose();
    for (const systems of recordedSystems) expect(systems.dispose).toHaveBeenCalledTimes(1);
    expect(residencyDispose).toHaveBeenCalledTimes(1);
    expect(chunkListeners.size).toBe(0);
    for (const dispose of templateDisposals.values()) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("returns null and creates no residency when the selected tile is not in the catalog", async () => {
    vi.mocked(readResidencyTile).mockResolvedValue(null);
    expect(await streamNativeTileChunks(scene, new AbortController().signal, selectedTileId, context)).toBeNull();
    expect(createNativeTileChunkResidency).not.toHaveBeenCalled();
  });
});

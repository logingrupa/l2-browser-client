import type { Scene } from "@babylonjs/core/scene";
import { sourceDistanceToWorld } from "../../world/sourceFrame";
import { attachNativeTileSystems, type AttachedNativeTileSystems } from "./attachNativeTileSystems";
import { nativeMeshBounds, type NativeSection, type NativeWorldSceneInspection } from "./loadNativeSection";
import type { NativeTileSectionView } from "./loadNativeTileChunks";
import { createTileModelTemplates, loadResidencyChunk, type LoadedTileResidencyChunk, type TileModelTemplates } from "./loadResidencyChunk";
import type { CollisionCellContext } from "./movement/collisionCellContext";
import { anchorOnChunkTerrain, authoredAnchorPosition, describeTerrainChunks, tileSpawnAnchor } from "./nativeTileChunkContents";
import { createNativeTileChunkResidency, type NativeTileChunkResidency, type ResidencyChunk, type ResidentChunk } from "./nativeTileChunkResidency";
import { describeNativeTileGapRow } from "./nativeTileChunkManifest";
import { readCatalogTileIds, readResidencyTile, type ResidencyTile } from "./nativeTileResidencyTiles";
import { inspectNativeTileSection } from "./nativeTileSectionInspection";
import { neighbouringTileIds, worldResidencySettingsForChunkEdge } from "./worldResidencyRing";

export interface StreamedTileInspection {
  readonly tileId: string;
  readonly chunkCount: number;
  readonly gap: string | null;
}

const disposedDuringLoading = () => new Error("Native tile was disposed during loading.");
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error);

function residentMeshes(resident: readonly ResidentChunk<LoadedTileResidencyChunk>[]) {
  return resident.flatMap(({ loaded }) => [...loaded.terrainMeshes, ...(loaded.bspChunk?.meshes ?? []), ...loaded.instances.flatMap(instance => instance.root.getChildMeshes())]);
}

export async function streamNativeTileChunks(scene: Scene, signal: AbortSignal, tileId: string, context: CollisionCellContext): Promise<NativeSection | null> {
  const lifetime = new AbortController();
  const tileReads = new Map<string, Promise<ResidencyTile | null>>(), tiles = new Map<string, ResidencyTile>(), tileGaps = new Map<string, string>();
  const templatesByTile = new Map<string, TileModelTemplates>(), tilesWithKnownNeighbours = new Set<string>();
  let residency: NativeTileChunkResidency<LoadedTileResidencyChunk> | null = null, systems: AttachedNativeTileSystems | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(observer);
    systems?.dispose();
    residency?.dispose();
    for (const templates of templatesByTile.values()) templates.dispose();
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  const templatesFor = (tileIdOfChunk: string) => {
    let templates = templatesByTile.get(tileIdOfChunk);
    if (templates === undefined) { templates = createTileModelTemplates(scene, lifetime.signal); templatesByTile.set(tileIdOfChunk, templates); }
    return templates;
  };
  const readTileOnce = (residencyTileId: string) => {
    let read = tileReads.get(residencyTileId);
    if (read === undefined) {
      read = readResidencyTile(residencyTileId, lifetime.signal).then(tile => { if (tile !== null) tiles.set(residencyTileId, tile); return tile; });
      tileReads.set(residencyTileId, read);
    }
    return read;
  };
  try {
    const selected = await readTileOnce(tileId);
    if (selected === null) { dispose(); return null; }
    const catalogTileIds = await readCatalogTileIds(lifetime.signal);
    const chunksOfNeighbours = async (centreTileId: string): Promise<ResidencyChunk[]> => {
      if (tilesWithKnownNeighbours.has(centreTileId)) return [];
      tilesWithKnownNeighbours.add(centreTileId);
      const neighbourIds = neighbouringTileIds(centreTileId).filter(neighbourId => catalogTileIds.has(neighbourId));
      const reads = await Promise.all(neighbourIds.map(async neighbourId => {
        try { return await readTileOnce(neighbourId); }
        catch (error) {
          lifetime.signal.throwIfAborted();
          tileGaps.set(neighbourId, failureText(error));
          return null;
        }
      }));
      return reads.flatMap(tile => tile?.residencyChunks ?? []);
    };
    const initialNeighbourChunks = await chunksOfNeighbours(tileId);
    const authoredAnchor = authoredAnchorPosition(selected.manifest);
    const activeResidency = createNativeTileChunkResidency<LoadedTileResidencyChunk>({
      scene, collisionWorld: context.world, settings: worldResidencySettingsForChunkEdge(sourceDistanceToWorld(selected.grid.chunkEdgeSourceUnits)),
      chunks: [...selected.residencyChunks, ...initialNeighbourChunks], initialFocus: { x: authoredAnchor.x, y: authoredAnchor.y, z: authoredAnchor.z },
      focusPosition: () => context.focusPosition(),
      loadChunk: (chunk, chunkSignal) => loadResidencyChunk(scene, tiles.get(chunk.tileId)!, templatesFor(chunk.tileId), chunk, chunkSignal),
      onFocusChunks: focusChunks => {
        for (const focusTileId of new Set(focusChunks.map(chunk => chunk.tileId))) {
          chunksOfNeighbours(focusTileId).then(chunks => { if (!disposed && chunks.length > 0) activeResidency.addChunks(chunks); },
            (error: unknown) => { if (!disposed) tileGaps.set(focusTileId, failureText(error)); });
        }
      },
    });
    residency = activeResidency;
    await activeResidency.ready();
    if (disposed || scene.isDisposed) throw disposedDuringLoading();
    const startupResident = activeResidency.residentChunks();
    const selectedResident = startupResident.filter(({ chunk }) => chunk.tileId === tileId);
    const terrainEntries = selectedResident.flatMap(({ loaded }) => loaded.terrain === null ? [] : [loaded.terrain]);
    const { chunk: anchorChunk, surface: spawnCandidate } = anchorOnChunkTerrain(terrainEntries, authoredAnchor);
    const anchor = tileSpawnAnchor(selected.manifest, authoredAnchor, spawnCandidate);
    const bspChunks = selectedResident.flatMap(({ loaded }) => loaded.bspChunk === null ? [] : [loaded.bspChunk]);
    const instances = selectedResident.flatMap(({ loaded }) => loaded.instances);
    const terrainMeshes = terrainEntries.flatMap(entry => entry.meshes);
    const attached = await attachNativeTileSystems(scene, selected.manifest, { bspChunks, instances, terrainMeshes }, lifetime.signal, () => disposed || scene.isDisposed);
    systems = attached;
    const view: NativeTileSectionView = { kind: "native-tile-runtime", tileId, terrainChunks: describeTerrainChunks(selected.chunks), bspChunks, anchor, models: [], placements: [],
      terrain: { file: "terrain.glb", sha256: anchorChunk.terrain.sha256, bytes: anchorChunk.bytes, materialStatus: "neutral-inspection" },
      gaps: selected.manifest.gaps.filter(row => row.status !== "pass").map(describeNativeTileGapRow) };
    const startupExtent = nativeMeshBounds(startupResident.flatMap(({ loaded }) => loaded.terrainMeshes));
    const residentTerrainExtent = () => {
      const residentTerrain = activeResidency.residentChunks().flatMap(({ loaded }) => loaded.terrainMeshes);
      return residentTerrain.length === 0 ? startupExtent : nativeMeshBounds(residentTerrain);
    };
    const streamedTiles = (): StreamedTileInspection[] => [...new Set([...tiles.keys(), ...tileGaps.keys()])].sort()
      .map(streamedTileId => ({ tileId: streamedTileId, chunkCount: tiles.get(streamedTileId)?.chunks.length ?? 0, gap: tileGaps.get(streamedTileId) ?? null }));
    const inspection = (): NativeWorldSceneInspection => {
      const resident = activeResidency.residentChunks(), selectedNow = resident.filter(({ chunk }) => chunk.tileId === tileId);
      const residencyInspection = activeResidency.inspection();
      return {
        ...inspectNativeTileSection({ tileId, chunks: selected.chunks, terrainMeshes: selectedNow.flatMap(({ loaded }) => loaded.terrainMeshes),
          instances: selectedNow.flatMap(({ loaded }) => loaded.instances), bspChunks: selectedNow.flatMap(({ loaded }) => loaded.bspChunk === null ? [] : [loaded.bspChunk]),
          modelCount: templatesFor(tileId).loadedCount, disposed, anchor, systems: attached, loadedChunkCount: residencyInspection.loadedChunkCount,
          countedMeshes: residentMeshes(resident) }),
        residency: residencyInspection, streamedTiles: streamedTiles(),
      };
    };
    lifetime.signal.throwIfAborted();
    return { manifest: view, manifestSha256: selected.manifestSha256, terrainMeshes: [], supportMeshes: [], spawnCandidate,
      get minimum() { return residentTerrainExtent().minimum; }, get maximum() { return residentTerrainExtent().maximum; },
      moverTargets: attached.movers?.targets ?? [], tileVisibility: attached.visibility.binding, environmentClock: attached.lighting.environmentClock,
      inspection, setTerrainPreview() {}, dispose };
  } catch (error) { dispose(); throw error; }
}

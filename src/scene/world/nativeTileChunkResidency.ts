import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { worldPositionToSource, type WorldPosition } from "../../world/sourceFrame";
import type { CollisionBspTree, CollisionCell } from "./movement/core/collisionCell";
import type { CollisionCellFootprint, CollisionWorld } from "./movement/core/collisionWorld";
import {
  footprintDistanceMetres, planWorldResidency, validateWorldResidencySettings, type WorldResidencyFootprint, type WorldResidencyPlan,
  type WorldResidencySettings,
} from "./worldResidencyRing";

export interface ResidencyChunk {
  readonly tileId: string;
  readonly chunkId: string;
  readonly cellId: string;
  readonly footprint: WorldResidencyFootprint;
}

export type ResidencyChunkContainer = Pick<AssetContainer, "addAllToScene" | "removeAllFromScene" | "dispose">;

export interface LoadedResidencyChunk {
  readonly container: ResidencyChunkContainer;
  readonly terrainMeshes: readonly AbstractMesh[];
  readonly visualMeshes: readonly Mesh[];
  readonly collisionCell: CollisionCell;
  readonly collisionBspTree: CollisionBspTree;
}

export interface ResidentChunk<Loaded extends LoadedResidencyChunk> {
  readonly chunk: ResidencyChunk;
  readonly loaded: Loaded;
}

export interface FailedResidencyChunk {
  readonly cellId: string;
  readonly reason: string;
}

export interface NativeTileChunkResidencyInspection {
  readonly settings: WorldResidencySettings & { readonly status: "presentation"; readonly source: "derived from the converted chunk edge" };
  readonly levelOfDetail: { readonly policy: "null-level-culling"; readonly derivatives: "lod-derivative-unplanned" };
  readonly knownChunkCount: number;
  readonly visibleChunkCount: number;
  readonly requiredChunkCount: number;
  readonly retainedChunkCount: number;
  readonly loadedChunkCount: number;
  readonly loadingChunkCount: number;
  readonly disposedChunkCount: number;
  readonly focusCellIds: readonly string[];
  readonly retainedCellIds: readonly string[];
  readonly loadedCellIds: readonly string[];
  readonly failedChunks: readonly FailedResidencyChunk[];
}

export interface NativeTileChunkResidencyOptions<Loaded extends LoadedResidencyChunk> {
  readonly scene: Scene;
  readonly collisionWorld: CollisionWorld;
  readonly settings: WorldResidencySettings;
  readonly chunks: readonly ResidencyChunk[];
  readonly initialFocus: WorldPosition;
  focusPosition(): WorldPosition | null;
  loadChunk(chunk: ResidencyChunk, signal: AbortSignal): Promise<Loaded>;
  onFocusChunks?(chunks: readonly ResidencyChunk[]): void;
}

export interface NativeTileChunkResidency<Loaded extends LoadedResidencyChunk> {
  update(): void;
  ready(): Promise<void>;
  addChunks(chunks: readonly ResidencyChunk[]): void;
  residentChunks(): readonly ResidentChunk<Loaded>[];
  inspection(): NativeTileChunkResidencyInspection;
  dispose(): void;
}

type ChunkState<Loaded> =
  | { readonly kind: "loading"; readonly abort: AbortController }
  | { readonly kind: "loaded"; readonly loaded: Loaded; visible: boolean }
  | { readonly kind: "failed"; readonly reason: string };

const maximumLoadsInFlight = 3;
const residencySettingsSource = "derived from the converted chunk edge";
const compareCellIds = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const emptyPlan: WorldResidencyPlan = { visibleCellIds: [], requiredCellIds: [], retainedCellIds: [], loadOrder: [] };

function sourceFootprint(footprint: WorldResidencyFootprint): CollisionCellFootprint {
  const minimum = worldPositionToSource({ x: footprint.minimumX, y: 0, z: footprint.minimumZ });
  const maximum = worldPositionToSource({ x: footprint.maximumX, y: 0, z: footprint.maximumZ });
  return { minimumX: minimum.x, minimumY: minimum.y, maximumX: maximum.x, maximumY: maximum.y };
}

const failureReason = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createNativeTileChunkResidency<Loaded extends LoadedResidencyChunk>(options: NativeTileChunkResidencyOptions<Loaded>): NativeTileChunkResidency<Loaded> {
  const { scene, collisionWorld } = options;
  const settings = validateWorldResidencySettings(options.settings);
  const chunksByCellId = new Map<string, ResidencyChunk>();
  const statesByCellId = new Map<string, ChunkState<Loaded>>();
  const requiredInWorld = new Set<string>();
  let plan = emptyPlan, disposedChunkCount = 0, disposed = false, focusKey: string | null = null;
  let initialRingCellIds: readonly string[] | null = null;
  const readyWaiters: (() => void)[] = [];

  const addKnownChunks = (chunks: readonly ResidencyChunk[]) => {
    for (const chunk of chunks) if (!chunksByCellId.has(chunk.cellId)) chunksByCellId.set(chunk.cellId, chunk);
  };
  const focusPoint = () => options.focusPosition() ?? options.initialFocus;
  const chunksHoldingFocus = (focus: WorldPosition) =>
    [...chunksByCellId.values()].filter(chunk => footprintDistanceMetres(focus, chunk.footprint) === 0).sort((left, right) => compareCellIds(left.cellId, right.cellId));

  const releaseRequirement = (cellId: string) => {
    if (!requiredInWorld.delete(cellId)) return;
    collisionWorld.removeCell(cellId);
  };
  const disposeLoaded = (cellId: string, loaded: Loaded) => {
    releaseRequirement(cellId);
    loaded.container.dispose();
    statesByCellId.delete(cellId);
    disposedChunkCount += 1;
  };
  const showLoaded = (state: Extract<ChunkState<Loaded>, { kind: "loaded" }>, visible: boolean) => {
    if (state.visible === visible) return;
    if (visible) state.loaded.container.addAllToScene(); else state.loaded.container.removeAllFromScene();
    state.visible = visible;
  };
  const resolveReadyWhenInitialRingSettled = () => {
    if (initialRingCellIds === null || readyWaiters.length === 0) return;
    if (!initialRingCellIds.every(cellId => { const kind = statesByCellId.get(cellId)?.kind; return kind === "loaded" || kind === "failed"; })) return;
    for (const resolve of readyWaiters.splice(0)) resolve();
  };

  const settleLoad = (chunk: ResidencyChunk, abort: AbortController, outcome: { loaded: Loaded } | { error: unknown }) => {
    const state = statesByCellId.get(chunk.cellId);
    const current = !disposed && state?.kind === "loading" && state.abort === abort;
    if (!current) {
      if ("loaded" in outcome) outcome.loaded.container.dispose();
      return;
    }
    if ("error" in outcome) {
      statesByCellId.set(chunk.cellId, { kind: "failed", reason: failureReason(outcome.error) });
    } else {
      const { loaded } = outcome;
      try {
        collisionWorld.addCell(chunk.cellId, loaded.collisionCell);
        if (collisionWorld.tileBspTree(chunk.tileId) === null) collisionWorld.setTileBspTree(chunk.tileId, loaded.collisionBspTree);
      } catch (error) {
        loaded.container.dispose();
        statesByCellId.set(chunk.cellId, { kind: "failed", reason: failureReason(error) });
        replan();
        return;
      }
      for (const mesh of loaded.visualMeshes) mesh.addLODLevel(settings.lodCullDistanceMetres, null);
      const loadedState: Extract<ChunkState<Loaded>, { kind: "loaded" }> = { kind: "loaded", loaded, visible: false };
      statesByCellId.set(chunk.cellId, loadedState);
    }
    replan();
  };

  const startLoad = (chunk: ResidencyChunk) => {
    const abort = new AbortController();
    statesByCellId.set(chunk.cellId, { kind: "loading", abort });
    options.loadChunk(chunk, abort.signal).then(loaded => settleLoad(chunk, abort, { loaded }), (error: unknown) => settleLoad(chunk, abort, { error }));
  };

  function replan(): void {
    if (disposed) return;
    plan = planWorldResidency([...chunksByCellId.values()], focusPoint(), settings);
    initialRingCellIds ??= plan.requiredCellIds;
    const required = new Set(plan.requiredCellIds), retained = new Set(plan.retainedCellIds), visible = new Set(plan.visibleCellIds);
    for (const cellId of plan.requiredCellIds) {
      if (requiredInWorld.has(cellId)) continue;
      collisionWorld.requireCell(cellId, sourceFootprint(chunksByCellId.get(cellId)!.footprint));
      requiredInWorld.add(cellId);
    }
    for (const [cellId, state] of [...statesByCellId]) {
      if (state.kind === "loading" && !required.has(cellId)) {
        state.abort.abort();
        statesByCellId.delete(cellId);
        releaseRequirement(cellId);
      } else if (state.kind === "loaded" && !retained.has(cellId)) {
        disposeLoaded(cellId, state.loaded);
      } else if (state.kind === "loaded") {
        showLoaded(state, visible.has(cellId));
      } else if (state.kind === "failed" && !retained.has(cellId)) {
        releaseRequirement(cellId);
      }
    }
    for (const cellId of [...requiredInWorld]) {
      if (!retained.has(cellId) || (!required.has(cellId) && statesByCellId.get(cellId)?.kind !== "loaded" && statesByCellId.get(cellId)?.kind !== "failed")) releaseRequirement(cellId);
    }
    let loadsInFlight = [...statesByCellId.values()].filter(state => state.kind === "loading").length;
    for (const cellId of plan.loadOrder) {
      if (loadsInFlight >= maximumLoadsInFlight) break;
      if (statesByCellId.has(cellId)) continue;
      startLoad(chunksByCellId.get(cellId)!);
      loadsInFlight += 1;
    }
    resolveReadyWhenInitialRingSettled();
  }

  const observer = scene.onBeforeRenderObservable.add(() => {
    const holding = chunksHoldingFocus(focusPoint());
    const nextFocusKey = holding.map(chunk => chunk.cellId).join("|");
    if (nextFocusKey === focusKey) return;
    focusKey = nextFocusKey;
    options.onFocusChunks?.(holding);
    replan();
  });

  addKnownChunks(options.chunks);
  replan();

  return {
    update: replan,
    ready() {
      return new Promise<void>(resolve => { readyWaiters.push(resolve); resolveReadyWhenInitialRingSettled(); });
    },
    addChunks(chunks) {
      addKnownChunks(chunks);
      replan();
    },
    residentChunks() {
      return [...statesByCellId].filter((entry): entry is [string, Extract<ChunkState<Loaded>, { kind: "loaded" }>] => entry[1].kind === "loaded")
        .sort(([left], [right]) => compareCellIds(left, right)).map(([cellId, state]) => ({ chunk: chunksByCellId.get(cellId)!, loaded: state.loaded }));
    },
    inspection() {
      const states = [...statesByCellId];
      const loadedCellIds = states.filter(([, state]) => state.kind === "loaded").map(([cellId]) => cellId).sort(compareCellIds);
      return {
        settings: { ...settings, status: "presentation", source: residencySettingsSource },
        levelOfDetail: { policy: "null-level-culling", derivatives: "lod-derivative-unplanned" },
        knownChunkCount: chunksByCellId.size,
        visibleChunkCount: states.filter(([, state]) => state.kind === "loaded" && state.visible).length,
        requiredChunkCount: plan.requiredCellIds.length, retainedChunkCount: plan.retainedCellIds.length,
        loadedChunkCount: loadedCellIds.length, loadingChunkCount: states.filter(([, state]) => state.kind === "loading").length,
        disposedChunkCount, focusCellIds: chunksHoldingFocus(focusPoint()).map(chunk => chunk.cellId), retainedCellIds: plan.retainedCellIds, loadedCellIds,
        failedChunks: states.flatMap(([cellId, state]) => state.kind === "failed" ? [{ cellId, reason: state.reason }] : [])
          .sort((left, right) => compareCellIds(left.cellId, right.cellId)),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(observer);
      for (const [cellId, state] of [...statesByCellId]) {
        if (state.kind === "loading") state.abort.abort();
        if (state.kind === "loaded") disposeLoaded(cellId, state.loaded);
      }
      statesByCellId.clear();
      for (const cellId of [...requiredInWorld]) releaseRequirement(cellId);
      for (const resolve of readyWaiters.splice(0)) resolve();
    },
  };
}

import { resolve } from "node:path";
import type { MovementWalkTrace } from "../../../src/scene/world/movement/movementPresenter";
import type { NativeTileSpawnAnchor } from "../../../src/scene/world/loadNativeTileChunks";
import type { CollisionLoadStatus } from "../../../src/runtime/worldMovementWiring";
import type { LoadCheckStatus } from "./loadCheckRecordFile";

export interface ObservedTileWalk {
  readonly worldLoaded: boolean;
  readonly collisionStatus: CollisionLoadStatus | null;
  readonly collisionFailure: string | null;
  readonly missingCellIds: readonly string[];
  readonly sourceSpawn: readonly number[] | null;
  readonly tileAnchor: NativeTileSpawnAnchor | null;
  readonly pawn: MovementWalkTrace | null;
}

export type TileWalkFailureClass =
  | "tile-did-not-start" | "no-world-section" | "bsp-mesh-count" | "collision-not-resident"
  | "held-collision-not-ready" | "held-collision-cell-absent" | "held-speed-unresolved" | "cannot-move"
  | "below-terrain-minimum" | "ended-without-floor" | "walk-did-not-settle" | "other";

export interface TileWalkTrace extends ObservedTileWalk {
  readonly failureClass: TileWalkFailureClass;
}

export interface TileWalkFailure {
  readonly reason: string;
  readonly walkTrace: TileWalkTrace;
}

export interface TileWalkOutcome {
  readonly walkViewportCount: number;
  passedViewportCount: number;
  firstFailure: TileWalkFailure | null;
}

export interface StartChunkBsp {
  readonly chunkId: string;
  readonly bsp: { readonly resource: string } | null;
}

export interface LoadedSectionBsp {
  readonly bspMeshes: number;
  readonly bspResources: readonly string[];
}

export type SettledTileWalk =
  | { readonly status: Extract<LoadCheckStatus, "pass">; readonly reason: null }
  | { readonly status: Extract<LoadCheckStatus, "failed">; readonly reason: string; readonly walkTrace: TileWalkTrace };

const defaultWalkTileIds = "20_21";
const walkTileIdPattern = /^\d{2}_\d{2}$/;
const failureClassByReasonPattern: readonly (readonly [RegExp, TileWalkFailureClass])[] = [
  [/did not start on the native route/, "tile-did-not-start"],
  [/loaded no world section/, "no-world-section"],
  [/BSP meshes/, "bsp-mesh-count"],
  [/below the terrain minimum/, "below-terrain-minimum"],
  [/the walk ended (?:\w+ with no floor|with no pawn trace)/, "ended-without-floor"],
];

export function requestedWalkTileIds(walkTileIdsVariable: string | undefined): readonly string[] {
  const walkTileIds = (walkTileIdsVariable ?? defaultWalkTileIds).split(",").map(entry => entry.trim());
  for (const walkTileId of walkTileIds) {
    if (walkTileId === "") throw new Error(`WALK_TILE_IDS ${JSON.stringify(walkTileIdsVariable)} holds an empty entry`);
    if (!walkTileIdPattern.test(walkTileId)) throw new Error(`WALK_TILE_IDS entry ${JSON.stringify(walkTileId)} is not an XX_YY tile id`);
  }
  const repeatedTileIds = walkTileIds.filter((walkTileId, position) => walkTileIds.indexOf(walkTileId) !== position);
  if (repeatedTileIds.length > 0) throw new Error(`WALK_TILE_IDS repeats ${[...new Set(repeatedTileIds)].join(", ")}`);
  return walkTileIds;
}

export function tileWalkRecordFilePath(projectRoot: string, laneName: string, catalogSha256: string): string {
  return resolve(projectRoot, "artifacts/lane-store", laneName, "measurements", `tile-walks-${catalogSha256}.json`);
}

function walkFailureClassOfTrace(observed: ObservedTileWalk): TileWalkFailureClass {
  if (observed.collisionStatus !== "resident") return "collision-not-resident";
  const lastMoveResult = observed.pawn?.lastMoveResult ?? null;
  if (lastMoveResult?.kind === "held") return `held-${lastMoveResult.heldReason}`;
  if (lastMoveResult?.kind === "cannot-move") return "cannot-move";
  return "walk-did-not-settle";
}

export function tileWalkFailureClass(reason: string, observed: ObservedTileWalk | null): TileWalkFailureClass {
  const reasonClass = failureClassByReasonPattern.find(([pattern]) => pattern.test(reason))?.[1];
  if (reasonClass !== undefined) return reasonClass;
  if (observed === null) return "tile-did-not-start";
  if (/did not walk more than/.test(reason)) return walkFailureClassOfTrace(observed);
  return "other";
}

export function tileWalkTrace(reason: string, observed: ObservedTileWalk | null): TileWalkTrace {
  const observedWalk = observed
    ?? { worldLoaded: false, collisionStatus: null, collisionFailure: null, missingCellIds: [], sourceSpawn: null, tileAnchor: null, pawn: null };
  return { failureClass: tileWalkFailureClass(reason, observed), ...observedWalk };
}

export function createTileWalkOutcome(walkViewportCount: number): TileWalkOutcome {
  return { walkViewportCount, passedViewportCount: 0, firstFailure: null };
}

export function settleViewportWalk(outcome: TileWalkOutcome, viewportFailure: TileWalkFailure | null): SettledTileWalk | null {
  if (viewportFailure === null) outcome.passedViewportCount += 1;
  else outcome.firstFailure ??= viewportFailure;
  if (outcome.firstFailure !== null) return { status: "failed", ...outcome.firstFailure };
  return outcome.passedViewportCount >= outcome.walkViewportCount ? { status: "pass", reason: null } : null;
}

export function startChunkBspFailure(loaded: LoadedSectionBsp, startChunk: StartChunkBsp): string | null {
  if (startChunk.bsp === null) return null;
  if (loaded.bspMeshes > 0 && loaded.bspResources.includes(startChunk.bsp.resource)) return null;
  return `the loaded section holds ${loaded.bspMeshes} BSP meshes from ${JSON.stringify(loaded.bspResources)} for the start chunk ${startChunk.chunkId} `
    + `BSP resource ${startChunk.bsp.resource}`;
}

export function walkEndFloorFailure(pawn: MovementWalkTrace | null): string | null {
  if (pawn === null) return "the walk ended with no pawn trace";
  if (pawn.physicsMode === "swimming" || (pawn.physicsMode === "walking" && pawn.floorHit !== null)) return null;
  return `the walk ended ${pawn.physicsMode} with no floor at ${JSON.stringify(pawn.endPosition)}`;
}

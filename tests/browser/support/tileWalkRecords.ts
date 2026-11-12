import { resolve } from "node:path";
import type { LoadCheckStatus } from "./loadCheckRecordFile";

export interface TileWalkOutcome {
  readonly walkViewportCount: number;
  passedViewportCount: number;
  firstFailureReason: string | null;
}

export interface SettledTileWalk {
  readonly status: LoadCheckStatus;
  readonly reason: string | null;
}

const defaultWalkTileIds = "20_21";
const walkTileIdPattern = /^\d{2}_\d{2}$/;

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

export function createTileWalkOutcome(walkViewportCount: number): TileWalkOutcome {
  return { walkViewportCount, passedViewportCount: 0, firstFailureReason: null };
}

export function settleViewportWalk(outcome: TileWalkOutcome, viewportFailureReason: string | null): SettledTileWalk | null {
  if (viewportFailureReason === null) outcome.passedViewportCount += 1;
  else outcome.firstFailureReason ??= viewportFailureReason;
  if (outcome.firstFailureReason !== null) return { status: "failed", reason: outcome.firstFailureReason };
  return outcome.passedViewportCount >= outcome.walkViewportCount ? { status: "pass", reason: null } : null;
}

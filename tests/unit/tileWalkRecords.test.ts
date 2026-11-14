import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MovementMoveResult } from "../../src/scene/world/movement/movementPresenter";
import {
  createTileWalkOutcome, requestedWalkTileIds, settleViewportWalk, startChunkBspFailure, tileWalkFailureClass, tileWalkRecordFilePath, tileWalkTrace,
  walkEndFloorFailure,
  type ObservedTileWalk, type TileWalkFailure,
} from "../browser/support/tileWalkRecords";

describe("requestedWalkTileIds", () => {
  it("walks 20_21 when WALK_TILE_IDS is unset", () => {
    expect(requestedWalkTileIds(undefined)).toEqual(["20_21"]);
  });

  it("reads a comma list of XX_YY ids in order", () => {
    expect(requestedWalkTileIds("17_12, 20_21,15_20")).toEqual(["17_12", "20_21", "15_20"]);
  });

  it("refuses an empty entry", () => {
    expect(() => requestedWalkTileIds("20_21,,17_12")).toThrow("WALK_TILE_IDS \"20_21,,17_12\" holds an empty entry");
    expect(() => requestedWalkTileIds("")).toThrow("holds an empty entry");
  });

  it("refuses an id that is not XX_YY", () => {
    expect(() => requestedWalkTileIds("20_21,tile:17_12")).toThrow("WALK_TILE_IDS entry \"tile:17_12\" is not an XX_YY tile id");
    expect(() => requestedWalkTileIds("2_21")).toThrow("is not an XX_YY tile id");
  });

  it("refuses a repeated id", () => {
    expect(() => requestedWalkTileIds("20_21,17_12,20_21")).toThrow("WALK_TILE_IDS repeats 20_21");
  });
});

describe("tileWalkRecordFilePath", () => {
  it("places the walk records beside the other lane measurements under the catalog SHA-256", () => {
    const catalogSha256 = "c".repeat(64);
    expect(tileWalkRecordFilePath("/project", "world", catalogSha256))
      .toBe(resolve("/project", "artifacts/lane-store/world/measurements", `tile-walks-${catalogSha256}.json`));
  });
});

const residentWalk = (pawn: ObservedTileWalk["pawn"]): ObservedTileWalk => ({
  worldLoaded: true, collisionStatus: "resident", collisionFailure: null, missingCellIds: [], sourceSpawn: [1, 2, 3], tileAnchor: null, pawn,
});
const walkingPawn = (lastMoveResult: MovementMoveResult | null): ObservedTileWalk["pawn"] => ({
  physicsMode: "walking", floorHit: { primitiveKind: "terrain", cellId: "15_22/chunk-0-0" }, lastMoveResult, fallStartPosition: null,
  endPosition: { x: 1, y: 2, z: 3 },
  residentCellIds: ["15_22/chunk-0-0"],
});
const idleTimeout = "Error: the local player did not walk more than 1 m and come to idle within 90000 ms: animation run";
const failureOf = (reason: string): TileWalkFailure => ({ reason, walkTrace: tileWalkTrace(reason, residentWalk(walkingPawn(null))) });

describe("tileWalkFailureClass", () => {
  it("classes load and assertion failures by their first failure line", () => {
    expect(tileWalkFailureClass("Error: tile:24_14 did not start on the native route: error: tile-anchor-has-no-floor: no collision lies below the authored PlayerStart", null)).toBe("tile-did-not-start");
    expect(tileWalkFailureClass("Error: the native route loaded no world section for tile:15_22", null)).toBe("no-world-section");
    expect(tileWalkFailureClass("Error: the loaded section holds 0 BSP meshes", residentWalk(null))).toBe("bsp-mesh-count");
    expect(tileWalkFailureClass("Error: the walk ended at height -163.8 m, below the terrain minimum -50.2 m", residentWalk(walkingPawn(null)))).toBe("below-terrain-minimum");
    expect(tileWalkFailureClass(`Error: ${walkEndFloorFailure({ ...walkingPawn(null)!, physicsMode: "falling", floorHit: null })}`, residentWalk(walkingPawn(null))))
      .toBe("ended-without-floor");
    expect(tileWalkFailureClass(`Error: ${walkEndFloorFailure(null)}`, residentWalk(null))).toBe("ended-without-floor");
  });

  it("classes an idle timeout by the collision load and the last move result of its trace", () => {
    expect(tileWalkFailureClass(idleTimeout, { ...residentWalk(null), collisionStatus: "loading" })).toBe("collision-not-resident");
    expect(tileWalkFailureClass(idleTimeout, residentWalk(walkingPawn({ kind: "held", heldReason: "speed-unresolved" })))).toBe("held-speed-unresolved");
    expect(tileWalkFailureClass(idleTimeout, residentWalk(walkingPawn({ kind: "held", heldReason: "collision-cell-absent" })))).toBe("held-collision-cell-absent");
    expect(tileWalkFailureClass(idleTimeout, residentWalk(walkingPawn({ kind: "cannot-move", blockingHit: null })))).toBe("cannot-move");
    expect(tileWalkFailureClass(idleTimeout, residentWalk(walkingPawn({ kind: "advanced", hasGoal: true, movedSourceUnits: 3 })))).toBe("walk-did-not-settle");
  });

  it("classes a failure with no native slice on the page as a tile that did not start", () => {
    expect(tileWalkFailureClass(idleTimeout, null)).toBe("tile-did-not-start");
    expect(tileWalkTrace(idleTimeout, null)).toEqual({
      failureClass: "tile-did-not-start", worldLoaded: false, collisionStatus: null, collisionFailure: null, missingCellIds: [], sourceSpawn: null, tileAnchor: null,
      pawn: null,
    });
  });

  it("names a failure line it does not know as other", () => {
    expect(tileWalkFailureClass("Error: expect(received).toEqual(expected)", residentWalk(null))).toBe("other");
  });
});

describe("settleViewportWalk", () => {
  it("settles a pass only when every viewport walk passed", () => {
    const outcome = createTileWalkOutcome(2);
    expect(settleViewportWalk(outcome, null)).toBeNull();
    expect(settleViewportWalk(outcome, null)).toEqual({ status: "pass", reason: null });
  });

  it("settles a failure with the first failure line and its walk trace as soon as one viewport fails", () => {
    const outcome = createTileWalkOutcome(2);
    expect(settleViewportWalk(outcome, null)).toBeNull();
    const failure = failureOf(idleTimeout);
    expect(settleViewportWalk(outcome, failure)).toEqual({ status: "failed", reason: idleTimeout, walkTrace: failure.walkTrace });
  });

  it("keeps the first failure line and trace of a tile when a later viewport fails too", () => {
    const outcome = createTileWalkOutcome(2);
    const first = failureOf("first failure"), second = failureOf("second failure");
    expect(settleViewportWalk(outcome, first)).toEqual({ status: "failed", reason: "first failure", walkTrace: first.walkTrace });
    expect(settleViewportWalk(outcome, second)).toEqual({ status: "failed", reason: "first failure", walkTrace: first.walkTrace });
  });

  it("keeps one outcome per tile", () => {
    const failedTile = createTileWalkOutcome(2);
    const passingTile = createTileWalkOutcome(2);
    settleViewportWalk(failedTile, failureOf("failed tile"));
    expect(settleViewportWalk(passingTile, null)).toBeNull();
    expect(settleViewportWalk(passingTile, null)).toEqual({ status: "pass", reason: null });
  });
});

describe("startChunkBspFailure", () => {
  const pinnedResource = "/l2/maps/" + "d".repeat(64) + "/native-tile-chunk-bsp/bsp.glb";

  it("expects no BSP mesh for a start chunk that pins no BSP resource", () => {
    expect(startChunkBspFailure({ bspMeshes: 0, bspResources: [] }, { chunkId: "chunk-1-1", bsp: null })).toBeNull();
  });

  it("passes a start chunk whose pinned BSP resource loaded with meshes", () => {
    expect(startChunkBspFailure({ bspMeshes: 3, bspResources: [pinnedResource] }, { chunkId: "chunk-1-1", bsp: { resource: pinnedResource } })).toBeNull();
  });

  it("names the BSP meshes and resources the section holds for a pinned start chunk BSP resource that did not load", () => {
    expect(startChunkBspFailure({ bspMeshes: 0, bspResources: [] }, { chunkId: "chunk-1-1", bsp: { resource: pinnedResource } }))
      .toBe(`the loaded section holds 0 BSP meshes from [] for the start chunk chunk-1-1 BSP resource ${pinnedResource}`);
    expect(tileWalkFailureClass(`Error: ${startChunkBspFailure({ bspMeshes: 0, bspResources: [] }, { chunkId: "chunk-1-1", bsp: { resource: pinnedResource } })}`,
      residentWalk(null))).toBe("bsp-mesh-count");
  });
});

describe("walkEndFloorFailure", () => {
  it("accepts a walk that ends walking on a floor or swimming", () => {
    expect(walkEndFloorFailure(walkingPawn(null))).toBeNull();
    expect(walkEndFloorFailure({ ...walkingPawn(null)!, physicsMode: "swimming", floorHit: null })).toBeNull();
  });

  it("names a walk that ends falling, walking with no floor or with no pawn", () => {
    expect(walkEndFloorFailure({ ...walkingPawn(null)!, physicsMode: "falling", floorHit: null })).toBe('the walk ended falling with no floor at {"x":1,"y":2,"z":3}');
    expect(walkEndFloorFailure({ ...walkingPawn(null)!, floorHit: null })).toBe('the walk ended walking with no floor at {"x":1,"y":2,"z":3}');
    expect(walkEndFloorFailure(null)).toBe("the walk ended with no pawn trace");
  });
});

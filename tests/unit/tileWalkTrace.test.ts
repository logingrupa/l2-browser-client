import { describe, expect, it } from "vitest";
import type { SourcePosition } from "../../src/world/sourceFrame";
import type { WorldEvent } from "../../src/world/worldTypes";
import type { CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import { createMovementPresenter } from "../../src/scene/world/movement/movementPresenter";
import { fixtureCellId } from "../fixtures/movement/movementCollisionFixtures";
import { boxVolumeWorld, blockingBox, floorSlab, pawnRules, syntheticPawnHalfHeight, waterBox } from "../fixtures/movement/pawnWorldFixtures";

const frameSeconds = 1 / 60;
const localPlayerId = "local-player";
const feetZ = 3;

function presenterOn(world: CollisionWorld) {
  const presenter = createMovementPresenter({
    collisionWorld: world, rules: pawnRules, reportIntent: () => {},
    pawnTraits: entityId => ({ isLocalPlayer: entityId === localPlayerId, walkAnimationFramesInMove: null, flies: false }),
  });
  const advanceFrames = (frameCount: number) => {
    for (let index = 0; index < frameCount; index += 1) presenter.advance(frameSeconds);
  };
  return { presenter, advanceFrames };
}

const groundMoveEvent = (origin: SourcePosition, destination: SourcePosition): WorldEvent => ({
  type: "move", entityId: localPlayerId, origin, destination, moveType: 0, speeds: { walk: 80, run: 115 }, collision: { radius: 9, height: syntheticPawnHalfHeight },
});

describe("movement presenter walk trace", () => {
  it("holds no trace for an entity it never received", () => {
    const { presenter } = presenterOn(boxVolumeWorld([floorSlab(0)]));
    expect(presenter.walkTrace(localPlayerId)).toBeNull();
  });

  it("traces a walk on a volume floor with its physics mode, floor hit, move result, end position and resident cells", () => {
    const world = boxVolumeWorld([floorSlab(0)]);
    const { presenter, advanceFrames } = presenterOn(world);
    presenter.applyEvent(groundMoveEvent({ x: 0, y: 0, z: feetZ }, { x: 200, y: 0, z: feetZ }));
    expect(presenter.walkTrace(localPlayerId)).toMatchObject({ physicsMode: "walking", floorHit: null, lastMoveResult: null, fallStartPosition: null });
    advanceFrames(30);
    const trace = presenter.walkTrace(localPlayerId)!;
    const residentCellIds = world.residentCells().map(cell => cell.cellId);
    expect(trace).toMatchObject({ physicsMode: "walking", floorHit: { primitiveKind: "volume", cellId: fixtureCellId }, residentCellIds });
    expect(trace.lastMoveResult).toMatchObject({ kind: "advanced", hasGoal: true });
    expect(trace.lastMoveResult!.kind === "advanced" && trace.lastMoveResult!.movedSourceUnits).toBeGreaterThan(0);
    expect(trace.endPosition).toEqual(presenter.inspection().pawns[0]!.feetPosition);
  });

  it("names the held reason as the last move result when the pawn swims with no swim speed", () => {
    const { presenter, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(-512), waterBox([0, 0, 0], [1024, 1024, 256])]));
    presenter.applyEvent(groundMoveEvent({ x: 0, y: 0, z: feetZ }, { x: 200, y: 0, z: feetZ }));
    advanceFrames(10);
    expect(presenter.walkTrace(localPlayerId)).toMatchObject({ lastMoveResult: { kind: "held", heldReason: "speed-unresolved" } });
  });

  it("names cannot-move as the last move result once the stuck report ends the move", () => {
    const { presenter, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(0), blockingBox([40, 0, 256], [16, 512, 256])]));
    presenter.applyEvent(groundMoveEvent({ x: 0, y: 0, z: feetZ }, { x: 300, y: 0, z: feetZ }));
    advanceFrames(4 * 60);
    const trace = presenter.walkTrace(localPlayerId)!;
    expect(trace).toMatchObject({ physicsMode: "walking", lastMoveResult: { kind: "cannot-move", blockingHit: { primitiveKind: "volume", cellId: fixtureCellId } } });
    expect(trace.lastMoveResult!.kind === "cannot-move" && trace.lastMoveResult!.blockingHit!.distanceSourceUnits).toBeLessThan(pawnRules.pawn.arrivalSlack + 9);
  });

  it("traces a fall with no floor hit when no collision lies below the pawn", () => {
    const { presenter, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(0, 2048, 4096)]));
    presenter.applyEvent(groundMoveEvent({ x: 0, y: 0, z: feetZ }, { x: 200, y: 0, z: feetZ }));
    advanceFrames(30);
    const trace = presenter.walkTrace(localPlayerId)!;
    expect(trace).toMatchObject({ physicsMode: "falling", floorHit: null, fallStartPosition: { y: 0 } });
    expect(trace.fallStartPosition!.z).toBeCloseTo(feetZ, 3);
    expect(trace.endPosition.z).toBeLessThan(feetZ);
  });

  it("names the collision readiness hold when the pawn stands outside every required cell", () => {
    const world = boxVolumeWorld([floorSlab(0)]);
    const { presenter, advanceFrames } = presenterOn(world);
    world.requireCell("fixture/pending", { minimumX: 5000, minimumY: 5000, maximumX: 6000, maximumY: 6000 });
    presenter.applyEvent(groundMoveEvent({ x: 5500, y: 5500, z: feetZ }, { x: 5700, y: 5500, z: feetZ }));
    advanceFrames(2);
    expect(presenter.walkTrace(localPlayerId)).toMatchObject({ lastMoveResult: { kind: "held", heldReason: "collision-not-ready" } });
  });
});

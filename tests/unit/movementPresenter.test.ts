import { describe, expect, it } from "vitest";
import type { SourcePosition } from "../../src/world/sourceFrame";
import type { WorldEvent } from "../../src/world/worldTypes";
import { createCollisionWorld, type CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import {
  createMovementPresenter, MovementPresenterError, type MovementIntent, type MovementPresenter,
} from "../../src/scene/world/movement/movementPresenter";
import { blockingBox, boxVolumeWorld, floorSlab, pawnRules, syntheticPawnHalfHeight } from "../fixtures/movement/pawnWorldFixtures";

const frameSeconds = 1 / 60;
const localPlayerId = "local-player";
const feetZ = 3;

interface TimedIntent {
  readonly frame: number;
  readonly intent: MovementIntent;
}

function presenterOn(world: CollisionWorld) {
  const intents: TimedIntent[] = [];
  let frame = 0;
  const presenter = createMovementPresenter({
    collisionWorld: world, rules: pawnRules, reportIntent: intent => intents.push({ frame, intent }),
    pawnTraits: entityId => ({ isLocalPlayer: entityId === localPlayerId, walkAnimationFramesInMove: null, flies: false }),
  });
  const advanceFrames = (frameCount: number) => {
    for (let index = 0; index < frameCount; index += 1) {
      frame += 1;
      presenter.advance(frameSeconds);
    }
  };
  return { presenter, intents, advanceFrames };
}

const moveEvent = (entityId: string, origin: SourcePosition, destination: SourcePosition, moveType = 0): WorldEvent => ({
  type: "move", entityId, origin, destination, moveType, speeds: { walk: 80, run: 115 }, collision: { radius: 9, height: syntheticPawnHalfHeight },
});

const pawnOf = (presenter: MovementPresenter, entityId: string) => presenter.inspection().pawns.find(pawn => pawn.entityId === entityId)!;

describe("movementPresenter applies server movement through the MOVE-01 port", () => {
  it("walks a pawn to its move goal along the floor, turning at the local yaw rate, and stops there", () => {
    const { presenter, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(0)]));
    presenter.applyEvent(moveEvent(localPlayerId, { x: 0, y: 0, z: feetZ }, { x: 0, y: 200, z: feetZ }));
    advanceFrames(1);
    expect(pawnOf(presenter, localPlayerId).heading).toBe(1500);
    advanceFrames(240);
    const pawn = pawnOf(presenter, localPlayerId);
    expect(pawn.isMoving).toBe(false);
    expect(pawn.heading).toBe(16384);
    expect(Math.abs(pawn.feetPosition.y - 200)).toBeLessThanOrEqual(pawnRules.pawn.arrivalSlack);
    expect(pawn).toMatchObject({ mode: "walking", heldReason: null, floor: { kind: "volume" } });
  });

  it("reports the local position every second while moving plus once after the stop", () => {
    const { presenter, intents, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(0)]));
    presenter.applyEvent(moveEvent(localPlayerId, { x: 0, y: 0, z: feetZ }, { x: 400, y: 0, z: feetZ }));
    advanceFrames(7 * 60);
    const reports = intents.filter(entry => entry.intent.type === "report-position");
    expect(reports).toHaveLength(5);
    expect(intents.filter(entry => entry.intent.type === "cannot-move")).toHaveLength(0);
    reports.slice(1).forEach((report, index) => expect(report.frame - reports[index]!.frame).toBeGreaterThanOrEqual(60));
    const stoppedFeet = pawnOf(presenter, localPlayerId).feetPosition;
    expect(reports.at(-1)!.intent).toEqual({ type: "report-position", position: stoppedFeet, heading: 0 });
    expect(reports.at(-2)!.frame).toBeLessThan(5 * 60);
    expect(reports.at(-1)!.frame).toBeGreaterThan(5 * 60);
  });

  it("stops locally and sends cannot-move once when a wall blocks progress", () => {
    const { presenter, intents, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(0), blockingBox([132, 0, 256], [32, 512, 256])]));
    presenter.applyEvent(moveEvent(localPlayerId, { x: 0, y: 0, z: feetZ }, { x: 300, y: 0, z: feetZ }));
    advanceFrames(4 * 60);
    const cannotMove = intents.filter(entry => entry.intent.type === "cannot-move");
    expect(cannotMove).toHaveLength(1);
    const pawn = pawnOf(presenter, localPlayerId);
    expect(pawn.isMoving).toBe(false);
    expect(pawn.feetPosition.x).toBeLessThan(100 - 9);
    expect(pawn.feetPosition.y).toBe(0);
    expect(cannotMove[0]!.intent).toEqual({ type: "cannot-move", position: pawn.feetPosition, heading: 0 });
  });

  it("holds a pawn whose collision has not loaded and reports collision-not-ready for it", () => {
    const world = createCollisionWorld();
    world.requireCell("90_90/unloaded", { minimumX: -512, minimumY: -512, maximumX: 512, maximumY: 512 });
    const { presenter, intents, advanceFrames } = presenterOn(world);
    presenter.applyEvent(moveEvent(localPlayerId, { x: 0, y: 0, z: feetZ }, { x: 300, y: 0, z: feetZ }));
    advanceFrames(90);
    expect(pawnOf(presenter, localPlayerId)).toMatchObject({
      heldReason: "collision-not-ready", isMoving: true, feetPosition: { x: 0, y: 0, z: feetZ },
    });
    expect(intents).toEqual([]);
  });

  it("snaps a remote pawn to a move origin farther than the snap threshold and walks the local pawn from where it stands", () => {
    const { presenter, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(0)]));
    presenter.applyEvent(moveEvent("remote", { x: 0, y: 0, z: feetZ }, { x: 0, y: 0, z: feetZ }));
    presenter.applyEvent(moveEvent(localPlayerId, { x: 0, y: 0, z: feetZ }, { x: 0, y: 0, z: feetZ }));
    advanceFrames(1);
    presenter.applyEvent(moveEvent("remote", { x: 150, y: 0, z: feetZ }, { x: 150, y: 0, z: feetZ }));
    expect(pawnOf(presenter, "remote").feetPosition.x).toBe(0);
    presenter.applyEvent(moveEvent("remote", { x: 500, y: 0, z: feetZ }, { x: 500, y: 0, z: feetZ }));
    presenter.applyEvent(moveEvent(localPlayerId, { x: 500, y: 0, z: feetZ }, { x: 500, y: 0, z: feetZ }));
    expect(pawnOf(presenter, "remote").feetPosition.x).toBe(500);
    expect(pawnOf(presenter, localPlayerId).feetPosition.x).toBe(0);
  });

  it("applies stop, correct and teleport records by entity", () => {
    const { presenter, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(0)]));
    presenter.applyEvent(moveEvent("remote", { x: 0, y: 0, z: feetZ }, { x: 400, y: 0, z: feetZ }));
    advanceFrames(30);
    presenter.applyEvent({ type: "stop", entityId: "remote", position: { x: 40, y: 0, z: feetZ }, heading: 8192 });
    expect(pawnOf(presenter, "remote")).toMatchObject({ isMoving: false, heading: 8192 });
    presenter.applyEvent({ type: "correct", entityId: "remote", position: { x: 64, y: 32, z: feetZ }, heading: 100 });
    expect(pawnOf(presenter, "remote")).toMatchObject({ feetPosition: { x: 64, y: 32, z: feetZ }, heading: 100 });
    presenter.applyEvent({ type: "teleport", entityId: "remote", position: { x: -300, y: 50, z: 0 } });
    const raised = pawnOf(presenter, "remote");
    expect(raised.feetPosition).toEqual({ x: -300, y: 50, z: syntheticPawnHalfHeight + pawnRules.pawn.teleportRaise });
    expect(raised.mode).toBe("falling");
    advanceFrames(60);
    expect(pawnOf(presenter, "remote")).toMatchObject({ mode: "walking", isMoving: false });
    expect(pawnOf(presenter, "remote").feetPosition.z).toBeLessThan(5);
  });

  it("refuses an unknown entity and malformed movement records with named errors", () => {
    const { presenter } = presenterOn(boxVolumeWorld([floorSlab(0)]));
    expect(() => presenter.applyEvent({ type: "stop", entityId: "ghost", position: { x: 0, y: 0, z: 0 }, heading: 0 })).toThrow(MovementPresenterError);
    expect(() => presenter.applyEvent({ type: "stop", entityId: "ghost", position: { x: 0, y: 0, z: 0 }, heading: 0 })).toThrow(/unknown entity ghost/);
    expect(() => presenter.applyEvent(moveEvent("a", { x: 0, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: 0 }))).toThrow(/destination/);
    expect(() => presenter.applyEvent({ ...moveEvent("a", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), speeds: { walk: -1, run: 115 } } as WorldEvent)).toThrow(/speed walk/);
    expect(() => presenter.applyEvent({ ...moveEvent("a", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), speeds: { walk: 80 } } as WorldEvent)).toThrow(/speed run/);
    expect(() => presenter.applyEvent(moveEvent("a", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.5))).toThrow(/moveType/);
    presenter.applyEvent(moveEvent("a", { x: 0, y: 0, z: feetZ }, { x: 1, y: 0, z: feetZ }));
    expect(() => presenter.applyEvent({ type: "correct", entityId: "a", position: { x: 0, y: 0, z: 0 }, heading: 1.5 })).toThrow(/heading/);
    expect(() => presenter.applyEvent({ type: "despawn", entityId: "a" })).not.toThrow();
  });
});

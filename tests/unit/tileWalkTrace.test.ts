import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { sourcePositionToWorld, worldPositionToSource, type SourcePosition } from "../../src/world/sourceFrame";
import type { WorldEvent } from "../../src/world/worldTypes";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import { createMovementPresenter } from "../../src/scene/world/movement/movementPresenter";
import {
  anchorOnChunkFloor, collisionFloorBelow, tileAnchorHasNoFloor, tileAnchorOutsideChunkFootprints, type TileAnchorCandidate,
} from "../../src/scene/world/nativeTileChunkContents";
import { replaceFixtureArray } from "../support/nativeTileCollisionFixture";
import { rm12FloorFixture } from "../fixtures/movement/pawnFloorPlacementRm12";
import {
  collisionWorldFromFixtures, emptyChunkArrays, fixtureCellId, volumeArrays, wallTreeArrays,
} from "../fixtures/movement/movementCollisionFixtures";
import {
  boxVolumeWorld, blockingBox, committedMoveTypes, floorSlab, pawnRules, sourcedHumanFighterSpeed, syntheticPawnHalfHeight, waterBox,
} from "../fixtures/movement/pawnWorldFixtures";

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

const flatTerrainHeightOfSourceZeroZ = 32767;

function flatTerrainWorld(): CollisionWorld {
  const terrainArrays: readonly [string, readonly number[]][] = [
    ["TERR.location", [0, 0, 0]], ["TERR.terrainScale", [1024, 1024, 256]], ["TERR.heightmapSize", [4, 4]], ["TERR.vertexRectangle", [0, 0, 4, 4]],
    ["TERR.heights", Array.from({ length: 16 }, () => flatTerrainHeightOfSourceZeroZ)], ["TERR.quadVisibility", Array.from({ length: 9 }, () => 1)],
    ["TERR.edgeTurn", Array.from({ length: 9 }, () => 0)],
  ];
  return collisionWorldFromFixtures(terrainArrays.reduce((arrays, [name, values]) => replaceFixtureArray(arrays, name, values), emptyChunkArrays()), null);
}

const worldVector = (source: SourcePosition) => {
  const world = sourcePositionToWorld(source);
  return new Vector3(world.x, world.y, world.z);
};

const fixtureCandidate = (chunkId: string, minimumX: number, maximumX: number): TileAnchorCandidate =>
  ({ tileId: "90_90", chunkId, footprint: { minimumX, minimumZ: -10, maximumX, maximumZ: 10 } });

describe("tile walk failure classes at their root cause", () => {
  it("held-speed-unresolved: the sandbox move record carries the aCis swim speed, so a pawn that starts in water swims to its goal", () => {
    const { presenter, advanceFrames } = presenterOn(boxVolumeWorld([floorSlab(-512), waterBox([0, 0, 0], [1024, 1024, 256])]));
    const adapter = new NativeSliceAdapter(sourcePositionToWorld({ x: 0, y: 0, z: feetZ }), null, undefined,
      { walkSupported: true, speed: sourcedHumanFighterSpeed, collision: { radius: 9, height: syntheticPawnHalfHeight }, moveTypes: committedMoveTypes });
    adapter.subscribe(event => presenter.applyEvent(event));
    adapter.dispatch({ type: "move-local", position: sourcePositionToWorld({ x: 200, y: 0, z: feetZ }) });
    advanceFrames(6 * 60);
    const trace = presenter.walkTrace(localPlayerId)!;
    expect(trace).toMatchObject({ physicsMode: "swimming", lastMoveResult: { kind: "advanced" } });
    expect(trace.endPosition.x).toBeGreaterThan(100);
    adapter.dispose();
  });

  it("fell-to-level-bottom: feet half a unit under the collision terrain fall through it, and the collision floor anchor stands the pawn on it", () => {
    const authored = worldVector({ x: -500, y: 0, z: 200 });
    const floor = collisionFloorBelow(flatTerrainWorld(), authored, -1)!;
    expect(floor.primitiveKind).toBe("terrain");
    const floorFeet = worldPositionToSource(floor.position);
    expect(floorFeet.z).toBeGreaterThanOrEqual(0);
    const walkFrom = (feet: SourcePosition) => {
      const { presenter, advanceFrames } = presenterOn(flatTerrainWorld());
      presenter.applyEvent(groundMoveEvent(feet, { ...feet, x: feet.x + 200 }));
      advanceFrames(4 * 60);
      return presenter.walkTrace(localPlayerId)!;
    };
    const anchored = walkFrom(floorFeet);
    expect(anchored).toMatchObject({ physicsMode: "walking", floorHit: { primitiveKind: "terrain" }, fallStartPosition: null });
    expect(anchored.endPosition.z).toBeCloseTo(rm12FloorFixture("Terrain", "close-floor-upward").geometricBottomGapNominal, 4);
    const belowSurface = walkFrom({ ...floorFeet, z: -0.5 });
    expect(belowSurface.fallStartPosition).toMatchObject({ x: floorFeet.x, z: -0.5 });
    expect(belowSurface.endPosition.z).toBeLessThan(-100);
  });

  it("tile-did-not-start: the anchor takes the chunk whose plan footprint holds the authored XY and the first collision hit below it", () => {
    const authored = worldVector({ x: 0, y: 0, z: 200 });
    const placement = anchorOnChunkFloor([fixtureCandidate("chunk-0-0", -20, -1), fixtureCandidate("chunk-1-0", -1, 20)], authored,
      position => collisionFloorBelow(boxVolumeWorld([floorSlab(0)]), position, -1));
    expect(placement.chunk.chunkId).toBe("chunk-1-0");
    expect(placement.floor.primitiveKind).toBe("volume");
    expect(placement.floor.position.y).toBeGreaterThanOrEqual(0);
    expect(placement.floor.position.y).toBeLessThan(0.01);
    expect(() => anchorOnChunkFloor([fixtureCandidate("chunk-0-0", -20, -1)], authored, () => null)).toThrow(tileAnchorOutsideChunkFootprints);
    expect(() => anchorOnChunkFloor([fixtureCandidate("chunk-1-0", -1, 20)], authored, () => null))
      .toThrow(`${tileAnchorHasNoFloor}: no collision lies below the authored PlayerStart in 90_90/chunk-1-0.`);
  });

  it("tile-did-not-start: a floor probe ends maxStepHeight below the lowest loaded terrain and finds nothing for an authored location below it", () => {
    const world = boxVolumeWorld([floorSlab(0)]);
    expect(collisionFloorBelow(world, worldVector({ x: 0, y: 0, z: 200 }), 1 + pawnRules.pawn.maxStepHeight / 100)).toBeNull();
    expect(collisionFloorBelow(world, worldVector({ x: 0, y: 0, z: 200 }), pawnRules.pawn.maxStepHeight / 100 - 0.01)).toMatchObject({ primitiveKind: "volume" });
    expect(collisionFloorBelow(world, worldVector({ x: 0, y: 0, z: -300 }), -1)).toBeNull();
  });

  it("fell-to-level-bottom: the walk trace marks a pawn resting within maxStepHeight of the lowest resident BSP point", () => {
    const otherArrays = emptyChunkArrays().filter(array => !array.name.startsWith("VOLS."));
    const levelBottomZ = -1024;
    const restingZAfterWalk = (floorTopZ: number) => {
      const { presenter, advanceFrames } = presenterOn(collisionWorldFromFixtures([...volumeArrays([floorSlab(floorTopZ)]), ...otherArrays], wallTreeArrays()));
      presenter.applyEvent(groundMoveEvent({ x: 0, y: 0, z: floorTopZ + feetZ }, { x: 100, y: 0, z: floorTopZ + feetZ }));
      advanceFrames(2 * 60);
      return presenter.walkTrace(localPlayerId)!;
    };
    expect(restingZAfterWalk(levelBottomZ)).toMatchObject({ physicsMode: "walking", restsOnLevelBottom: true });
    expect(restingZAfterWalk(0)).toMatchObject({ physicsMode: "walking", restsOnLevelBottom: false });
    expect(presenterOn(boxVolumeWorld([floorSlab(0)])).presenter.walkTrace(localPlayerId)).toBeNull();
  });

  it("tile-did-not-start: a floor probe reaches a floor below the loaded terrain when a resident BSP tree reaches lower", () => {
    const otherArrays = emptyChunkArrays().filter(array => !array.name.startsWith("VOLS."));
    const world = collisionWorldFromFixtures([...volumeArrays([floorSlab(-500)]), ...otherArrays], wallTreeArrays());
    expect(collisionFloorBelow(boxVolumeWorld([floorSlab(-500)]), worldVector({ x: 0, y: 0, z: 200 }), 0)).toBeNull();
    expect(collisionFloorBelow(world, worldVector({ x: 0, y: 0, z: 200 }), 0)).toMatchObject({ primitiveKind: "volume" });
  });
});

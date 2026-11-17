import { describe, expect, it } from "vitest";
import type { Vector3 } from "../../src/shared/math/vector3";
import { singleLineCheck } from "../../src/scene/world/movement/core/lineCheck";
import type { PawnBody } from "../../src/scene/world/movement/core/pawnBody";
import { advancePawnSimulation, type PawnSimulation, type PawnTraits } from "../../src/scene/world/movement/core/pawnPhysics";
import { headingOfDirection, turnYawTowards, yawStepForTick } from "../../src/scene/world/movement/core/pawnRotation";
import { calculatePawnVelocity, currentPawnSpeed, hasPawnArrived, type PawnSpeeds } from "../../src/scene/world/movement/core/pawnVelocity";
import { walkPawn } from "../../src/scene/world/movement/core/pawnWalking";
import type { GoldenTrace } from "../support/goldenTrace";
import type { CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import type { CollisionPrimitive } from "../../src/scene/world/movement/core/collisionTrace";
import { expectMovementGoldenTrace, terrainWorldPoint } from "../fixtures/movement/movementCollisionFixtures";
import { rm12FloorFixture, type Rm12FloorFixture } from "../fixtures/movement/pawnFloorPlacementRm12";
import {
  boxVolumeWorld, bspFloorWorld, centreAboveFloor, flatTerrainWorld, floorSlab, pawnContext, pawnRules, standingPawn, syntheticPawnHalfHeight,
  syntheticPawnRadius, terrainQuadCentre,
} from "../fixtures/movement/pawnWorldFixtures";

const frameSeconds = 1 / 60;
const groundSpeeds: PawnSpeeds = { walk: 80, run: 115, swimWalk: null, swimRun: null, flyWalk: null, flyRun: null, nonAttackSpeedRate: 1 };
const remotePawn: PawnTraits = { isLocalPlayer: false, walkAnimationFramesInMove: null, flies: false };
const localPlayer: PawnTraits = { isLocalPlayer: true, walkAnimationFramesInMove: 12, flies: false };

function simulationTowards(body: PawnBody, destination: Vector3, runs: boolean): PawnSimulation {
  return { body, yaw: 0, goal: { destination, offset: 0, runs, speeds: groundSpeeds }, moveTimerSeconds: 0, speedUnresolved: false };
}

function advanceFrames(simulation: PawnSimulation, traits: PawnTraits, frameCount: number, world = boxVolumeWorld([floorSlab(0)])): PawnSimulation[] {
  const context = pawnContext(world);
  const frames: PawnSimulation[] = [];
  let current = simulation;
  for (let frame = 0; frame < frameCount; frame += 1) {
    current = advancePawnSimulation(context, current, traits, frameSeconds);
    frames.push(current);
  }
  return frames;
}

function floorProbeHit(location: Vector3, world: CollisionWorld) {
  const probe = pawnRules.pawn.floorProbe;
  return singleLineCheck(world, {
    start: location, end: { ...location, z: location.z - probe }, extent: { x: syntheticPawnRadius, y: syntheticPawnRadius, z: syntheticPawnHalfHeight },
  }, pawnRules);
}

function floorGap(location: Vector3, world = boxVolumeWorld([floorSlab(0)])): number {
  return pawnRules.pawn.floorProbe * (floorProbeHit(location, world)?.time ?? 1);
}

describe("calcVelocity, GetCurSpeed and arrival", () => {
  it("moves at full speed from rest with no acceleration ramp and clamps to the remaining distance over the tick", () => {
    const fromRest = calculatePawnVelocity({ location: { x: 0, y: 0, z: 0 }, destination: { x: 300, y: 400, z: 90 }, offset: 0, speed: 80, tickSeconds: 0.05, measuresVertical: false });
    expect(fromRest).toEqual({ x: Math.fround(48), y: Math.fround(64), z: 0 });
    const nearGoal = calculatePawnVelocity({ location: { x: 0, y: 0, z: 0 }, destination: { x: 3, y: 0, z: 0 }, offset: 1, speed: 80, tickSeconds: 0.05, measuresVertical: false });
    expect(nearGoal.x).toBeCloseTo(40, 4);
  });

  it("measures 3D distance when swimming or flying", () => {
    const velocity = calculatePawnVelocity({ location: { x: 0, y: 0, z: 0 }, destination: { x: 0, y: 0, z: 500 }, offset: 0, speed: 50, tickSeconds: 0.05, measuresVertical: true });
    expect(velocity).toEqual({ x: 0, y: 0, z: 50 });
  });

  it("arrives within the offset plus the arrival slack", () => {
    const query = { location: { x: 0, y: 0, z: 0 }, destination: { x: 10.005, y: 0, z: 40 }, offset: 10, measuresVertical: false };
    expect(hasPawnArrived(query, pawnRules)).toBe(true);
    expect(hasPawnArrived({ ...query, destination: { x: 10.02, y: 0, z: 0 } }, pawnRules)).toBe(false);
  });

  it("walks until MoveTimer passes WalkAnimFrameInMove / 30 for a non-npc pawn and runs at once for an npc", () => {
    const query = { speeds: groundSpeeds, environment: "ground" as const, runs: true, walkAnimationFramesInMove: 12 };
    expect(currentPawnSpeed({ ...query, moveTimerSeconds: 0.4 }, pawnRules)).toBe(80);
    expect(currentPawnSpeed({ ...query, moveTimerSeconds: 0.41 }, pawnRules)).toBe(115);
    expect(currentPawnSpeed({ ...query, walkAnimationFramesInMove: null, moveTimerSeconds: 0 }, pawnRules)).toBe(115);
    expect(currentPawnSpeed({ ...query, runs: false, moveTimerSeconds: 3 }, pawnRules)).toBe(80);
  });

  it("scales by NonAttackSpeedRate and leaves an environment without speeds unresolved", () => {
    const query = { speeds: { ...groundSpeeds, nonAttackSpeedRate: 1.5 }, environment: "ground" as const, runs: false, walkAnimationFramesInMove: null, moveTimerSeconds: 0 };
    expect(currentPawnSpeed(query, pawnRules)).toBe(120);
    expect(currentPawnSpeed({ ...query, environment: "water" }, pawnRules)).toBeNull();
  });
});

describe("fixed-rate yaw", () => {
  it("measures headings from +X with 16384 along +Y", () => {
    expect(headingOfDirection({ x: 1, y: 0, z: 0 })).toBe(0);
    expect(headingOfDirection({ x: 0, y: 1, z: 0 })).toBe(16384);
    expect(headingOfDirection({ x: -1, y: 0, z: 0 })).toBe(32768);
    expect(headingOfDirection({ x: 0, y: -1, z: 0 })).toBe(49152);
  });

  it("turns the shorter way by at most the rounded local rate or the truncated rate of other pawns", () => {
    expect(yawStepForTick(frameSeconds, true, pawnRules)).toBe(1500);
    expect(yawStepForTick(0.015, false, pawnRules)).toBe(Math.trunc(65000 * 0.015));
    expect(turnYawTowards(1000, 64536, 500)).toBe(500);
    expect(turnYawTowards(65000, 200, 1500)).toBe(200);
    expect(turnYawTowards(0, 32768, 1500)).toBe(64036);
  });
});

describe("walking with the floor probe and the floor gap band", () => {
  it("walks at 80 units per second for one second and covers 80 units within 0.05", () => {
    const frames = advanceFrames(simulationTowards(standingPawn(centreAboveFloor(0, 0, 0)), { x: 1000, y: 0, z: 0 }, false), remotePawn, 60);
    expect(frames.at(-1)!.body.location.x).toBeCloseTo(80, 1);
    expect(Math.abs(frames.at(-1)!.body.location.x - 80)).toBeLessThan(0.05);
    expect(frames.every(frame => frame.body.mode === "walking")).toBe(true);
  });

  it("walks 0.4 s before the run starts, covering 0.4 * 80 + 0.6 * 115 = 101 units within 0.5", () => {
    const frames = advanceFrames(simulationTowards(standingPawn(centreAboveFloor(0, 0, 0)), { x: 1000, y: 0, z: 0 }, true), localPlayer, 60);
    expect(Math.abs(frames.at(-1)!.body.location.x - 101)).toBeLessThan(0.5);
  });

  it("settles a walking pawn into the floor gap band and keeps it there", () => {
    const high = standingPawn({ x: 0, y: 0, z: syntheticPawnHalfHeight + 8 });
    const frames = advanceFrames(simulationTowards(high, { x: 500, y: 0, z: 0 }, false), remotePawn, 30);
    for (const frame of frames.slice(1)) {
      const gap = floorGap(frame.body.location);
      expect(gap).toBeGreaterThanOrEqual(pawnRules.pawn.floorBand.minimum);
      expect(gap).toBeLessThanOrEqual(pawnRules.pawn.floorBand.maximum);
    }
    expect(frames.at(-1)!.body.floor).toMatchObject({ kind: "volume" });
  });

  it("hands the unused time to falling when the floor ends", () => {
    const world = boxVolumeWorld([floorSlab(0, -2048, 0)]);
    const step = walkPawn(pawnContext(world), standingPawn(centreAboveFloor(-5, 0, 0)), { x: 400, y: 0, z: 0 }, 0.1, false);
    expect(step.body.mode).toBe("falling");
    expect(step.body.floor).toBeNull();
    expect(step.body.velocity.z).toBe(0);
    expect(step.unusedSeconds).toBe(0);
    const standing = walkPawn(pawnContext(world), standingPawn(centreAboveFloor(100, 0, 0)), { x: 0, y: 0, z: 0 }, 0.1, false);
    expect(standing).toMatchObject({ body: { mode: "falling" }, unusedSeconds: 0.1 });
  });

  it("pins a declared walk with a turn in a float32 golden trace", () => {
    const start = simulationTowards(standingPawn(centreAboveFloor(0, 0, 0)), { x: -120, y: 160, z: 0 }, true);
    const frames = advanceFrames(start, localPlayer, 150);
    const trace: GoldenTrace = {
      seed: 0, stepSeconds: frameSeconds, columns: ["frame", "x", "y", "z", "velocityX", "velocityY", "yaw", "moving"],
      rows: frames.map((frame, frameIndex) => [frameIndex, frame.body.location.x, frame.body.location.y, frame.body.location.z,
        frame.body.velocity.x, frame.body.velocity.y, frame.yaw, frame.goal === null ? 0 : 1]),
    };
    expect(frames.at(-1)!.goal).toBeNull();
    expect(frames.at(-1)!.yaw).toBe(headingOfDirection({ x: -120, y: 160, z: 0 }));
    expectMovementGoldenTrace("pawn-walking-turn.golden.json", trace);
  });
});

describe("APawn::physWalking floor settle against the RM-12 flat fixtures (Engine.dll 4dd2f63c 0x1063F750)", () => {
  const floorZ = 0;
  const floors: Readonly<Record<Rm12FloorFixture["primitive"], { readonly world: CollisionWorld; readonly point: { readonly x: number; readonly y: number } }>> = {
    Terrain: { world: flatTerrainWorld(floorZ), point: terrainQuadCentre },
    BSP: { world: bspFloorWorld(floorZ), point: { x: 0, y: 0 } },
  };
  const standingStill = { x: 0, y: 0, z: 0 };
  const pawnWithBottomGap = (primitive: Rm12FloorFixture["primitive"], bottomGap: number, floor: CollisionPrimitive | null): PawnBody => {
    const { point } = floors[primitive];
    return { ...standingPawn({ x: point.x, y: point.y, z: Math.fround(floorZ + syntheticPawnHalfHeight + bottomGap) }), floor };
  };
  const floorPrimitiveOf = (primitive: Rm12FloorFixture["primitive"]) =>
    floorProbeHit(pawnWithBottomGap(primitive, 2.5, null).location, floors[primitive].world)!.primitive;
  const stepStill = (primitive: Rm12FloorFixture["primitive"], body: PawnBody) =>
    walkPawn(pawnContext(floors[primitive].world), body, standingStill, frameSeconds, false).body;

  it.each(["Terrain", "BSP"] as const)("sweeps the full 12 units down when the %s gap is over 2.4 and then rests in the band", primitive => {
    const fixture = rm12FloorFixture(primitive, "downward-settle");
    const settled = stepStill(primitive, pawnWithBottomGap(primitive, 8, floorPrimitiveOf(primitive)));
    expect(settled.location.z).toBeCloseTo(fixture.locationZNominal, 4);
    expect(floorGap(settled.location, floors[primitive].world)).toBeCloseTo(fixture.reportedProbeGapNominal, 4);
    expect(settled.restsInFloorBand).toBe(false);
    const rested = stepStill(primitive, settled);
    expect(rested).toMatchObject({ location: settled.location, restsInFloorBand: true, velocity: standingStill });
  });

  it.each([["Terrain", 1], ["BSP", 2]] as const)("moves a pawn on the same %s floor with a reported gap under 1.9 up to the close-floor fixture", (primitive, bottomGap) => {
    const fixture = rm12FloorFixture(primitive, "close-floor-upward");
    const raised = stepStill(primitive, pawnWithBottomGap(primitive, bottomGap, floorPrimitiveOf(primitive)));
    expect(raised.location.z).toBeCloseTo(fixture.locationZNominal, 4);
    expect(floorGap(raised.location, floors[primitive].world)).toBeCloseTo(fixture.reportedProbeGapNominal, 4);
  });

  it("sweeps down when the floor changed although the reported gap sits in the band", () => {
    const settled = stepStill("Terrain", pawnWithBottomGap("Terrain", 2.65, null));
    expect(settled.location.z).toBeCloseTo(rm12FloorFixture("Terrain", "downward-settle").locationZNominal, 4);
    expect(settled.floor).toEqual(floorPrimitiveOf("Terrain"));
  });

  it("sweeps down rather than up when the floor changed and the reported gap is under 1.9", () => {
    const start = pawnWithBottomGap("Terrain", 1, null);
    const swept = stepStill("Terrain", start);
    expect(swept.location.z).toBe(start.location.z);
    expect(swept.restsInFloorBand).toBe(false);
  });

  it("moves a pawn whose reported gap is exactly 0 up by the 2.15 target", () => {
    const terrainTraceBias = pawnRules.backoff.terrain.kind === "fixed-distance" ? pawnRules.backoff.terrain.distance : Number.NaN;
    const start = pawnWithBottomGap("Terrain", terrainTraceBias, floorPrimitiveOf("Terrain"));
    expect(floorGap(start.location, floors.Terrain.world)).toBe(0);
    const raised = stepStill("Terrain", start);
    expect(raised.location.z).toBeCloseTo(start.location.z + pawnRules.pawn.floorBand.target, 4);
  });

  it("keeps a walking pawn on its settled height across terrain quad boundaries because Base stays the one TerrainInfo", () => {
    const point = terrainWorldPoint(0.6, 1.5);
    const context = pawnContext(floors.Terrain.world);
    const close = standingPawn({ x: point.x, y: point.y, z: Math.fround(floorZ + syntheticPawnHalfHeight + 1) });
    const closeOnItsFloor = { ...close, floor: floorProbeHit(close.location, floors.Terrain.world)!.primitive };
    const settled = walkPawn(context, closeOnItsFloor, standingStill, frameSeconds, false).body;
    expect(settled.location.z).toBeCloseTo(rm12FloorFixture("Terrain", "close-floor-upward").locationZNominal, 4);
    const walkVelocity = { x: 300, y: 0, z: 0 };
    let current = settled;
    const heights: number[] = [];
    const quadIndices = new Set<number>();
    for (let tick = 0; tick < 120; tick += 1) {
      current = walkPawn(context, current, walkVelocity, frameSeconds, false).body;
      heights.push(current.location.z);
      if (current.floor?.kind === "terrain") quadIndices.add(current.floor.quadIndex);
    }
    expect(quadIndices.size).toBeGreaterThan(1);
    expect([...new Set(heights)]).toEqual([settled.location.z]);
  });

  it("rests a pawn on the same floor inside the band with zero velocity and does not move it", () => {
    const start = pawnWithBottomGap("BSP", 3.4, floorPrimitiveOf("BSP"));
    const rested = stepStill("BSP", start);
    expect(rested).toMatchObject({ location: start.location, restsInFloorBand: true, velocity: standingStill });
    expect(stepStill("BSP", rested)).toEqual(rested);
  });
});

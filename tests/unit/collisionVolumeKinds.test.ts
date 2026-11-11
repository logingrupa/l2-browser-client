import { describe, expect, it } from "vitest";
import { CollisionWorldError } from "../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import { isPawnInWater } from "../../src/scene/world/movement/core/pawnBody";
import { advancePawnSimulation } from "../../src/scene/world/movement/core/pawnPhysics";
import { blockingBoxVolume, emptyChunkArrays, fixtureCellId, fixtureTileId, volumeArrays, waterPhysicsVolume } from "../fixtures/movement/movementCollisionFixtures";
import { blockingBox, boxVolumeWorld, centreAboveFloor, floorSlab, pawnContext, physicsBox, standingPawn, waterBox } from "../fixtures/movement/pawnWorldFixtures";
import { readCollisionFixturePayload, replaceFixtureArray } from "../support/nativeTileCollisionFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const kindedVolumeArrays = (): TypedPayloadFixtureArray[] => [
  ...volumeArrays([blockingBoxVolume, waterPhysicsVolume]),
  ...emptyChunkArrays().filter(array => !array.name.startsWith("VOLS.")),
];
const decodeVolumes = (arrays: readonly TypedPayloadFixtureArray[]) =>
  decodeNativeTileCollisionCell(readCollisionFixturePayload(arrays), { cellId: fixtureCellId, tileId: fixtureTileId }).volumes;

describe("VOLS volume kinds and physics fields", () => {
  it("decodes the kind, water flag and priority of each volume with their provenance", () => {
    const [blocking, water] = decodeVolumes(kindedVolumeArrays());
    expect(blocking).toMatchObject({
      kind: "blocking", water: null, priority: null, gravity: null, terminalVelocity: null,
      physicsFieldProvenance: { water: "unresolved", priority: "unresolved", gravity: "unresolved", terminalVelocity: "unresolved" },
    });
    expect(water).toMatchObject({
      kind: "physics", water: true, priority: 0, gravity: null, terminalVelocity: null,
      physicsFieldProvenance: { water: "authored", priority: "authored", gravity: "unresolved", terminalVelocity: "unresolved" },
    });
  });

  it("decodes a resolved gravity vector and terminal velocity in source units", () => {
    let arrays = replaceFixtureArray(kindedVolumeArrays(), "VOLS.gravity", [0, 0, 0, 0, 0, -950]);
    arrays = replaceFixtureArray(arrays, "VOLS.terminalVelocity", [0, 1200]);
    arrays = replaceFixtureArray(arrays, "VOLS.physicsFieldProvenance", [3, 3, 3, 3, 0, 0, 1, 1]);
    const [, water] = decodeVolumes(arrays);
    expect(water).toMatchObject({ gravity: [0, 0, -950], terminalVelocity: 1200 });
    expect(water!.physicsFieldProvenance).toEqual({ water: "authored", priority: "authored", gravity: "class-default", terminalVelocity: "class-default" });
  });

  it("refuses a kind array whose length differs from the volume count", () => {
    const arrays = replaceFixtureArray(kindedVolumeArrays(), "VOLS.kind", [0]);
    expect(() => decodeVolumes(arrays)).toThrow(CollisionWorldError);
    expect(() => decodeVolumes(arrays)).toThrow("VOLS.kind holds 1 values; 2 are declared.");
  });

  it("refuses an unknown kind code, a water flag that is not 0 or 1, and a provenance array of the wrong length", () => {
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.kind", [0, 2]))).toThrow("VOLS.kind[1] holds the unknown code 2.");
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.water", [0, 2]))).toThrow("VOLS.water[1] must be 0 or 1, not 2.");
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.physicsFieldProvenance", [3, 3, 3, 3])))
      .toThrow("VOLS.physicsFieldProvenance holds 4 values; 8 are declared.");
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.physicsFieldProvenance", [3, 3, 3, 3, 4, 0, 3, 3])))
      .toThrow("VOLS.physicsFieldProvenance[4] holds the unknown code 4.");
  });

  it("refuses a gravity or terminal velocity that is not finite", () => {
    expect(() => decodeVolumes(replaceFixtureArray(kindedVolumeArrays(), "VOLS.terminalVelocity", [0, Number.NaN])))
      .toThrow("VOLS.terminalVelocity[1] = NaN is not finite.");
  });
});

const walker = { isLocalPlayer: false, walkAnimationFramesInMove: null, flies: false };
const floorTopZ = -600;
const volumeCentre = [0, 0, -500] as const, volumeHalfSize = [2048, 2048, 200] as const;
const pawnLocation = centreAboveFloor(0, 0, floorTopZ);

function modeAfterOneFrame(boxes: Parameters<typeof boxVolumeWorld>[0]) {
  const simulation = { body: standingPawn(pawnLocation), yaw: 0, goal: null, moveTimerSeconds: 0, speedUnresolved: false };
  return advancePawnSimulation(pawnContext(boxVolumeWorld([floorSlab(floorTopZ), ...boxes])), simulation, walker, 1 / 60).body.mode;
}

describe("the pawn water test reads the containing volume's water flag", () => {
  it("keeps a pawn walking inside a physics volume whose water flag is false and swims inside one whose flag is true", () => {
    expect(modeAfterOneFrame([physicsBox(volumeCentre, volumeHalfSize, { water: false, priority: 0 })])).toBe("walking");
    expect(modeAfterOneFrame([physicsBox(volumeCentre, volumeHalfSize, { water: true, priority: 0 })])).toBe("swimming");
  });

  it("never puts a pawn in water inside a blocking volume or a physics volume whose water flag is unresolved", () => {
    expect(isPawnInWater(pawnContext(boxVolumeWorld([blockingBox(volumeCentre, volumeHalfSize)])), pawnLocation)).toBe(false);
    expect(isPawnInWater(pawnContext(boxVolumeWorld([physicsBox(volumeCentre, volumeHalfSize, { water: null, priority: 0 })])), pawnLocation)).toBe(false);
  });

  it("reads the water flag of the containing physics volume with the highest priority", () => {
    const water = (priority: number) => physicsBox(volumeCentre, volumeHalfSize, { water: true, priority });
    const dry = (priority: number) => physicsBox(volumeCentre, volumeHalfSize, { water: false, priority });
    expect(isPawnInWater(pawnContext(boxVolumeWorld([water(0), dry(5)])), pawnLocation)).toBe(false);
    expect(isPawnInWater(pawnContext(boxVolumeWorld([dry(0), water(5)])), pawnLocation)).toBe(true);
    expect(isPawnInWater(pawnContext(boxVolumeWorld([physicsBox(volumeCentre, volumeHalfSize, { water: false, priority: null }), water(-3)])), pawnLocation))
      .toBe(true);
    expect(isPawnInWater(pawnContext(boxVolumeWorld([waterBox(volumeCentre, volumeHalfSize)])), pawnLocation)).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { singleLineCheck } from "../../src/scene/world/movement/core/lineCheck";
import { placeSpawnedPawn } from "../../src/scene/world/movement/core/pawnSpawnPlacement";
import { rm12PawnFloorPlacement } from "../fixtures/movement/pawnFloorPlacementRm12";
import { bspFloorWorld, pawnContext, pawnRules, standingPawn, syntheticPawnHalfHeight, syntheticPawnRadius } from "../fixtures/movement/pawnWorldFixtures";

vi.mock("../../src/scene/world/movement/core/lineCheck", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/scene/world/movement/core/lineCheck")>();
  return { ...original, singleLineCheck: vi.fn(original.singleLineCheck) };
});

const lineCheckSpy = vi.mocked(singleLineCheck);
const floorZ = 0;
const spawnedBody = standingPawn({ x: 0, y: 0, z: 0 });
const placeAt = (incomingZ: number) => placeSpawnedPawn(pawnContext(bspFloorWorld(floorZ)), spawnedBody, { x: 0, y: 0, z: incomingZ });
const lastSpawnHit = () => lineCheckSpy.mock.results.at(-1)!.value as ReturnType<typeof singleLineCheck>;

describe("L2NetNotify::OnCharInfo ground spawn placement (RM-12, Engine.dll 4dd2f63c 0x10495A30)", () => {
  afterEach(() => { lineCheckSpy.mockClear(); });

  it("sweeps the pawn cylinder extent from incoming Z + CollisionHeight + 20 down to incoming Z - 10", () => {
    const [raiseConstant, dropConstant] = rm12PawnFloorPlacement.groundSpawnConstants;
    expect([raiseConstant, dropConstant]).toEqual([expect.objectContaining({ va: "0x1089f9a8", double: 20 }), expect.objectContaining({ va: "0x1089de78", double: 10 })]);
    expect(pawnRules.pawn.spawnTrace).toEqual({ raise: raiseConstant!.double, drop: dropConstant!.double });
    placeAt(5);
    expect(lineCheckSpy).toHaveBeenCalledTimes(1);
    expect(lineCheckSpy.mock.calls[0]![1]).toMatchObject({
      start: { x: 0, y: 0, z: 5 + syntheticPawnHalfHeight + 20 }, end: { x: 0, y: 0, z: 5 - 10 },
      extent: { x: syntheticPawnRadius, y: syntheticPawnRadius, z: syntheticPawnHalfHeight },
    });
  });

  it("spawns at the hit location when f32(12 * Hit.Time) is at least 1.9", () => {
    const placed = placeAt(floorZ);
    const hit = lastSpawnHit()!;
    expect(Math.fround(pawnRules.pawn.floorProbe * hit.time)).toBeGreaterThanOrEqual(rm12PawnFloorPlacement.floorPolicy.minimumReportedGap);
    expect(placed).toEqual(hit.location);
  });

  it("raises the hit location by 2.15 minus f32(12 * Hit.Time) only when that reported gap is under 1.9", () => {
    const buriedIncomingZ = floorZ - 15;
    const placed = placeAt(buriedIncomingZ);
    const hit = lastSpawnHit()!;
    const reportedGap = Math.fround(pawnRules.pawn.floorProbe * hit.time);
    expect(reportedGap).toBeLessThan(rm12PawnFloorPlacement.floorPolicy.minimumReportedGap);
    expect(placed).toEqual({ ...hit.location, z: Math.fround(hit.location.z + Math.fround(rm12PawnFloorPlacement.floorPolicy.upwardTargetReportedGap - reportedGap)) });
  });

  it("spawns at the incoming position when the sweep meets no floor", () => {
    const incoming = { x: 0, y: 0, z: 500 };
    expect(placeSpawnedPawn(pawnContext(bspFloorWorld(floorZ)), spawnedBody, incoming)).toBe(incoming);
    expect(lastSpawnHit()).toBeNull();
  });
});

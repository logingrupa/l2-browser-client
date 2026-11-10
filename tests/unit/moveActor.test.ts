import { describe, expect, it } from "vitest";
import type { Vector3 } from "../../src/shared/math/vector3";
import { traceCylinder } from "../../src/scene/world/movement/core/cylinderTrace";
import { moveActor, type MoveActorResult } from "../../src/scene/world/movement/core/moveActor";
import { MovementRulesError, parseMovementNativeRules } from "../../src/scene/world/movement/core/movementRules";
import type { GoldenTrace } from "../support/goldenTrace";
import {
  collisionWorldFromFixtures, committedMovementRules, emptyChunkArrays, expectMovementGoldenTrace, fixtureTileId, readCommittedMovementRulesDocument,
  wallTreeArrays,
} from "../fixtures/movement/movementCollisionFixtures";

const rules = committedMovementRules();
const pawnRadius = 9, pawnHalfHeight = 23;
const actorAt = (location: Vector3) => ({ location, collisionRadius: pawnRadius, collisionHeight: pawnHalfHeight });
const wallWorld = () => collisionWorldFromFixtures(emptyChunkArrays(), wallTreeArrays());

interface DeclaredMove {
  readonly start: Vector3;
  readonly delta: Vector3;
}

const declaredWallMoves: readonly DeclaredMove[] = [
  { start: { x: 0, y: 0, z: 0 }, delta: { x: 300, y: 0, z: 0 } },
  { start: { x: 0, y: 0, z: 0 }, delta: { x: 100, y: 0, z: 0 } },
  { start: { x: 0, y: 40, z: 16 }, delta: { x: 300, y: 120, z: 0 } },
  { start: { x: 600, y: -64, z: 0 }, delta: { x: -400, y: 0, z: 0 } },
  { start: { x: 230, y: 0, z: 0 }, delta: { x: 40, y: 0, z: 0 } },
];

const goldenColumns = ["input", "hit", "time", "locationX", "locationY", "locationZ", "normalX", "normalY", "normalZ"];

function wallTraceRow(inputIndex: number, result: MoveActorResult): number[] {
  const hit = result.hit;
  return [inputIndex, hit === null ? 0 : 1, hit?.time ?? 1, result.location.x, result.location.y, result.location.z,
    hit?.normal.x ?? 0, hit?.normal.y ?? 0, hit?.normal.z ?? 0];
}

function wallGoldenTrace(): GoldenTrace {
  const world = wallWorld();
  return {
    seed: 0, stepSeconds: 1, columns: goldenColumns,
    rows: declaredWallMoves.map((move, inputIndex) => wallTraceRow(inputIndex, moveActor(world, actorAt(move.start), move.delta, rules))),
  };
}

describe("moveActor against converted BSP collision", () => {
  it("stops a cylinder at the wall, backed off by the BSP box backoff and the 2-unit extension, with the wall normal and source", () => {
    const result = moveActor(wallWorld(), actorAt({ x: 0, y: 0, z: 0 }), { x: 300, y: 0, z: 0 }, rules);
    expect(result.hit).not.toBeNull();
    expect(result.hit!.primitive).toEqual({ kind: "bsp-tree", tileId: fixtureTileId });
    expect(result.hit!.source).toBe("bsp-collision-tree");
    expect(result.hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
    const wallFace = 256, testLength = 302, boxBackoff = rules.backoff.bspBox.maximum;
    expect(boxBackoff).toBe(4);
    expect(result.location.x).toBeCloseTo(wallFace - pawnRadius - boxBackoff - rules.moveActorExtension, 4);
    expect(result.hit!.time).toBeCloseTo((wallFace - pawnRadius - boxBackoff - rules.moveActorExtension) / 300, 6);
    expect(Math.min(Math.max(0.1 * testLength, 0.1), 4)).toBe(boxBackoff);
    expect(result.location).toEqual({ x: result.location.x, y: 0, z: 0 });
  });

  it("returns the full delta when the move misses every primitive", () => {
    const result = moveActor(wallWorld(), actorAt({ x: 0, y: 0, z: 0 }), { x: 100, y: 25, z: -3 }, rules);
    expect(result).toEqual({ location: { x: 100, y: 25, z: -3 }, hit: null });
  });

  it("adds a near-zero delta without a sweep", () => {
    const start = { x: 247.5, y: 0, z: 0 };
    const result = moveActor(wallWorld(), actorAt(start), { x: 0.00005, y: 0, z: 0 }, rules);
    expect(result).toEqual({ location: { x: Math.fround(247.5 + Math.fround(0.00005)), y: 0, z: 0 }, hit: null });
  });

  it("stops at a pawn cylinder before the wall with the cylinder time offset and no backoff", () => {
    const pawns = [{ location: { x: 200, y: 600, z: 0 }, collisionRadius: pawnRadius, collisionHeight: pawnHalfHeight }];
    const result = moveActor(wallWorld(), actorAt({ x: 0, y: 600, z: 0 }), { x: 300, y: 0, z: 0 }, rules, { pawns });
    expect(result.hit).toMatchObject({ primitive: { kind: "pawn", pawnIndex: 0 }, source: "pawn-cylinder", normal: { x: -1, y: 0, z: 0 } });
    const widenedRadius = 2 * pawnRadius, testLength = 302;
    expect(result.location.x).toBeCloseTo(200 - widenedRadius - rules.cylinderTimeOffset * testLength - rules.moveActorExtension, 3);
  });

  it("pins every declared wall move in a float32 golden trace that a second run reproduces byte for byte", () => {
    const firstTrace = wallGoldenTrace(), secondTrace = wallGoldenTrace();
    expect(JSON.stringify(secondTrace)).toBe(JSON.stringify(firstTrace));
    expectMovementGoldenTrace("move-actor-bsp-wall.golden.json", firstTrace);
  });
});

describe("traceCylinder", () => {
  const pawn = { location: { x: 0, y: 0, z: 0 }, collisionRadius: 10, collisionHeight: 20 };
  const zeroExtent = { x: 0, y: 0, z: 0 };

  it("hits the side at the analytic time minus the offset with a radial normal", () => {
    const hit = traceCylinder(pawn, { start: { x: -100, y: 0, z: 0 }, end: { x: 100, y: 0, z: 0 }, extent: zeroExtent }, rules);
    expect(hit!.time).toBeCloseTo(90 / 200 - rules.cylinderTimeOffset, 12);
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it("hits the top cap from above with an up normal", () => {
    const hit = traceCylinder(pawn, { start: { x: 2, y: 0, z: 100 }, end: { x: 2, y: 0, z: -100 }, extent: zeroExtent }, rules);
    expect(hit!.time).toBeCloseTo(80 / 200 - rules.cylinderTimeOffset, 12);
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("returns t = 0 for a start inside that moves inward and misses one that moves outward", () => {
    const inward = traceCylinder(pawn, { start: { x: 9, y: 0, z: 0 }, end: { x: -9, y: 0, z: 0 }, extent: zeroExtent }, rules);
    expect(inward).toEqual({ time: 0, normal: { x: 1, y: 0, z: 0 } });
    expect(traceCylinder(pawn, { start: { x: 9, y: 0, z: 0 }, end: { x: 40, y: 0, z: 0 }, extent: zeroExtent }, rules)).toBeNull();
  });
});

describe("movement native rules recipe", () => {
  it("gives every row a provenance and a status from the shared vocabulary and keeps every row unconfirmed or weaker", () => {
    expect(rules.rows.length).toBeGreaterThan(0);
    for (const row of rules.rows) {
      expect(row.provenance.length).toBeGreaterThan(0);
      expect(["ue2-data", "unconfirmed", "unknown"]).toContain(row.status);
      expect(row.interludeEvidence).toBeNull();
    }
    expect(rules.rows.map(row => row.id)).toEqual(expect.arrayContaining(["movement.maxStepHeight", "movement.minFloorZ"]));
  });

  it("refuses a status outside the shared vocabulary, a missing provenance and a confirmed row without Interlude evidence", () => {
    const document = readCommittedMovementRulesDocument() as { rows: Record<string, unknown>[] };
    const withFirstRow = (change: Record<string, unknown>) => ({ ...document, rows: [{ ...document.rows[0], ...change }, ...document.rows.slice(1)] });
    expect(() => parseMovementNativeRules(withFirstRow({ status: "guessed" }))).toThrow(MovementRulesError);
    expect(() => parseMovementNativeRules(withFirstRow({ provenance: " " }))).toThrow(/needs a provenance/);
    expect(() => parseMovementNativeRules(withFirstRow({ status: "confirmed-interlude" }))).toThrow(/without interludeEvidence/);
    expect(() => parseMovementNativeRules({ ...document, rows: [...document.rows, document.rows[0]] })).toThrow(/twice/);
  });
});

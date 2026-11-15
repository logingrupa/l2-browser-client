import { describe, expect, it } from "vitest";
import type { Vector3 } from "../../src/shared/math/vector3";
import { CollisionWorldError } from "../../src/scene/world/movement/core/collisionWorld";
import { singleLineCheck, type LineCheckHit, type LineCheckQuery } from "../../src/scene/world/movement/core/lineCheck";
import { hitTimeAfterBackoff, type CollisionBackoffRule } from "../../src/scene/world/movement/core/movementRules";
import type { GoldenTrace } from "../support/goldenTrace";
import { replaceFixtureArray } from "../support/nativeTileCollisionFixture";
import {
  collisionWorldFromFixtures, committedMovementRules, emptyChunkArrays, expectMovementGoldenTrace, fixtureCellId, fixtureTileId, flatTerrainZ,
  hiddenQuadIndex, mixedChunkArrays, moverExportIndex, raisedTerrainZ, terrainWorldPoint, turnedQuadIndex, wallTreeArrays,
} from "../fixtures/movement/movementCollisionFixtures";

const rules = committedMovementRules();
const zeroExtent = { x: 0, y: 0, z: 0 };
const mixedWorld = (turnedQuad = false) => collisionWorldFromFixtures(mixedChunkArrays({ turnedQuad }), null);
const downRay = (x: number, y: number, fromZ = 2000, toZ = -2000): LineCheckQuery =>
  ({ start: { x, y, z: fromZ }, end: { x, y, z: toZ }, extent: zeroExtent });
const rayBackoffUnits = 0.5;
const staticMeshMaximumBackoffUnits = 1;
const terrainBackoffUnits = 0.5;
const up = { x: 0, y: 0, z: 1 };

describe("singleLineCheck over every converted primitive kind", () => {
  it("hits the nearest of a blocking volume, a static mesh triangle and a terrain quad stacked under one ray", () => {
    const world = mixedWorld();
    const volumeHit = singleLineCheck(world, downRay(1600, -2400), rules);
    expect(volumeHit).toMatchObject({ source: "blocking-volume", primitive: { kind: "volume", cellId: fixtureCellId, volumeIndex: 0 }, normal: up });
    expect(volumeHit!.location.z).toBeCloseTo(300 + 128 + rayBackoffUnits, 3);
    const meshHit = singleLineCheck(world, downRay(1600, -2400, 150), rules);
    expect(meshHit).toMatchObject({ source: "static-mesh-slots", primitive: { kind: "static-mesh", placementIndex: 0, exportIndex: 512 }, normal: up });
    expect(meshHit!.location.z).toBeCloseTo(40 + staticMeshMaximumBackoffUnits, 3);
    const terrainHit = singleLineCheck(world, downRay(1600, -2400, 30), rules);
    expect(terrainHit).toMatchObject({ source: "terrain-heightmap", primitive: { kind: "terrain", cellId: fixtureCellId, quadIndex: 4 }, normal: up });
    expect(terrainHit!.location.z).toBeCloseTo(flatTerrainZ + terrainBackoffUnits, 3);
  });

  it("passes a quad hidden by QuadVisibilityBitmap and lets EdgeTurnBitmap pick the triangle split", () => {
    const hidden = terrainWorldPoint(0.5, 1.5);
    expect(hiddenQuadIndex).toBe(3);
    expect(singleLineCheck(mixedWorld(), downRay(hidden.x, hidden.y), rules)).toBeNull();
    const probe = terrainWorldPoint(2.75, 1.5);
    const straightSplit = singleLineCheck(mixedWorld(false), downRay(probe.x, probe.y), rules)!;
    const turnedSplit = singleLineCheck(mixedWorld(true), downRay(probe.x, probe.y), rules)!;
    expect(straightSplit.primitive).toEqual({ kind: "terrain", cellId: fixtureCellId, quadIndex: turnedQuadIndex });
    expect(turnedSplit.primitive).toEqual({ kind: "terrain", cellId: fixtureCellId, quadIndex: turnedQuadIndex });
    const rise = raisedTerrainZ - flatTerrainZ;
    expect(straightSplit.location.z).toBeCloseTo(flatTerrainZ + 0.75 * rise - 0.5 * rise + rayBackoffUnits, 2);
    expect(turnedSplit.location.z).toBeCloseTo(flatTerrainZ + 0.5 * rise + rayBackoffUnits, 2);
  });

  it("collides a mover at its closed matrix by default and at the open matrix when that state is passed", () => {
    const world = mixedWorld();
    const closed = singleLineCheck(world, downRay(3100, -2400), rules)!;
    expect(closed).toMatchObject({ source: "static-slot-enable-collision", primitive: { kind: "mover", moverIndex: 0, exportIndex: moverExportIndex } });
    expect(closed.location.z).toBeCloseTo(40 + staticMeshMaximumBackoffUnits, 3);
    const open = singleLineCheck(world, { ...downRay(3100, -2400), moverStates: new Map([[moverExportIndex, "open"]]) }, rules)!;
    expect(open.location.z).toBeCloseTo(176 + staticMeshMaximumBackoffUnits, 3);
  });

  it("splits a ray at BSP planes and returns the entry into solid space with the last splitter's normal facing the start", () => {
    const world = collisionWorldFromFixtures(emptyChunkArrays(), wallTreeArrays());
    const fromNear = singleLineCheck(world, { start: { x: 0, y: 0, z: 0 }, end: { x: 512, y: 0, z: 0 }, extent: zeroExtent }, rules)!;
    expect(fromNear).toMatchObject({ source: "bsp-collision-tree", primitive: { kind: "bsp-tree", tileId: fixtureTileId }, normal: { x: -1, y: 0, z: 0 } });
    expect(fromNear.location.x).toBeCloseTo(256 - rayBackoffUnits, 4);
    const fromFar = singleLineCheck(world, { start: { x: 512, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, extent: zeroExtent }, rules)!;
    expect(fromFar.normal).toEqual({ x: 1, y: 0, z: 0 });
    expect(fromFar.location.x).toBeCloseTo(320 + rayBackoffUnits, 4);
    expect(singleLineCheck(world, { start: { x: 0, y: 0, z: 0 }, end: { x: 200, y: 0, z: 0 }, extent: zeroExtent }, rules)).toBeNull();
  });

  it("hits at time 0 for a ray that starts in solid, with the root splitter normal turned against the motion as UModel::LineCheck does", () => {
    const world = collisionWorldFromFixtures(emptyChunkArrays(), wallTreeArrays());
    const outward = singleLineCheck(world, { start: { x: 280, y: 0, z: 0 }, end: { x: 500, y: 0, z: 0 }, extent: zeroExtent }, rules)!;
    expect(outward).toMatchObject({ time: 0, location: { x: 280, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } });
    const inward = singleLineCheck(world, { start: { x: 280, y: 0, z: 0 }, end: { x: 100, y: 0, z: 0 }, extent: zeroExtent }, rules)!;
    expect(inward).toMatchObject({ time: 0, location: { x: 280, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } });
  });

  it.each([
    ["a plane reference past the node array", () => [0, 5, -1], /tile 90_90 BSPT\.leafHulls\[1\] names node 5 of 2/],
    ["as many plane references as the hull plane limit", () => [...Array.from({ length: rules.hullPlaneLimit }, () => 0), -1],
      new RegExp(`tile 90_90 BSPT\.leafHulls run at 0 reaches ${rules.hullPlaneLimit} planes`)],
  ])("refuses a box sweep into a BSP leaf hull run with %s", (_case, planeReferences, message) => {
    const wallTree = wallTreeArrays(), wallLeafHulls = wallTree.find(array => array.name === "BSPT.leafHulls")!.values;
    const hullBoxWords = wallLeafHulls.slice(wallLeafHulls.indexOf(-1) + 1);
    const world = collisionWorldFromFixtures(emptyChunkArrays(), replaceFixtureArray(wallTree, "BSPT.leafHulls", [...planeReferences(), ...hullBoxWords]));
    const crossWall = () => singleLineCheck(world, { start: { x: 0, y: 0, z: 0 }, end: { x: 512, y: 0, z: 0 }, extent: { x: 9, y: 9, z: 23 } }, rules);
    expect(crossWall).toThrow(CollisionWorldError);
    expect(crossWall).toThrow(message);
  });

  it("lands a box sweep on flat terrain with its bottom on the lifted triangle", () => {
    const point = terrainWorldPoint(0.5, 0.5);
    const hit = singleLineCheck(mixedWorld(), { start: { x: point.x, y: point.y, z: 500 }, end: { x: point.x, y: point.y, z: -500 }, extent: { x: 9, y: 9, z: 23 } }, rules)!;
    expect(hit.source).toBe("terrain-heightmap");
    expect(hit.location.z).toBeCloseTo(flatTerrainZ + 23 + terrainBackoffUnits, 3);
  });

  it("pins the declared line checks in a float32 golden trace", () => {
    const declaredQueries: readonly LineCheckQuery[] = [
      downRay(1600, -2400), downRay(1600, -2400, 150), downRay(1600, -2400, 30), downRay(3100, -2400),
      { ...downRay(3100, -2400), moverStates: new Map([[moverExportIndex, "open"]]) },
      { start: { x: 1600, y: -2600, z: 300 }, end: { x: 1600, y: -2200, z: 300 }, extent: { x: 9, y: 9, z: 23 } },
      { start: { x: 1700, y: -2380, z: 120 }, end: { x: 1700, y: -2380, z: -60 }, extent: { x: 9, y: 9, z: 23 } },
    ];
    const world = mixedWorld();
    const traceRow = (queryIndex: number, hit: LineCheckHit | null) => {
      const location: Vector3 = hit?.location ?? zeroExtent, normal: Vector3 = hit?.normal ?? zeroExtent;
      return [queryIndex, hit === null ? 0 : 1, hit?.time ?? 1, location.x, location.y, location.z, normal.x, normal.y, normal.z];
    };
    const trace: GoldenTrace = {
      seed: 0, stepSeconds: 1, columns: ["query", "hit", "time", "locationX", "locationY", "locationZ", "normalX", "normalY", "normalZ"],
      rows: declaredQueries.map((query, queryIndex) => traceRow(queryIndex, singleLineCheck(world, query, rules))),
    };
    expectMovementGoldenTrace("line-check-mixed-primitives.golden.json", trace);
  });
});

describe("hitTimeAfterBackoff", () => {
  const fixedHalfUnit: CollisionBackoffRule = { kind: "fixed-distance", distance: 0.5 };

  it("reads the Interlude backoff rules from the recipe", () => {
    expect(rules.backoff).toEqual({
      bspRay: fixedHalfUnit,
      bspBox: { kind: "clamped-fraction", fraction: Math.fround(0.1), minimumDistance: Math.fround(0.1), maximumDistance: 4 },
      staticMesh: { kind: "clamped-fraction", fraction: Math.fround(0.1), minimumDistance: Math.fround(0.1), maximumDistance: staticMeshMaximumBackoffUnits },
      terrain: { kind: "fixed-distance", distance: terrainBackoffUnits },
      pawnCylinder: { kind: "fixed-distance", distance: 0 },
    });
  });

  it("subtracts a fixed distance over the trace length in double precision and stores a float, as UModel::LineCheck does for rays", () => {
    expect(hitTimeAfterBackoff(fixedHalfUnit, 0.5, 512)).toBe(Math.fround(0.5 - 0.5 / 512));
    expect(hitTimeAfterBackoff(fixedHalfUnit, Math.fround(0.001), 1)).toBe(0);
  });

  it("clamps the 0.1 fraction between the float minimum and maximum distance over the trace length", () => {
    const bspBox = rules.backoff.bspBox, hitTime = Math.fround(0.75);
    expect(hitTimeAfterBackoff(bspBox, hitTime, 0.5)).toBe(Math.fround(hitTime - Math.fround(Math.fround(0.1) / 0.5)));
    expect(hitTimeAfterBackoff(bspBox, hitTime, 10)).toBe(Math.fround(hitTime - Math.fround(0.1)));
    expect(hitTimeAfterBackoff(bspBox, hitTime, 302)).toBe(Math.fround(hitTime - Math.fround(4 / 302)));
  });
});

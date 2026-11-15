import { describe, expect, it } from "vitest";
import { pointCheck } from "../../src/scene/world/movement/core/pointCheck";
import { volumesContaining } from "../../src/scene/world/movement/core/volumeContainment";
import { replaceFixtureArray } from "../support/nativeTileCollisionFixture";
import {
  collisionWorldFromFixtures, committedMovementRules, emptyChunkArrays, fixtureCellId, fixtureTileId, flatTerrainZ, mixedChunkArrays, moverExportIndex,
  terrainWorldPoint, waterPhysicsVolume, wallTreeArrays,
} from "../fixtures/movement/movementCollisionFixtures";

const rules = committedMovementRules();
const zeroExtent = { x: 0, y: 0, z: 0 };
const pawnExtent = { x: 9, y: 9, z: 23 };
const wallWorld = (treeArrays = wallTreeArrays()) => collisionWorldFromFixtures(emptyChunkArrays(), treeArrays);
const mixedWorld = () => collisionWorldFromFixtures(mixedChunkArrays(), null);
const bspHit = { primitive: { kind: "bsp-tree", tileId: fixtureTileId }, source: "bsp-collision-tree" };

describe("pointCheck over the BSP tree", () => {
  it("sends a point exactly on a plane to the back child, so the wall faces are solid", () => {
    expect(pointCheck(wallWorld(), { point: { x: 320, y: 0, z: 0 }, extent: zeroExtent }, rules)).toEqual(bspHit);
    expect(pointCheck(wallWorld(), { point: { x: 256, y: 0, z: 0 }, extent: zeroExtent }, rules)).toEqual(bspHit);
    expect(pointCheck(wallWorld(), { point: { x: 255.9, y: 0, z: 0 }, extent: zeroExtent }, rules)).toBeNull();
    expect(pointCheck(wallWorld(), { point: { x: 320.1, y: 0, z: 0 }, extent: zeroExtent }, rules)).toBeNull();
  });

  it("starts the outside bit at bRootOutside, so a region reached only through non-csg nodes is solid when the root is inside", () => {
    const notCsgTree = replaceFixtureArray(wallTreeArrays(), "BSPT.nodeFlags", [1, 1]);
    const rootInsideTree = replaceFixtureArray(notCsgTree, "BSPT.rootOutside", [0]);
    expect(pointCheck(wallWorld(notCsgTree), { point: { x: 0, y: 0, z: 0 }, extent: zeroExtent }, rules)).toBeNull();
    expect(pointCheck(wallWorld(rootInsideTree), { point: { x: 0, y: 0, z: 0 }, extent: zeroExtent }, rules)).toEqual(bspHit);
    expect(pointCheck(wallWorld(), { point: { x: 300, y: 0, z: 0 }, extent: zeroExtent }, rules)).toEqual(bspHit);
  });

  it("overlaps a pawn box with the leaf hull it reaches and clears one that stays short of it", () => {
    expect(pointCheck(wallWorld(), { point: { x: 250, y: 0, z: 0 }, extent: pawnExtent }, rules)).toEqual(bspHit);
    expect(pointCheck(wallWorld(), { point: { x: 240, y: 0, z: 0 }, extent: pawnExtent }, rules)).toBeNull();
  });
});

describe("pointCheck over volumes, static meshes, movers, terrain and pawns", () => {
  it("finds the blocking volume around a point and ignores the non-blocking physics volume", () => {
    expect(pointCheck(mixedWorld(), { point: { x: 1600, y: -2400, z: 300 }, extent: zeroExtent }, rules))
      .toEqual({ primitive: { kind: "volume", cellId: fixtureCellId, volumeIndex: 0, exportIndex: 900 }, source: "blocking-volume" });
    expect(pointCheck(mixedWorld(), { point: { x: -1000, y: 0, z: 0 }, extent: zeroExtent }, rules)).toBeNull();
  });

  it("overlaps a box straddling a static mesh triangle and a mover at the state it is given", () => {
    expect(pointCheck(mixedWorld(), { point: { x: 1600, y: -2400, z: 50 }, extent: pawnExtent }, rules))
      .toMatchObject({ primitive: { kind: "static-mesh", placementIndex: 0 }, source: "static-mesh-slots" });
    const besideClosedMover = { point: { x: 3100, y: -2400, z: 180 }, extent: pawnExtent };
    expect(pointCheck(mixedWorld(), besideClosedMover, rules)).toBeNull();
    expect(pointCheck(mixedWorld(), { ...besideClosedMover, moverStates: new Map([[moverExportIndex, "open"]]) }, rules))
      .toMatchObject({ primitive: { kind: "mover", exportIndex: moverExportIndex }, source: "static-slot-enable-collision" });
  });

  it("checks terrain with a vertical segment through the box and a pawn with the widened cylinder", () => {
    const point = terrainWorldPoint(0.5, 0.5);
    expect(pointCheck(mixedWorld(), { point: { ...point, z: flatTerrainZ + 20 }, extent: pawnExtent }, rules))
      .toEqual({ primitive: { kind: "terrain", cellId: fixtureCellId, quadIndex: 0 }, source: "terrain-heightmap" });
    expect(pointCheck(mixedWorld(), { point: { ...point, z: flatTerrainZ + 30 }, extent: pawnExtent }, rules)).toBeNull();
    const pawns = [{ location: { x: 0, y: 0, z: 0 }, collisionRadius: 9, collisionHeight: 23 }];
    expect(pointCheck(mixedWorld(), { point: { x: 17, y: 0, z: 0 }, extent: pawnExtent, pawns }, rules))
      .toEqual({ primitive: { kind: "pawn", pawnIndex: 0 }, source: "pawn-cylinder" });
    expect(pointCheck(mixedWorld(), { point: { x: 19, y: 0, z: 0 }, extent: pawnExtent, pawns }, rules)).toBeNull();
  });
});

describe("volumesContaining", () => {
  it("returns the rotated and scaled water physics volume around a point and nothing outside it", () => {
    const [centreX, centreY, centreZ] = waterPhysicsVolume.location;
    const inside = volumesContaining(mixedWorld(), { x: centreX + 300, y: centreY, z: centreZ + 50 }, rules);
    expect(inside.map(containing => [containing.cellId, containing.volumeIndex, containing.volume.kind]))
      .toEqual([[fixtureCellId, 1, "physics"]]);
    expect(volumesContaining(mixedWorld(), { x: centreX + 380, y: centreY, z: centreZ }, rules)).toEqual([]);
    expect(volumesContaining(mixedWorld(), { x: centreX, y: centreY, z: centreZ + 140 }, rules)).toEqual([]);
    expect(volumesContaining(mixedWorld(), { x: 1600, y: -2400, z: 300 }, rules)).toEqual([]);
  });
});

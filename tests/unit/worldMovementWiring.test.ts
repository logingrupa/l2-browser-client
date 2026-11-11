import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldCommand, WorldEvent } from "../../src/world/worldTypes";
import type { WorldPosition } from "../../src/world/sourceFrame";
import { createCollisionWorld, type CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import { decodeNativeTileCollisionCell } from "../../src/scene/world/movement/core/decodeNativeTileCollision";
import { wireWorldMovement, type WorldMovement } from "../../src/runtime/worldMovementWiring";
import type { TileCollisionLoad } from "../../src/runtime/tileCollisionCells";
import { createCollisionWorldNavigation } from "../../src/runtime/collisionWorldNavigation";
import { readCollisionFixturePayload } from "../support/nativeTileCollisionFixture";
import { emptyChunkArrays, fixtureCellId, fixtureTileId, volumeArrays, type BoxVolumeDeclaration } from "../fixtures/movement/movementCollisionFixtures";
import { blockingBox, committedMoveTypes, floorSlab, pawnRules } from "../fixtures/movement/pawnWorldFixtures";

const localPlayerId = "local-player";
const frameSeconds = 1 / 60;
const fixtureFootprint = { minimumX: -4096, minimumY: -4096, maximumX: 4096, maximumY: 4096 };
const loadedBounds = { minimum: { x: -20, y: -5, z: -20 }, maximum: { x: 20, y: 5, z: 20 } };
const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });

function boxCellLoader(boxes: readonly BoxVolumeDeclaration[]) {
  let resolveLoad!: () => void;
  const gate = new Promise<void>(resolve => { resolveLoad = resolve; });
  const load = async (world: CollisionWorld): Promise<TileCollisionLoad> => {
    await gate;
    const otherArrays = emptyChunkArrays().filter(array => !array.name.startsWith("VOLS."));
    world.requireCell(fixtureCellId, fixtureFootprint);
    world.addCell(fixtureCellId, decodeNativeTileCollisionCell(readCollisionFixturePayload([...volumeArrays(boxes), ...otherArrays]), { cellId: fixtureCellId, tileId: fixtureTileId }));
    return { tileId: fixtureTileId, residentCellIds: [fixtureCellId], chunkGaps: [] };
  };
  return { load, resolveLoad };
}

async function wiredWorld(boxes: readonly BoxVolumeDeclaration[] = [floorSlab(0)], origin: WorldPosition = { x: 0, y: 0, z: 0 }) {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new ArcRotateCamera("follow", Math.PI / 2, Math.PI / 3, 4, new Vector3(0, 1, 0), scene);
  const adapter = new NativeSliceAdapter(origin, null, undefined, { walkSupported: true, collision: { radius: 9, height: 23 }, moveTypes: committedMoveTypes });
  const commands: WorldCommand[] = [];
  adapter.subscribeCommands(command => commands.push(command));
  const loader = boxCellLoader(boxes);
  const movement = wireWorldMovement({ adapter, camera, rules: pawnRules, collisionWorld: createCollisionWorld(), loadCollisionCells: loader.load,
    loadedBounds, localPlayerId, localWalkAnimationFramesInMove: null, signal: new AbortController().signal });
  releases.push(() => { movement.release(); adapter.dispose(); scene.dispose(); engine.dispose(); });
  const advanceFrames = (count: number) => { for (let frame = 0; frame < count; frame += 1) movement.advance(frameSeconds); };
  const settle = async () => { loader.resolveLoad(); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { scene, camera, adapter, commands, movement, advanceFrames, settle };
}

const playerOf = (adapter: NativeSliceAdapter) => adapter.getInitialState().find(entity => entity.id === localPlayerId)!;
const reportsIn = (commands: readonly WorldCommand[]) => commands.filter(command => command.type === "report-position" || command.type === "cannot-move");

describe("world movement wiring", () => {
  it("holds every pawn until the tile cells are resident and reports the cell counts in the snapshot field", async () => {
    const { adapter, movement, advanceFrames, settle } = await wiredWorld();
    expect(movement.inspection().collisionCells).toMatchObject({ status: "loading", requiredCellCount: 0, residentCellCount: 0, missingCellIds: [] });
    adapter.dispatch({ type: "move-local", position: { x: 2, y: 0, z: 0 } });
    advanceFrames(30);
    expect(movement.pose(localPlayerId)).toMatchObject({ feetPosition: { x: 0, y: 0, z: 0 }, isMoving: true });
    await settle();
    expect(movement.inspection().collisionCells).toMatchObject({ status: "resident", failure: null, requiredCellCount: 1, residentCellCount: 1, missingCellIds: [],
      load: { tileId: fixtureTileId, residentCellIds: [fixtureCellId], chunkGaps: [] } });
    expect(movement.inspection().collisionCells.revision).toBeGreaterThan(0);
  });

  it("walks the local pawn on an adapter move record through the port and sends its positions back as intents", async () => {
    const { adapter, commands, movement, advanceFrames, settle } = await wiredWorld();
    await settle();
    adapter.dispatch({ type: "move-local", position: { x: 2, y: 0, z: 0 } });
    advanceFrames(90);
    const midway = movement.pose(localPlayerId)!;
    expect(midway.isMoving).toBe(true);
    expect(midway.feetPosition.x).toBeGreaterThan(.3);
    expect(reportsIn(commands).map(command => command.type)).toContain("report-position");
    expect(playerOf(adapter).position.x).toBeGreaterThan(0);
    advanceFrames(60 * 6);
    const arrived = movement.pose(localPlayerId)!;
    expect(arrived.isMoving).toBe(false);
    expect(arrived.feetPosition.x).toBeCloseTo(2, 1);
    expect(arrived.feetPosition.y).toBeCloseTo(0, 1);
    expect(playerOf(adapter).position.x).toBeCloseTo(arrived.feetPosition.x, 5);
    const inspection = movement.inspection();
    expect(inspection.lastLocalDestination).toEqual({ x: 2, y: 0, z: 0 });
    expect(inspection.dispatchedIntentCounts["report-position"]).toBe(reportsIn(commands).filter(command => command.type === "report-position").length);
    expect(inspection.dispatchedIntentCounts["cannot-move"]).toBe(0);
  });

  it("stops the pawn at a wall and reports cannot-move instead of routing around it", async () => {
    const { adapter, commands, movement, advanceFrames, settle } = await wiredWorld([floorSlab(0), blockingBox([100, 0, 64], [16, 512, 64])]);
    await settle();
    adapter.dispatch({ type: "move-local", position: { x: 3, y: 0, z: 0 } });
    advanceFrames(60 * 6);
    expect(movement.pose(localPlayerId)!.feetPosition.x).toBeLessThan(.84);
    expect(reportsIn(commands).some(command => command.type === "cannot-move")).toBe(true);
  });

  it("does not advance any pawn when the cell load fails, and names the failure", async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const camera = new ArcRotateCamera("follow", 0, 1, 4, Vector3.Zero(), scene);
    const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 }, null, undefined, { walkSupported: true, collision: { radius: 9, height: 23 }, moveTypes: committedMoveTypes });
    const movement: WorldMovement = wireWorldMovement({ adapter, camera, rules: pawnRules, collisionWorld: createCollisionWorld(),
      loadCollisionCells: () => Promise.reject(new Error("tile 90_90 collision is not staged")), loadedBounds, localPlayerId,
      localWalkAnimationFramesInMove: null, signal: new AbortController().signal });
    releases.push(() => { movement.release(); adapter.dispose(); scene.dispose(); engine.dispose(); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(movement.inspection().collisionCells).toMatchObject({ status: "failed", failure: "tile 90_90 collision is not staged" });
    adapter.dispatch({ type: "move-local", position: { x: 2, y: 0, z: 0 } });
    movement.advance(1);
    expect(movement.pose(localPlayerId)!.feetPosition.x).toBe(0);
  });

  it("treats a loader that leaves the cells to a streaming section as resident with no whole-tile load", async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const camera = new ArcRotateCamera("follow", 0, 1, 4, Vector3.Zero(), scene);
    const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 }, null, undefined, { walkSupported: true, collision: { radius: 9, height: 23 }, moveTypes: committedMoveTypes });
    const movement = wireWorldMovement({ adapter, camera, rules: pawnRules, collisionWorld: createCollisionWorld(), loadCollisionCells: () => Promise.resolve(null),
      loadedBounds, localPlayerId, localWalkAnimationFramesInMove: null, signal: new AbortController().signal });
    releases.push(() => { movement.release(); adapter.dispose(); scene.dispose(); engine.dispose(); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(movement.inspection().collisionCells).toMatchObject({ status: "resident", failure: null, load: null });
  });

  it("answers a click ray and the vertical probe with zero-extent traces through the collision world", async () => {
    const { movement, settle } = await wiredWorld();
    expect(movement.destinationAlongRay({ x: 1, y: 3, z: 0 }, { x: 0, y: -1, z: 0 })).toBeNull();
    expect(movement.collisionSurfaceHeightsAt(1, 0)).toEqual([]);
    await settle();
    const destination = movement.destinationAlongRay({ x: 1, y: 3, z: .5 }, { x: 0, y: -1, z: 0 })!;
    expect(destination.x).toBeCloseTo(1, 4); expect(destination.y).toBeCloseTo(0, 1); expect(destination.z).toBeCloseTo(.5, 4);
    expect(movement.destinationAlongRay({ x: 1, y: 3, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    const [height] = movement.collisionSurfaceHeightsAt(1, .5);
    expect(height).toBeCloseTo(0, 1);
    expect(movement.collisionSurfaceHeightsAt(30, 30)).toEqual([]);
    expect(() => movement.collisionSurfaceHeightsAt(Number.NaN, 0)).toThrow(RangeError);
  });

  it("finds the floor under a vertical probe when the loaded bounds are flat at the floor height", async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const camera = new ArcRotateCamera("follow", 0, 1, 4, Vector3.Zero(), scene);
    const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 }, null, undefined, { walkSupported: true, collision: { radius: 9, height: 23 }, moveTypes: committedMoveTypes });
    const loader = boxCellLoader([floorSlab(0)]);
    const flatBounds = { minimum: { x: -20, y: 0, z: -20 }, maximum: { x: 20, y: 0, z: 20 } };
    const movement = wireWorldMovement({ adapter, camera, rules: pawnRules, collisionWorld: createCollisionWorld(), loadCollisionCells: loader.load,
      loadedBounds: flatBounds, localPlayerId, localWalkAnimationFramesInMove: null, signal: new AbortController().signal });
    releases.push(() => { movement.release(); adapter.dispose(); scene.dispose(); engine.dispose(); });
    loader.resolveLoad();
    await new Promise(resolve => setTimeout(resolve, 0));
    const [height] = movement.collisionSurfaceHeightsAt(1, .5);
    expect(height).toBeCloseTo(0, 1);
  });

  it("counts a malformed or unknown-entity movement record instead of throwing out of the adapter", () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const camera = new ArcRotateCamera("follow", 0, 1, 4, Vector3.Zero(), scene);
    let emit!: (event: WorldEvent) => void;
    const movement = wireWorldMovement({ camera, rules: pawnRules, collisionWorld: createCollisionWorld(),
      adapter: { subscribe(listener) { emit = listener; return () => {}; }, dispatch() {} },
      loadCollisionCells: boxCellLoader([floorSlab(0)]).load, loadedBounds, localPlayerId, localWalkAnimationFramesInMove: null, signal: new AbortController().signal });
    releases.push(() => { movement.release(); scene.dispose(); engine.dispose(); });
    expect(() => emit({ type: "stop", entityId: "nobody", position: { x: 0, y: 0, z: 0 }, heading: 0 })).not.toThrow();
    expect(() => emit({ type: "move", entityId: "remote", origin: { x: Number.NaN, y: 0, z: 0 }, destination: { x: 0, y: 0, z: 0 }, moveType: 1,
      speeds: { walk: 80, run: 115 }, collision: { radius: 9, height: 23 } })).not.toThrow();
    emit({ type: "skill-cast", casterId: "remote", skillId: 3, level: 1 });
    expect(movement.inspection()).toMatchObject({ rejectedRecordCount: 2, lastRejectedRecord: expect.stringContaining("remote move origin") });
    expect(movement.inspection().presenter.pawns).toEqual([]);
  });

  it("pulls the follow camera in front of a wall behind the pivot and restores the zoom when the wall is gone", async () => {
    const { camera, movement, settle } = await wiredWorld([floorSlab(0), blockingBox([0, 200, 100], [512, 16, 128])]);
    await settle();
    camera.alpha = Math.PI / 2; camera.beta = Math.PI / 2; camera.radius = 4; camera.setTarget(new Vector3(0, 1, 0));
    movement.constrainFollowCamera();
    const blocked = movement.inspection().followCamera;
    expect(blocked.desiredRadius).toBe(4);
    expect(blocked.hitDistance).not.toBeNull();
    expect(camera.radius).toBeLessThan(2);
    camera.alpha = -Math.PI / 2;
    movement.constrainFollowCamera();
    expect(movement.inspection().followCamera).toMatchObject({ desiredRadius: 4, hitDistance: null });
    expect(camera.radius).toBeCloseTo(4, 5);
    camera.radius = 6;
    movement.constrainFollowCamera();
    expect(movement.inspection().followCamera.desiredRadius).toBe(6);
  });

  it("keeps the follow camera zoom across camera updates when the wall-clamped radius falls below the camera lower radius limit", async () => {
    const { camera, movement, settle } = await wiredWorld([floorSlab(0), blockingBox([0, 40, 100], [512, 16, 128])]);
    await settle();
    camera.lowerRadiusLimit = .4;
    camera.alpha = Math.PI / 2; camera.beta = Math.PI / 2; camera.radius = 4; camera.setTarget(new Vector3(0, 1, 0));
    movement.constrainFollowCamera();
    camera.update();
    movement.constrainFollowCamera();
    camera.update();
    expect(camera.radius).toBe(.4);
    expect(movement.inspection().followCamera).toMatchObject({ desiredRadius: 4, appliedRadius: .4 });
    camera.alpha = -Math.PI / 2;
    movement.constrainFollowCamera();
    camera.update();
    expect(movement.inspection().followCamera).toMatchObject({ desiredRadius: 4, hitDistance: null });
    expect(camera.radius).toBeCloseTo(4, 5);
  });

  it("grounds a presented position on the collision surface below its step height and answers straight walks for the door approach", async () => {
    const { movement, settle } = await wiredWorld([floorSlab(0), blockingBox([100, 0, 64], [16, 512, 64])]);
    expect(movement.groundBelow({ x: 0, y: .5, z: 0 })).toBeNull();
    expect(movement.isStraightWalkBlocked({ x: 0, y: 0, z: 0 }, { x: .5, y: 0, z: 0 }, { radius: 9, height: 23 })).toBe(true);
    await settle();
    const grounded = movement.groundBelow({ x: .4, y: pawnRules.pawn.maxStepHeight / 200, z: .2 })!;
    expect(grounded.x).toBeCloseTo(.4, 4); expect(grounded.z).toBeCloseTo(.2, 4); expect(grounded.y).toBeCloseTo(0, 1);
    expect(movement.groundBelow({ x: 30, y: .1, z: 30 })).toBeNull();
    expect(movement.groundBelow({ x: Number.NaN, y: 0, z: 0 })).toBeNull();
    expect(movement.isStraightWalkBlocked({ x: 0, y: 0, z: 0 }, { x: .5, y: 0, z: 0 }, { radius: 9, height: 23 })).toBe(false);
    expect(movement.isStraightWalkBlocked({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { radius: 9, height: 23 })).toBe(true);
    const navigation = createCollisionWorldNavigation(movement, { radius: 9, height: 23 });
    expect(navigation.move({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toEqual({ position: { x: 0, y: 0, z: 0 }, blocked: true });
    expect(navigation.move({ x: 0, y: 0, z: 0 }, { x: .5, y: 0, z: 0 })).toEqual({ position: { x: .5, y: 0, z: 0 }, blocked: false });
    expect(navigation.destination({ x: .3, y: .05, z: 0 })!.y).toBeCloseTo(0, 1);
  });
});

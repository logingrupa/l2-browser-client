import type { Vector3 } from "../../../src/shared/math/vector3";
import type { CollisionWorld } from "../../../src/scene/world/movement/core/collisionWorld";
import type { PawnBody, PawnPhysicsContext } from "../../../src/scene/world/movement/core/pawnBody";
import type { MovementNativeRules } from "../../../src/scene/world/movement/core/movementRules";
import { boxHalfExtent } from "../../support/nativeTileCollisionFixture";
import {
  collisionWorldFromFixtures, committedMovementRules, emptyChunkArrays, volumeArrays, type BoxVolumeDeclaration,
} from "./movementCollisionFixtures";

type SourceTriple = readonly [number, number, number];

export const syntheticPawnRadius = 9;
export const syntheticPawnHalfHeight = 23;
export const pawnRules: MovementNativeRules = committedMovementRules();

const boxDeclaration = (kindCode: number, decisionCode: number, centre: SourceTriple, halfSize: SourceTriple, rotation: SourceTriple): BoxVolumeDeclaration => ({
  kindCode, decisionCode, location: centre, rotation, drawScale3D: [halfSize[0] / boxHalfExtent, halfSize[1] / boxHalfExtent, halfSize[2] / boxHalfExtent],
});

export const blockingBox = (centre: SourceTriple, halfSize: SourceTriple, rotation: SourceTriple = [0, 0, 0]) => boxDeclaration(0, 1, centre, halfSize, rotation);

export const waterBox = (centre: SourceTriple, halfSize: SourceTriple) => boxDeclaration(1, 0, centre, halfSize, [0, 0, 0]);

export const floorSlab = (topZ: number, minimumX = -2048, maximumX = 2048) =>
  blockingBox([(minimumX + maximumX) / 2, 0, topZ - 64], [(maximumX - minimumX) / 2, 2048, 64]);

export function boxVolumeWorld(boxes: readonly BoxVolumeDeclaration[]): CollisionWorld {
  const otherArrays = emptyChunkArrays().filter(array => !array.name.startsWith("VOLS."));
  return collisionWorldFromFixtures([...volumeArrays(boxes), ...otherArrays], null);
}

export function pawnContext(world: CollisionWorld): PawnPhysicsContext {
  return { world, rules: pawnRules, surroundings: {} };
}

export function standingPawn(location: Vector3, mode: PawnBody["mode"] = "walking"): PawnBody {
  return {
    location, velocity: { x: 0, y: 0, z: 0 }, collisionRadius: syntheticPawnRadius, collisionHeight: syntheticPawnHalfHeight,
    mode, floor: null, restsInFloorBand: false,
  };
}

export const centreAboveFloor = (x: number, y: number, floorZ: number): Vector3 =>
  ({ x, y, z: Math.fround(floorZ + syntheticPawnHalfHeight + pawnRules.pawn.floorBand.target) });

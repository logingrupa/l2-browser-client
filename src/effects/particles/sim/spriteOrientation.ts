import { crossProduct, dotProduct, scaleVector, subtractVectors, type Vector3 } from "../../../shared/math/vector3";
import { DIRECTION_USAGE, PARTICLE_CONSTANTS } from "./emitterConstants";

export interface SpriteHalfAxes {
  readonly up: Vector3;
  readonly right: Vector3;
}

export interface CameraFacingHalfExtents {
  readonly up: number;
  readonly right: number;
}

export interface OrientedSpriteInput {
  readonly directionUsage: number;
  readonly location: Vector3;
  readonly oldLocation: Vector3;
  readonly size: Vector3;
  readonly cameraLocation: Vector3;
  readonly realProjectionNormal: Vector3;
  readonly workingProjectionNormal: Vector3;
}

export const CAMERA_FACING_DIRECTION_USAGES: readonly number[] = [DIRECTION_USAGE.none, DIRECTION_USAGE.scale];

const { retainedSquaredLengthLimit, nonParallelComponentLimit } = PARTICLE_CONSTANTS.spriteOrientation.runtimeDefault;
const zeroVector: Vector3 = { x: 0, y: 0, z: 0 };

export function spriteFacesCamera(directionUsage: number): boolean {
  return CAMERA_FACING_DIRECTION_USAGES.includes(directionUsage);
}

function belowRetainedLength(vector: Vector3): boolean {
  return Math.fround(dotProduct(vector, vector)) < retainedSquaredLengthLimit;
}

function normalizeKeepingTinyVector(vector: Vector3): Vector3 {
  return belowRetainedLength(vector) ? vector : scaleVector(vector, 1 / Math.sqrt(dotProduct(vector, vector)));
}

function safeNormal(vector: Vector3): Vector3 {
  return belowRetainedLength(vector) ? zeroVector : scaleVector(vector, 1 / Math.sqrt(dotProduct(vector, vector)));
}

function nonParallelAxis(vector: Vector3): Vector3 {
  if (Math.abs(vector.x) > nonParallelComponentLimit) return { x: 0, y: 1, z: 0 };
  if (Math.abs(vector.y) > nonParallelComponentLimit) return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

function halfAxesAroundNormal(normal: Vector3, size: Vector3): SpriteHalfAxes {
  const up = scaleVector(crossProduct(normal, nonParallelAxis(normal)), size.y);
  return { up, right: scaleVector(safeNormal(crossProduct(normal, up)), size.x) };
}

export function realProjectionNormal(projectionNormal: Vector3): Vector3 {
  return safeNormal(projectionNormal);
}

export function cameraFacingHalfExtents(directionUsage: number, size: Vector3): CameraFacingHalfExtents {
  if (directionUsage === DIRECTION_USAGE.none) return { up: size.x, right: size.x };
  if (directionUsage === DIRECTION_USAGE.scale) return { up: size.y, right: size.x };
  throw new RangeError(`UseDirectionAs ${directionUsage} is not camera-facing.`);
}

export function orientedSpriteHalfAxes(input: OrientedSpriteInput): SpriteHalfAxes {
  const { directionUsage, size } = input;
  if (spriteFacesCamera(directionUsage)) throw new RangeError(`UseDirectionAs ${directionUsage} is camera-facing and takes its axes from the view.`);
  const direction = normalizeKeepingTinyVector(subtractVectors(input.location, input.oldLocation));
  const acrossView = () => normalizeKeepingTinyVector(crossProduct(direction, subtractVectors(input.location, input.cameraLocation)));
  switch (directionUsage) {
    case DIRECTION_USAGE.up: return { up: scaleVector(direction, size.y), right: scaleVector(acrossView(), size.x) };
    case DIRECTION_USAGE.right: return { up: scaleVector(acrossView(), size.y), right: scaleVector(direction, size.x) };
    case DIRECTION_USAGE.forward: return halfAxesAroundNormal(direction, size);
    case DIRECTION_USAGE.normal: return halfAxesAroundNormal(input.workingProjectionNormal, size);
    case DIRECTION_USAGE.upAndNormal: return { up: scaleVector(direction, size.y), right: scaleVector(crossProduct(direction, input.realProjectionNormal), size.x) };
    case DIRECTION_USAGE.rightAndNormal: return { up: scaleVector(crossProduct(direction, input.realProjectionNormal), size.y), right: scaleVector(direction, size.x) };
    default: return { up: zeroVector, right: zeroVector };
  }
}

import { inverseTransposeLinear, multiplyMatrix3Vector, transformPoint, type AffineMatrix } from "./affineMatrix";
import { dotProduct, normalizeVector, scaleVector, type Vector3 } from "./vector3";

export interface Plane {
  readonly normal: Vector3;
  readonly w: number;
}

export function planeDistance(plane: Plane, point: Vector3): number {
  return dotProduct(plane.normal, point) - plane.w;
}

export function planeFromNormalAndPoint(normal: Vector3, point: Vector3): Plane {
  return { normal, w: dotProduct(normal, point) };
}

export function transformPlane(plane: Plane, matrix: AffineMatrix): Plane {
  const pointOnPlane = scaleVector(plane.normal, plane.w / dotProduct(plane.normal, plane.normal));
  const transformedNormal = normalizeVector(multiplyMatrix3Vector(inverseTransposeLinear(matrix), plane.normal));
  return planeFromNormalAndPoint(transformedNormal, transformPoint(matrix, pointOnPlane));
}

import { planeDistance, planeFromNormalAndPoint, type Plane } from "../../../../shared/math/plane";
import { addVectors, crossProduct, normalizeVector, scaleVector, type Vector3 } from "../../../../shared/math/vector3";

export interface ViewPose {
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly up: Vector3;
  readonly verticalFieldOfView: number;
  readonly aspectRatio: number;
  readonly near: number;
  readonly far: number;
}

export interface ViewFrustum {
  readonly planes: readonly Plane[];
}

function sidePlaneNormal(forward: Vector3, sideAxis: Vector3, halfAngle: number, sideSign: number): Vector3 {
  return addVectors(scaleVector(forward, Math.sin(halfAngle)), scaleVector(sideAxis, sideSign * Math.cos(halfAngle)));
}

export function createViewFrustum(pose: ViewPose): ViewFrustum {
  const forward = normalizeVector(pose.forward);
  const right = normalizeVector(crossProduct(forward, pose.up));
  const up = normalizeVector(crossProduct(right, forward));
  const verticalHalfAngle = pose.verticalFieldOfView / 2;
  const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * pose.aspectRatio);
  const planes = [
    planeFromNormalAndPoint(forward, addVectors(pose.position, scaleVector(forward, pose.near))),
    ...[1, -1].map(sideSign => planeFromNormalAndPoint(sidePlaneNormal(forward, right, horizontalHalfAngle, sideSign), pose.position)),
    ...[1, -1].map(sideSign => planeFromNormalAndPoint(sidePlaneNormal(forward, up, verticalHalfAngle, sideSign), pose.position)),
  ];
  if (Number.isFinite(pose.far)) planes.push(planeFromNormalAndPoint(scaleVector(forward, -1), addVectors(pose.position, scaleVector(forward, pose.far))));
  return { planes };
}

export function sphereInsideFrustum(frustum: ViewFrustum, center: Vector3, radius: number): boolean {
  return frustum.planes.every(plane => planeDistance(plane, center) >= -radius);
}

export function boxOutsideFrustum(frustum: ViewFrustum, minimum: Vector3, maximum: Vector3): boolean {
  return frustum.planes.some(plane => planeDistance(plane, {
    x: plane.normal.x >= 0 ? maximum.x : minimum.x,
    y: plane.normal.y >= 0 ? maximum.y : minimum.y,
    z: plane.normal.z >= 0 ? maximum.z : minimum.z,
  }) < 0);
}

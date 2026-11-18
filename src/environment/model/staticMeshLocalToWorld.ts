import type { Vector3 } from "../../shared/math/vector3";

export type NativeLocalToWorldRows = readonly [Vector3, Vector3, Vector3];

export interface NativeLocalToWorld {
  readonly rows: NativeLocalToWorldRows;
  readonly origin: Vector3;
}

export function staticMeshWorldPosition(localToWorld: NativeLocalToWorld, localPosition: Vector3): Vector3 {
  const [xAxis, yAxis, zAxis] = localToWorld.rows, { origin } = localToWorld;
  return {
    x: Math.fround(localPosition.x * xAxis.x + localPosition.y * yAxis.x + localPosition.z * zAxis.x + origin.x),
    y: Math.fround(localPosition.x * xAxis.y + localPosition.y * yAxis.y + localPosition.z * zAxis.y + origin.y),
    z: Math.fround(localPosition.x * xAxis.z + localPosition.y * yAxis.z + localPosition.z * zAxis.z + origin.z),
  };
}

export function staticMeshWorldNormal(localToWorld: NativeLocalToWorldRows, localNormal: Vector3): Vector3 {
  const [xAxis, yAxis, zAxis] = localToWorld;
  const transformed = {
    x: Math.fround(localNormal.x * xAxis.x + localNormal.y * yAxis.x + localNormal.z * zAxis.x),
    y: Math.fround(localNormal.x * xAxis.y + localNormal.y * yAxis.y + localNormal.z * zAxis.y),
    z: Math.fround(localNormal.x * xAxis.z + localNormal.y * yAxis.z + localNormal.z * zAxis.z),
  };
  const squaredLength = Math.fround(transformed.x * transformed.x + transformed.y * transformed.y + transformed.z * transformed.z);
  const inverseLength = Math.fround(1 / Math.fround(Math.sqrt(squaredLength)));
  return { x: Math.fround(transformed.x * inverseLength), y: Math.fround(transformed.y * inverseLength), z: Math.fround(transformed.z * inverseLength) };
}

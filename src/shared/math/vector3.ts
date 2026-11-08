export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function addVectors(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

export function subtractVectors(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

export function scaleVector(vector: Vector3, scale: number): Vector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

export function dotProduct(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function crossProduct(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

export function vectorLength(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function normalizeVector(vector: Vector3): Vector3 {
  const length = vectorLength(vector);
  if (length === 0) throw new RangeError("Cannot normalize a zero-length vector.");
  return scaleVector(vector, 1 / length);
}

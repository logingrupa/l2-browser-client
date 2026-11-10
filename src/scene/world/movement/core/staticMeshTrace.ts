import { transformPoint, type AffineMatrix } from "../../../../shared/math/affineMatrix";
import { planeDistance, type Plane } from "../../../../shared/math/plane";
import { crossProduct, dotProduct, normalizeVector, subtractVectors, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionStaticMesh } from "./collisionCell";
import { boundsOfPoints, isZeroExtent, negateVector, pointAlongSweep, UNIT_AXES, type CollisionSweep, type PrimitiveSweepHit } from "./collisionTrace";
import { axisAlignedBoxPlanes, clipSweepAgainstPlanes, planesOverlapBox } from "./convexHullClip";
import type { MovementNativeRules } from "./movementRules";

interface WorldTriangle {
  readonly vertices: readonly [Vector3, Vector3, Vector3];
  readonly plane: Plane;
  readonly clipPlanes: readonly Plane[];
}

const noBoxOffsets = { minimumOutward: { x: 0, y: 0, z: 0 }, maximumOutward: { x: 0, y: 0, z: 0 } };
const worldTriangleCache = new WeakMap<Float32Array, readonly WorldTriangle[]>();

export function rowMajorPlacementToAffine(matrix: Float32Array): AffineMatrix {
  return {
    linear: [matrix[0]!, matrix[4]!, matrix[8]!, matrix[1]!, matrix[5]!, matrix[9]!, matrix[2]!, matrix[6]!, matrix[10]!],
    translation: { x: matrix[12]!, y: matrix[13]!, z: matrix[14]! },
  };
}

function edgePlanes(vertices: readonly [Vector3, Vector3, Vector3]): Plane[] {
  return vertices.flatMap((edgeStart, edgeIndex) => {
    const edgeEnd = vertices[(edgeIndex + 1) % 3]!, oppositeVertex = vertices[(edgeIndex + 2) % 3]!;
    const edge = subtractVectors(edgeEnd, edgeStart);
    return UNIT_AXES.flatMap(axis => {
      const sideNormal = crossProduct(edge, axis);
      if (dotProduct(sideNormal, sideNormal) === 0) return [];
      const normal = normalizeVector(sideNormal);
      const outwardNormal = dotProduct(normal, subtractVectors(oppositeVertex, edgeStart)) > 0 ? negateVector(normal) : normal;
      return [{ normal: outwardNormal, w: dotProduct(outwardNormal, edgeStart) }];
    });
  });
}

function worldTriangle(vertices: readonly [Vector3, Vector3, Vector3]): WorldTriangle | null {
  const faceNormal = crossProduct(subtractVectors(vertices[1], vertices[0]), subtractVectors(vertices[2], vertices[0]));
  if (dotProduct(faceNormal, faceNormal) === 0) return null;
  const normal = normalizeVector(faceNormal), plane = { normal, w: dotProduct(normal, vertices[0]) };
  const bounds = boundsOfPoints(vertices);
  const clipPlanes = [...axisAlignedBoxPlanes(bounds.minimum, bounds.maximum, noBoxOffsets), plane, { normal: negateVector(normal), w: -plane.w }, ...edgePlanes(vertices)];
  return { vertices, plane, clipPlanes };
}

function worldTriangles(mesh: CollisionStaticMesh, placementMatrix: Float32Array): readonly WorldTriangle[] {
  const cached = worldTriangleCache.get(placementMatrix);
  if (cached !== undefined) return cached;
  const localToWorld = rowMajorPlacementToAffine(placementMatrix);
  const vertex = (index: number) => transformPoint(localToWorld,
    { x: mesh.positions[index * 3]!, y: mesh.positions[index * 3 + 1]!, z: mesh.positions[index * 3 + 2]! });
  const triangles = Array.from({ length: mesh.indices.length / 3 }, (_, triangleIndex) =>
    worldTriangle([vertex(mesh.indices[triangleIndex * 3]!), vertex(mesh.indices[triangleIndex * 3 + 1]!), vertex(mesh.indices[triangleIndex * 3 + 2]!)]))
    .filter((triangle): triangle is WorldTriangle => triangle !== null);
  worldTriangleCache.set(placementMatrix, triangles);
  return triangles;
}

function pointInsideTriangle(triangle: WorldTriangle, point: Vector3): boolean {
  return triangle.vertices.every((edgeStart, edgeIndex) => {
    const edge = subtractVectors(triangle.vertices[(edgeIndex + 1) % 3]!, edgeStart);
    return dotProduct(crossProduct(edge, subtractVectors(point, edgeStart)), triangle.plane.normal) >= 0;
  });
}

function traceTriangleRay(triangle: WorldTriangle, sweep: CollisionSweep): PrimitiveSweepHit | null {
  const startDistance = planeDistance(triangle.plane, sweep.start), endDistance = planeDistance(triangle.plane, sweep.end);
  if (startDistance === endDistance || (startDistance > 0 && endDistance > 0) || (startDistance < 0 && endDistance < 0)) return null;
  const time = startDistance / (startDistance - endDistance);
  if (!pointInsideTriangle(triangle, pointAlongSweep(sweep, time))) return null;
  const startsInFront = startDistance > 0 || (startDistance === 0 && endDistance < 0);
  return { time, normal: startsInFront ? triangle.plane.normal : negateVector(triangle.plane.normal) };
}

export function traceStaticMesh(mesh: CollisionStaticMesh, placementMatrix: Float32Array, sweep: CollisionSweep,
  rules: MovementNativeRules): PrimitiveSweepHit | null {
  const zeroExtent = isZeroExtent(sweep.extent);
  let earliest: PrimitiveSweepHit | null = null;
  for (const triangle of worldTriangles(mesh, placementMatrix)) {
    const hit = zeroExtent ? traceTriangleRay(triangle, sweep) : clipSweepAgainstPlanes(triangle.clipPlanes, sweep, "from-zero", rules);
    if (hit !== null && (earliest === null || hit.time < earliest.time)) earliest = hit;
  }
  return earliest;
}

export function staticMeshOverlapsBox(mesh: CollisionStaticMesh, placementMatrix: Float32Array, centre: Vector3, extent: Vector3): boolean {
  if (isZeroExtent(extent)) return false;
  return worldTriangles(mesh, placementMatrix).some(triangle => planesOverlapBox(triangle.clipPlanes, centre, extent));
}

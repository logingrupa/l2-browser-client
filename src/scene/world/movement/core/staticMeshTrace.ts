import { transformPoint, type AffineMatrix } from "../../../../shared/math/affineMatrix";
import { planeDistance, type Plane } from "../../../../shared/math/plane";
import { crossProduct, dotProduct, normalizeVector, subtractVectors, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionStaticMesh } from "./collisionCell";
import {
  boundsOfPoints, isZeroExtent, negateVector, pointAlongSweep, UNIT_AXES, type CollisionSweep, type PointBounds, type PrimitiveSweepHit,
} from "./collisionTrace";
import { axisAlignedBoxPlanes, clipSweepAgainstPlanes, planesOverlapBox } from "./convexHullClip";
import type { MovementNativeRules } from "./movementRules";

interface WorldTriangle {
  readonly vertices: readonly [Vector3, Vector3, Vector3];
  readonly plane: Plane;
  readonly clipPlanes: readonly Plane[];
}

interface PlacedStaticMesh {
  readonly localToWorld: AffineMatrix;
  readonly worldBounds: PointBounds;
  worldTriangles: readonly WorldTriangle[] | null;
}

const noBoxOffsets = { minimumOutward: { x: 0, y: 0, z: 0 }, maximumOutward: { x: 0, y: 0, z: 0 } };
const placedStaticMeshCache = new WeakMap<Float32Array, PlacedStaticMesh>();

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

function meshVertexInWorld(mesh: CollisionStaticMesh, localToWorld: AffineMatrix, vertexIndex: number): Vector3 {
  return transformPoint(localToWorld, { x: mesh.positions[vertexIndex * 3]!, y: mesh.positions[vertexIndex * 3 + 1]!, z: mesh.positions[vertexIndex * 3 + 2]! });
}

function placedStaticMesh(mesh: CollisionStaticMesh, placementMatrix: Float32Array): PlacedStaticMesh {
  const cached = placedStaticMeshCache.get(placementMatrix);
  if (cached !== undefined) return cached;
  const localToWorld = rowMajorPlacementToAffine(placementMatrix);
  const worldVertices = Array.from({ length: mesh.positions.length / 3 }, (_, vertexIndex) => meshVertexInWorld(mesh, localToWorld, vertexIndex));
  const placed: PlacedStaticMesh = { localToWorld, worldBounds: boundsOfPoints(worldVertices), worldTriangles: null };
  placedStaticMeshCache.set(placementMatrix, placed);
  return placed;
}

function placedWorldTriangles(mesh: CollisionStaticMesh, placed: PlacedStaticMesh): readonly WorldTriangle[] {
  if (placed.worldTriangles !== null) return placed.worldTriangles;
  const vertex = (index: number) => meshVertexInWorld(mesh, placed.localToWorld, index);
  placed.worldTriangles = Array.from({ length: mesh.indices.length / 3 }, (_, triangleIndex) =>
    worldTriangle([vertex(mesh.indices[triangleIndex * 3]!), vertex(mesh.indices[triangleIndex * 3 + 1]!), vertex(mesh.indices[triangleIndex * 3 + 2]!)]))
    .filter((triangle): triangle is WorldTriangle => triangle !== null);
  return placed.worldTriangles;
}

function sweptBoxMissesBounds(bounds: PointBounds, sweep: CollisionSweep): boolean {
  const { start, end, extent } = sweep;
  const missesAxis = (startComponent: number, endComponent: number, minimum: number, maximum: number, extentComponent: number) =>
    (startComponent - maximum > extentComponent && endComponent - maximum > extentComponent)
    || (minimum - startComponent > extentComponent && minimum - endComponent > extentComponent);
  return missesAxis(start.x, end.x, bounds.minimum.x, bounds.maximum.x, extent.x)
    || missesAxis(start.y, end.y, bounds.minimum.y, bounds.maximum.y, extent.y)
    || missesAxis(start.z, end.z, bounds.minimum.z, bounds.maximum.z, extent.z);
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
  const placed = placedStaticMesh(mesh, placementMatrix);
  if (sweptBoxMissesBounds(placed.worldBounds, sweep)) return null;
  const zeroExtent = isZeroExtent(sweep.extent);
  let earliest: PrimitiveSweepHit | null = null;
  for (const triangle of placedWorldTriangles(mesh, placed)) {
    const hit = zeroExtent ? traceTriangleRay(triangle, sweep) : clipSweepAgainstPlanes(triangle.clipPlanes, sweep, "from-zero", rules);
    if (hit !== null && (earliest === null || hit.time < earliest.time)) earliest = hit;
  }
  return earliest;
}

export function staticMeshOverlapsBox(mesh: CollisionStaticMesh, placementMatrix: Float32Array, centre: Vector3, extent: Vector3): boolean {
  if (isZeroExtent(extent)) return false;
  const placed = placedStaticMesh(mesh, placementMatrix);
  if (sweptBoxMissesBounds(placed.worldBounds, { start: centre, end: centre, extent })) return false;
  return placedWorldTriangles(mesh, placed).some(triangle => planesOverlapBox(triangle.clipPlanes, centre, extent));
}

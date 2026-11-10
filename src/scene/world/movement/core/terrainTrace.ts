import { crossProduct, dotProduct, normalizeVector, subtractVectors, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionTerrain } from "./collisionCell";
import { negateVector, type CollisionSweep, type PrimitiveSweepHit } from "./collisionTrace";
import { CollisionWorldError } from "./collisionWorld";
import type { MovementNativeRules } from "./movementRules";

export interface TerrainSweepHit extends PrimitiveSweepHit {
  readonly quadIndex: number;
}

interface TerrainFrame {
  readonly origin: Vector3;
  readonly scale: Vector3;
}

interface TerrainTriangle {
  readonly quadIndex: number;
  readonly visible: boolean;
  readonly vertices: readonly [Vector3, Vector3, Vector3];
  readonly upNormal: Vector3;
  readonly outwardEdgeNormals: readonly [Vector3, Vector3, Vector3];
}

interface TerrainGeometry {
  readonly frame: TerrainFrame;
  readonly triangles: readonly TerrainTriangle[];
}

const heightUnitsPerScaleZ = 256;
const heightOriginOffset = 32767;
const terrainGeometryCache = new WeakMap<CollisionTerrain, TerrainGeometry>();

function terrainFrame(terrain: CollisionTerrain): TerrainFrame {
  const [locationX, locationY, locationZ] = terrain.location, [scaleX, scaleY, scaleZ] = terrain.terrainScale;
  if (!(scaleX > 0 && scaleY > 0 && scaleZ > 0)) throw new CollisionWorldError("terrain has a non-positive TerrainScale.");
  return {
    origin: {
      x: Math.fround(Math.fround(-locationX / scaleX) + Math.floor(terrain.heightmapWidth / 2)),
      y: Math.fround(Math.fround(-locationY / scaleY) + Math.floor(terrain.heightmapHeight / 2)),
      z: Math.fround(Math.fround(Math.fround(-heightUnitsPerScaleZ * locationZ) / scaleZ) + heightOriginOffset),
    },
    scale: { x: scaleX, y: scaleY, z: Math.fround(scaleZ / heightUnitsPerScaleZ) },
  };
}

function terrainTriangle(quadIndex: number, visible: boolean, vertices: readonly [Vector3, Vector3, Vector3]): TerrainTriangle {
  const faceNormal = normalizeVector(crossProduct(subtractVectors(vertices[1], vertices[0]), subtractVectors(vertices[2], vertices[0])));
  const upNormal = faceNormal.z < 0 ? negateVector(faceNormal) : faceNormal;
  const outwardEdgeNormal = (edgeIndex: number) => {
    const edgeStart = vertices[edgeIndex]!, edgeEnd = vertices[(edgeIndex + 1) % 3]!, oppositeVertex = vertices[(edgeIndex + 2) % 3]!;
    const edgeNormal = crossProduct(subtractVectors(edgeEnd, edgeStart), upNormal);
    return dotProduct(edgeNormal, subtractVectors(oppositeVertex, edgeStart)) > 0 ? negateVector(edgeNormal) : edgeNormal;
  };
  return { quadIndex, visible, vertices, upNormal, outwardEdgeNormals: [outwardEdgeNormal(0), outwardEdgeNormal(1), outwardEdgeNormal(2)] };
}

function terrainGeometry(terrain: CollisionTerrain): TerrainGeometry {
  const cached = terrainGeometryCache.get(terrain);
  if (cached !== undefined) return cached;
  const localVertex = (column: number, row: number): Vector3 =>
    ({ x: terrain.firstColumn + column, y: terrain.firstRow + row, z: terrain.heights[row * terrain.columns + column]! });
  const quadColumns = terrain.columns - 1;
  const triangles = Array.from(terrain.quadVisibility, (visibilityBit, quadIndex) => {
    const column = quadIndex % quadColumns, row = Math.floor(quadIndex / quadColumns), visible = visibilityBit === 1;
    const corner00 = localVertex(column, row), corner10 = localVertex(column + 1, row);
    const corner01 = localVertex(column, row + 1), corner11 = localVertex(column + 1, row + 1);
    return terrain.edgeTurn[quadIndex] === 1
      ? [terrainTriangle(quadIndex, visible, [corner00, corner10, corner01]), terrainTriangle(quadIndex, visible, [corner01, corner10, corner11])]
      : [terrainTriangle(quadIndex, visible, [corner00, corner10, corner11]), terrainTriangle(quadIndex, visible, [corner00, corner11, corner01])];
  }).flat();
  const geometry = { frame: terrainFrame(terrain), triangles };
  terrainGeometryCache.set(terrain, geometry);
  return geometry;
}

const worldToLocal = (frame: TerrainFrame, point: Vector3): Vector3 =>
  ({ x: point.x / frame.scale.x + frame.origin.x, y: point.y / frame.scale.y + frame.origin.y, z: point.z / frame.scale.z + frame.origin.z });

const localNormalToWorld = (frame: TerrainFrame, normal: Vector3): Vector3 =>
  normalizeVector({ x: normal.x / frame.scale.x, y: normal.y / frame.scale.y, z: normal.z / frame.scale.z });

export function traceTerrain(terrain: CollisionTerrain, sweep: CollisionSweep, rules: MovementNativeRules): TerrainSweepHit | null {
  const { frame, triangles } = terrainGeometry(terrain);
  const start = worldToLocal(frame, sweep.start), end = worldToLocal(frame, sweep.end), delta = subtractVectors(end, start);
  const extent = { x: sweep.extent.x / frame.scale.x, y: sweep.extent.y / frame.scale.y, z: sweep.extent.z / frame.scale.z };
  let earliest: TerrainSweepHit | null = null;
  for (const triangle of triangles) {
    if (!triangle.visible && rules.terrainHolesDropCollision) continue;
    const normal = triangle.upNormal;
    if (dotProduct(normal, delta) >= -rules.terrainMotionEpsilon) continue;
    const liftedVertices = triangle.vertices.map(vertex => ({ x: vertex.x, y: vertex.y, z: vertex.z + extent.z }));
    const liftedPlaneW = dotProduct(normal, liftedVertices[0]!);
    const startDistance = dotProduct(normal, start) - liftedPlaneW, endDistance = dotProduct(normal, end) - liftedPlaneW;
    const time = startDistance / (startDistance - endDistance);
    if (time < 0 || time > 1 || (earliest !== null && time >= earliest.time)) continue;
    const hitPoint = { x: start.x + delta.x * time, y: start.y + delta.y * time, z: start.z + delta.z * time };
    const insideEdges = triangle.outwardEdgeNormals.every((edgeNormal, edgeIndex) =>
      dotProduct(edgeNormal, subtractVectors(hitPoint, liftedVertices[edgeIndex]!)) <= extent.x);
    if (insideEdges) earliest = { time, normal: localNormalToWorld(frame, normal), quadIndex: triangle.quadIndex };
  }
  return earliest;
}

export function terrainContactUnderBox(terrain: CollisionTerrain, centre: Vector3, extent: Vector3, rules: MovementNativeRules): TerrainSweepHit | null {
  const verticalSweep: CollisionSweep = {
    start: { x: centre.x, y: centre.y, z: centre.z + extent.z },
    end: { x: centre.x, y: centre.y, z: centre.z - extent.z },
    extent: { x: extent.x, y: extent.y, z: 0 },
  };
  return traceTerrain(terrain, verticalSweep, rules);
}

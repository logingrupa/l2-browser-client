import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { WorldPosition } from "../../world/worldTypes";
import type { WorldGroundContact, WorldNavigation, WorldSupportSample } from "../../world/WorldNavigation";

const maxStep = 0.3, skin = 0.002;
const maxSlopeCosine = Math.cos(Math.PI / 4), cellSize = 8;
const footprint = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)])];
type Triangle = readonly [Vector3, Vector3, Vector3];
interface Geometry {
  readonly mesh: AbstractMesh;
  readonly positions: Float64Array;
  readonly indices: Uint32Array;
  readonly cells: Map<string, number[]>;
}
interface MeshEntry { mesh: AbstractMesh; supportsWalking: boolean; geometry?: Geometry }
export interface MeshNavigationOptions {
  readonly capsule?: { radius: number; height: number };
  readonly terrainMeshes: readonly AbstractMesh[];
  readonly obstacleMeshes: () => readonly AbstractMesh[];
  readonly dynamicObstacleMeshes?: () => readonly AbstractMesh[];
  readonly origin: WorldPosition;
  readonly isReady?: (from: WorldPosition, to: WorldPosition) => boolean;
}
const vector = (point: WorldPosition): Vector3 => new Vector3(point.x, point.y, point.z);
const position = (point: Vector3): WorldPosition => ({ x: point.x, y: point.y, z: point.z });
const finite = (point: WorldPosition): boolean => [point.x, point.y, point.z].every(value => Number.isFinite(value) && Math.abs(value) < 1e7);
const cell = (x: number, z: number): string => `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
function forCells(minX: number, minZ: number, maxX: number, maxZ: number, callback: (key: string) => void): void {
  for (let z = Math.floor(minZ / cellSize); z <= Math.floor(maxZ / cellSize); z++) {
    for (let x = Math.floor(minX / cellSize); x <= Math.floor(maxX / cellSize); x++) callback(`${x}:${z}`);
  }
}
function addCell<T>(cells: Map<string, T[]>, key: string, value: T): void {
  const existing = cells.get(key);
  if (existing) existing.push(value); else cells.set(key, [value]);
}
function buildGeometry(mesh: AbstractMesh): Geometry {
  const vertices = mesh.getVerticesData("position"), sourceIndices = mesh.getIndices();
  if (!vertices?.length || !sourceIndices?.length || sourceIndices.length % 3) throw new Error(`Missing indexed collision geometry: ${mesh.name}`);
  const matrix = mesh.computeWorldMatrix(true), positions = new Float64Array(vertices.length);
  for (let offset = 0; offset < vertices.length; offset += 3) {
    const point = Vector3.TransformCoordinates(Vector3.FromArray(vertices, offset), matrix);
    positions.set(point.asArray(), offset);
  }
  const indices = Uint32Array.from(sourceIndices);
  const placementMirrorsWinding = matrix.determinant() < 0;
  if (placementMirrorsWinding) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
  const cells = new Map<string, number[]>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset]! * 3, b = indices[offset + 1]! * 3, c = indices[offset + 2]! * 3;
    forCells(Math.min(positions[a]!, positions[b]!, positions[c]!), Math.min(positions[a + 2]!, positions[b + 2]!, positions[c + 2]!),
      Math.max(positions[a]!, positions[b]!, positions[c]!), Math.max(positions[a + 2]!, positions[b + 2]!, positions[c + 2]!), key => addCell(cells, key, offset));
  }
  return { mesh, positions, indices, cells };
}
function triangle(geometry: Geometry, offset: number): Triangle {
  return [Vector3.FromArray(geometry.positions, geometry.indices[offset]! * 3), Vector3.FromArray(geometry.positions, geometry.indices[offset + 1]! * 3), Vector3.FromArray(geometry.positions, geometry.indices[offset + 2]! * 3)];
}
function supportY([a, b, c]: Triangle, x: number, z: number, upwardOnly: boolean): number | null {
  const ab = b.subtract(a), ac = c.subtract(a), normal = Vector3.Cross(ab, ac);
  const length = normal.length();
  if (length < 1e-10 || (upwardOnly ? normal.y : Math.abs(normal.y)) / length < maxSlopeCosine - 1e-7) return null;
  const determinant = ab.x * ac.z - ab.z * ac.x;
  const u = ((x - a.x) * ac.z - (z - a.z) * ac.x) / determinant;
  const v = (ab.x * (z - a.z) - ab.z * (x - a.x)) / determinant;
  if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) return null;
  return a.y + u * ab.y + v * ac.y;
}

function supportInterval(tri: Triangle, from: WorldPosition, to: WorldPosition, upwardOnly: boolean): [number, number] | null {
  const [a, b, c] = tri, ab = b.subtract(a), ac = c.subtract(a), normal = Vector3.Cross(ab, ac), size = normal.length();
  if (size < 1e-10 || (upwardOnly ? normal.y : Math.abs(normal.y)) / size < maxSlopeCosine - 1e-7) return null;
  const determinant = ab.x * ac.z - ab.z * ac.x;
  const barycentric = (point: WorldPosition) => {
    const u = ((point.x - a.x) * ac.z - (point.z - a.z) * ac.x) / determinant;
    const v = (ab.x * (point.z - a.z) - ab.z * (point.x - a.x)) / determinant;
    return [u, v, 1 - u - v, a.y + u * ab.y + v * ac.y] as const;
  };
  const first = barycentric(from), last = barycentric(to);
  let lower = 0, upper = 1;
  const clip = (start: number, finish: number): boolean => {
    const change = finish - start;
    if (Math.abs(change) < 1e-14) return start >= -1e-9;
    const boundary = -start / change;
    if (change > 0) lower = Math.max(lower, boundary); else upper = Math.min(upper, boundary);
    return lower <= upper + 1e-9;
  };
  for (const axis of [0, 1, 2] as const) if (!clip(first[axis], last[axis])) return null;
  const lowY = Math.min(from.y, to.y) - maxStep - skin, highY = Math.max(from.y, to.y) + maxStep + skin;
  if (!clip(first[3] - lowY, last[3] - lowY) || !clip(highY - first[3], highY - last[3])) return null;
  return lower <= upper ? [Math.max(0, lower), Math.min(1, upper)] : null;
}

function pointTriangleDistance(point: Vector3, [a, b, c]: Triangle): number {
  const ab = b.subtract(a), ac = c.subtract(a), ap = point.subtract(a);
  const d1 = Vector3.Dot(ab, ap), d2 = Vector3.Dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return ap.length();
  const bp = point.subtract(b), d3 = Vector3.Dot(ab, bp), d4 = Vector3.Dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return bp.length();
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return Vector3.Distance(point, a.add(ab.scale(d1 / (d1 - d3))));
  const cp = point.subtract(c), d5 = Vector3.Dot(ab, cp), d6 = Vector3.Dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return cp.length();
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return Vector3.Distance(point, a.add(ac.scale(d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return Vector3.Distance(point, b.add(c.subtract(b).scale((d4 - d3) / (d4 - d3 + d5 - d6))));
  const inverse = 1 / (va + vb + vc);
  return Vector3.Distance(point, a.add(ab.scale(vb * inverse)).add(ac.scale(vc * inverse)));
}
function segmentDistance(p: Vector3, q: Vector3, a: Vector3, b: Vector3): number {
  const d1 = q.subtract(p), d2 = b.subtract(a), r = p.subtract(a);
  const aa = d1.lengthSquared(), ee = d2.lengthSquared(), f = Vector3.Dot(d2, r), clamp = (n: number) => Math.max(0, Math.min(1, n));
  let s = 0, t = 0;
  if (aa <= 1e-15 && ee <= 1e-15) return r.length();
  if (aa <= 1e-15) t = clamp(f / ee);
  else {
    const c = Vector3.Dot(d1, r);
    if (ee <= 1e-15) s = clamp(-c / aa);
    else {
      const bb = Vector3.Dot(d1, d2), denominator = aa * ee - bb * bb;
      s = denominator > 1e-15 ? clamp((bb * f - c * ee) / denominator) : 0;
      t = (bb * s + f) / ee;
      if (t < 0) { t = 0; s = clamp(-c / aa); }
      else if (t > 1) { t = 1; s = clamp((bb - c) / aa); }
    }
  }
  return Vector3.Distance(p.add(d1.scale(s)), a.add(d2.scale(t)));
}
function segmentTriangleDistance(p: Vector3, q: Vector3, tri: Triangle): number {
  const [a, b, c] = tri, direction = q.subtract(p), ab = b.subtract(a), ac = c.subtract(a), h = Vector3.Cross(direction, ac);
  const determinant = Vector3.Dot(ab, h);
  if (Math.abs(determinant) > 1e-14) {
    const inverse = 1 / determinant, s = p.subtract(a), u = Vector3.Dot(s, h) * inverse;
    const cross = Vector3.Cross(s, ab), v = Vector3.Dot(direction, cross) * inverse, t = Vector3.Dot(ac, cross) * inverse;
    if (u >= 0 && v >= 0 && u + v <= 1 && t >= 0 && t <= 1) return 0;
  }
  return Math.min(pointTriangleDistance(p, tri), pointTriangleDistance(q, tri), segmentDistance(p, q, a, b), segmentDistance(p, q, b, c), segmentDistance(p, q, c, a));
}

export function createWorldNavigation(options: MeshNavigationOptions): WorldNavigation {
  const { radius, height } = options.capsule ?? { radius: .1, height: .9 };
  if (!Number.isFinite(radius) || !Number.isFinite(height) || radius <= 0 || height < radius * 2) throw new Error("Invalid navigation capsule dimensions.");
  const terrain = options.terrainMeshes.map(buildGeometry), obstacleCells = new Map<string, MeshEntry[]>();
  const seenMeshes = new Set<AbstractMesh>();
  const dynamicGeometry = new WeakMap<AbstractMesh, { matrix: number[]; geometry: Geometry }>();
  let obstacleCount = -1;
  const projectedGround = new Map<string, WorldGroundContact>();
  let projectedMeshCount = -1;
  function refresh(): void {
    const meshes = options.obstacleMeshes();
    if (meshes.length === obstacleCount) return;
    obstacleCount = meshes.length;
    for (const mesh of meshes) {
      if (seenMeshes.has(mesh)) continue;
      seenMeshes.add(mesh);
      if (!mesh.getTotalVertices() || mesh.metadata?.worldCollision === false) continue;
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      const entry: MeshEntry = { mesh, supportsWalking: mesh.metadata?.worldSupportsWalking !== false };
      forCells(bounds.minimumWorld.x, bounds.minimumWorld.z, bounds.maximumWorld.x, bounds.maximumWorld.z, key => addCell(obstacleCells, key, entry));
    }
  }
  function entries(point: WorldPosition, reach = 0): MeshEntry[] {
    refresh();
    const found = new Set<MeshEntry>();
    forCells(point.x - reach, point.z - reach, point.x + reach, point.z + reach, key => { for (const entry of obstacleCells.get(key) ?? []) found.add(entry); });
    return [...found];
  }
  function geometry(entry: MeshEntry): Geometry { return entry.geometry ??= buildGeometry(entry.mesh); }
  function collisionEntries(point: WorldPosition, reach: number): MeshEntry[] {
    const found = entries(point, reach);
    for (const mesh of new Set(options.dynamicObstacleMeshes?.() ?? [])) {
      if (mesh.isDisposed() || !mesh.getTotalVertices() || mesh.metadata?.worldCollision === false) continue;
      const matrix = mesh.computeWorldMatrix(true).asArray(), bounds = mesh.getBoundingInfo().boundingBox;
      if (bounds.maximumWorld.x < point.x - reach || bounds.minimumWorld.x > point.x + reach ||
        bounds.maximumWorld.z < point.z - reach || bounds.minimumWorld.z > point.z + reach) continue;
      let cached = dynamicGeometry.get(mesh);
      if (!cached || cached.matrix.some((value, index) => value !== matrix[index])) {
        cached = { matrix: Array.from(matrix), geometry: buildGeometry(mesh) };
        dynamicGeometry.set(mesh, cached);
      }
      found.push({ mesh, supportsWalking: false, geometry: cached.geometry });
    }
    return found;
  }
  function support(source: Geometry, offset: number, point: WorldPosition, y: number): WorldSupportSample {
    return { meshId: source.mesh.id, meshUniqueId: source.mesh.uniqueId, meshName: source.mesh.name,
      indexOffset: offset, triangleIndex: offset / 3, position: { x: point.x, y, z: point.z } };
  }
  function terrainGroundAt(point: WorldPosition, maxDrop: number): WorldSupportSample | null {
    let highest: WorldSupportSample | null = null;
    for (const source of terrain) for (const offset of source.cells.get(cell(point.x, point.z)) ?? []) {
      const y = supportY(triangle(source, offset), point.x, point.z, false);
      if (y !== null && y <= point.y + maxStep + skin && y >= point.y - maxDrop && (highest === null || y > highest.position.y)) highest = support(source, offset, point, y);
    }
    return highest;
  }
  function groundAt(point: WorldPosition, maxDrop = maxStep + skin): WorldSupportSample | null {
    let highest = terrainGroundAt(point, maxDrop);
    for (const entry of entries(point)) {
      if (!entry.supportsWalking || entry.mesh.isDisposed()) continue;
      const source = geometry(entry);
      for (const offset of source.cells.get(cell(point.x, point.z)) ?? []) {
        const y = supportY(triangle(source, offset), point.x, point.z, true);
        if (y !== null && y <= point.y + maxStep + skin && y >= point.y - maxDrop && (highest === null || y > highest.position.y)) highest = support(source, offset, point, y);
      }
    }
    return highest;
  }
  function grounded(point: WorldPosition, maxDrop = maxStep + skin): WorldGroundContact | null {
    if (!finite(point) || options.isReady?.(point, point) === false) return null;
    let highest = -Infinity, lowest = Infinity, controllingSample = 0;
    const samples: WorldSupportSample[] = [];
    for (const offset of footprint) {
      const hit = groundAt({ x: point.x + offset[0]! * (radius + skin), y: point.y, z: point.z + offset[1]! * (radius + skin) }, maxDrop);
      if (hit === null) return null;
      const y = hit.position.y;
      if (y > highest) controllingSample = samples.length;
      samples.push(hit);
      highest = Math.max(highest, y); lowest = Math.min(lowest, y);
    }
    return highest - lowest <= maxStep + skin ? { queryPosition: { ...point },
      position: { x: point.x, y: highest, z: point.z }, samples, controllingSample } : null;
  }
  function sweep(from: WorldPosition, to: WorldPosition): boolean {
    if (options.isReady?.(from, to) === false) return false;
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
    const reach = Math.hypot(to.x - from.x, to.z - from.z) / 2 + radius + skin;
    const triangles: Triangle[] = [];
    for (const entry of collisionEntries(midpoint, reach)) {
      if (entry.mesh.isDisposed()) return false;
      const bounds = entry.mesh.getBoundingInfo().boundingBox;
      if (bounds.minimumWorld.y > Math.max(from.y, to.y) + height + skin || bounds.maximumWorld.y < Math.min(from.y, to.y)) continue;
      const source = geometry(entry), offsets = new Set<number>();
      forCells(midpoint.x - reach, midpoint.z - reach, midpoint.x + reach, midpoint.z + reach, key => { for (const offset of source.cells.get(key) ?? []) offsets.add(offset); });
      for (const offset of offsets) {
        const tri = triangle(source, offset), [a, b, c] = tri;
        if (Math.max(a.y, b.y, c.y) <= Math.min(from.y, to.y) + skin * .5 ||
          Math.min(a.y, b.y, c.y) > Math.max(from.y, to.y) + height + skin ||
          Math.max(a.x, b.x, c.x) < Math.min(from.x, to.x) - radius || Math.min(a.x, b.x, c.x) > Math.max(from.x, to.x) + radius ||
          Math.max(a.z, b.z, c.z) < Math.min(from.z, to.z) - radius || Math.min(a.z, b.z, c.z) > Math.max(from.z, to.z) + radius) continue;
        triangles.push(tri);
      }
    }
    if (!triangles.length) return true;
    const start = vector(from), end = vector(to), distance = Vector3.Distance(start, end);
    let fraction = 0;
    for (let iteration = 0; iteration < 128; iteration++) {
      const foot = Vector3.Lerp(start, end, fraction);
      const a = foot.add(new Vector3(0, radius + skin, 0)), b = foot.add(new Vector3(0, height - radius + skin, 0));
      let clearance = Infinity;
      for (const tri of triangles) clearance = Math.min(clearance, segmentTriangleDistance(a, b, tri) - radius);
      if (clearance <= 0.00001) return false;
      if (fraction >= 1 || distance < 1e-10) return true;
      fraction = Math.min(1, fraction + clearance * 0.9 / distance);
    }
    return false;
  }
  function clearStep(from: WorldPosition, to: WorldPosition): boolean {
    const top = Math.max(from.y, to.y);
    return sweep(from, { ...from, y: top }) && sweep({ ...from, y: top }, { ...to, y: top }) && sweep({ ...to, y: top }, to);
  }
  function supportedPath(from: WorldPosition, to: WorldPosition): boolean {
    for (const offset of footprint) {
      const a = { ...from, x: from.x + offset[0]! * (radius + skin), z: from.z + offset[1]! * (radius + skin) };
      const b = { ...to, x: to.x + offset[0]! * (radius + skin), z: to.z + offset[1]! * (radius + skin) };
      const intervals: [number, number][] = [];
      const collect = (source: Geometry, upwardOnly: boolean) => {
        const offsets = new Set<number>();
        forCells(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), key => { for (const item of source.cells.get(key) ?? []) offsets.add(item); });
        for (const item of offsets) {
          const interval = supportInterval(triangle(source, item), a, b, upwardOnly);
          if (interval) intervals.push(interval);
        }
      };
      for (const source of terrain) collect(source, false);
      for (const entry of entries({ x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2 }, Math.hypot(b.x - a.x, b.z - a.z) / 2)) {
        if (entry.supportsWalking && !entry.mesh.isDisposed()) collect(geometry(entry), true);
      }
      intervals.sort((first, second) => first[0] - second[0]);
      let covered = 0;
      for (const interval of intervals) {
        if (interval[0] > covered + 1e-7) return false;
        covered = Math.max(covered, interval[1]);
        if (covered >= 1 - 1e-7) break;
      }
      if (covered < 1 - 1e-7) return false;
    }
    return true;
  }
  function findSpawn(offset: WorldPosition, occupied: readonly WorldPosition[] = []): WorldPosition | null {
    const target = { x: options.origin.x + offset.x, y: options.origin.y + offset.y, z: options.origin.z + offset.z };
    for (let ring = 0; ring <= 8; ring++) for (let angle = 0; angle < (ring ? 12 : 1); angle++) {
      const candidate = { x: target.x + Math.cos(angle * Math.PI / 6) * ring * .5, y: target.y + maxStep, z: target.z + Math.sin(angle * Math.PI / 6) * ring * .5 };
      if (occupied.some(other => Math.hypot(other.x - candidate.x, other.z - candidate.z) < 1.4)) continue;
      const terrainY = terrainGroundAt(candidate, 12);
      if (terrainY === null) continue;
      const point = grounded({ ...candidate, y: terrainY.position.y });
      if (point && sweep(point.position, point.position)) return point.position;
    }
    return null;
  }
  function groundContact(point: WorldPosition): WorldGroundContact | null {
    const meshCount = options.obstacleMeshes().length;
    if (meshCount !== projectedMeshCount) { projectedGround.clear(); projectedMeshCount = meshCount; }
    const key = `${point.x}:${point.y}:${point.z}`;
    const cached = projectedGround.get(key);
    if (cached) return cached;
    const result = grounded(point);
    if (result) {
      if (projectedGround.size >= 64) projectedGround.delete(projectedGround.keys().next().value!);
      projectedGround.set(key, result);
    }
    return result;
  }
  return {
    origin: { x: options.origin.x, y: options.origin.y, z: options.origin.z },
    ground: point => groundContact(point)?.position ?? null,
    groundContact,
    destination: point => grounded(point, .8)?.position ?? null,
    spawn: findSpawn,
    move(from, to) {
      if (!finite(from) || !finite(to)) return { position: from, blocked: true };
      const samples = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .025));
      if (samples > 2048) return { position: from, blocked: true };
      let previous = from, contact: WorldGroundContact | undefined;
      for (let sample = 1; sample <= samples; sample++) {
        const fraction = sample / samples;
        const next = grounded({ x: from.x + (to.x - from.x) * fraction, y: previous.y, z: from.z + (to.z - from.z) * fraction });
        if (!next || Math.abs(next.position.y - previous.y) > maxStep + skin || !supportedPath(previous, next.position) || !clearStep(previous, next.position)) {
          return { position: previous, blocked: true, ...(contact ? { contact } : {}) };
        }
        previous = next.position; contact = next;
      }
      return { position: previous, blocked: false, ...(contact ? { contact } : {}) };
    },
  };
}

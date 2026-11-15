import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { WorldPosition } from "../../world/sourceFrame";
import { moverPose, type NativeMoverRecord } from "./nativeMoverManifest";

interface Geometry { vertices: Vector3[]; indices: number[]; local: Matrix }
const point = (v: Vector3): WorldPosition => ({ x: v.x, y: v.y, z: v.z });
function closestSegment(p: WorldPosition, a: Vector3, b: Vector3): Vector3 {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length)) : 0;
  return Vector3.Lerp(a, b, t);
}
function inTriangle(p: WorldPosition, a: Vector3, b: Vector3, c: Vector3): boolean {
  const side = (u: Vector3, v: Vector3) => (v.x - u.x) * (p.z - u.z) - (v.z - u.z) * (p.x - u.x);
  const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  return Math.abs(area) > 1e-10 && [side(a, b), side(b, c), side(c, a)].every(n => n * Math.sign(area) >= -1e-9);
}
export class NativeMover {
  private readonly closed;
  private readonly open;
  private readonly geometry: Geometry[];
  private fraction = 0;
  private destination: 0 | 1 = 0;
  private blocked = false;
  readonly closedFootY: number;
  private readonly minimumY: number;
  private readonly maximumY: number;
  constructor(readonly source: NativeMoverRecord, readonly root: TransformNode, readonly meshes: readonly Mesh[]) {
    this.closed = moverPose(source.closedMatrix); this.open = moverPose(source.openMatrix);
    root.setPreTransformMatrix(Matrix.FromArray(source.closedMatrix)); root.computeWorldMatrix(true);
    const inverse = Matrix.Invert(root.getWorldMatrix());
    this.geometry = meshes.map(mesh => {
      mesh.computeWorldMatrix(true);
      const positions = mesh.getVerticesData("position"), indices = mesh.getIndices();
      if (!positions?.length || !indices?.length || indices.length % 3) throw new Error("Native mover has no indexed geometry.");
      const vertices = Array.from({ length: positions.length / 3 }, (_, i) => Vector3.FromArray(positions, i * 3));
      return { vertices, indices: Array.from(indices), local: mesh.getWorldMatrix().multiply(inverse) };
    });
    const closedY = this.worldVertices(0).flatMap(vertices => vertices.map(v => v.y));
    const allY = [...closedY, ...this.worldVertices(1).flatMap(vertices => vertices.map(v => v.y))];
    this.closedFootY = Math.min(...closedY); this.minimumY = Math.min(...allY); this.maximumY = Math.max(...allY);
    if (!Number.isFinite(this.closedFootY)) throw new Error("Native mover bounds are invalid.");
  }
  matrixAt(fraction: number): Matrix {
    return Matrix.Compose(this.closed.scale, Quaternion.Slerp(this.closed.rotation, this.open.rotation, fraction),
      Vector3.Lerp(this.closed.position, this.open.position, fraction));
  }
  private worldVertices(fraction = this.fraction): Vector3[][] {
    const pose = this.matrixAt(fraction);
    return this.geometry.map(g => { const matrix = g.local.multiply(pose); return g.vertices.map(v => Vector3.TransformCoordinates(v, matrix)); });
  }
  nearest(position: WorldPosition, fraction = this.fraction): WorldPosition {
    let closest = Vector3.Zero(), distance = Infinity;
    for (const [index, vertices] of this.worldVertices(fraction).entries()) {
      const indices = this.geometry[index]!.indices;
      for (let i = 0; i < indices.length; i += 3) {
        const a = vertices[indices[i]!]!, b = vertices[indices[i + 1]!]!, c = vertices[indices[i + 2]!]!;
        if (inTriangle(position, a, b, c)) return { x: position.x, y: this.closedFootY, z: position.z };
        for (const candidate of [closestSegment(position, a, b), closestSegment(position, b, c), closestSegment(position, c, a)]) {
          const d = (candidate.x - position.x) ** 2 + (candidate.z - position.z) ** 2;
          if (d < distance) { distance = d; closest = candidate; }
        }
      }
    }
    return { ...point(closest), y: this.closedFootY };
  }
  distance(position: WorldPosition, fraction = this.fraction): number {
    const nearest = this.nearest(position, fraction);
    return Math.hypot(nearest.x - position.x, nearest.z - position.z);
  }
  requestToggle(): void { this.destination = this.destination ? 0 : 1; this.blocked = false; }
  advance(seconds: number, player?: { position: WorldPosition; radius: number; height: number }): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid mover elapsed time.");
    if (this.root.isDisposed() || this.fraction === this.destination) return;
    const next = this.fraction + Math.sign(this.destination - this.fraction) * Math.min(Math.abs(this.destination - this.fraction), seconds / this.source.moveTimeSeconds);
    if (player && player.position.y + player.height > this.minimumY && player.position.y < this.maximumY) {
      const steps = Math.max(1, Math.ceil(Math.abs(next - this.fraction) / .02));
      for (let i = 1; i <= steps; i++) if (this.distance(player.position, this.fraction + (next - this.fraction) * i / steps) < player.radius + .025) {
        this.blocked = true; return;
      }
    }
    this.blocked = false; this.fraction = next;
    this.root.setPreTransformMatrix(this.matrixAt(this.fraction)); this.root.computeWorldMatrix(true);
    for (const mesh of this.meshes) mesh.computeWorldMatrix(true);
  }
  inspection() { return { id: this.source.id, serverObject: { ...this.source.serverObject }, fraction: this.fraction,
    target: this.destination ? "open" as const : "closed" as const,
    state: this.blocked ? "blocked" as const : this.fraction === this.destination ? this.destination ? "open" as const : "closed" as const : this.destination ? "opening" as const : "closing" as const,
    matrix: Array.from(this.root.getWorldMatrix().asArray()), meshIds: this.meshes.map(mesh => mesh.id) }; }
}

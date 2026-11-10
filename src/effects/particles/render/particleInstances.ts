import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vector3 } from "../../../shared/math/vector3";
import { sourcePositionToWorld } from "../../../world/sourceFrame";
import type { EmitterSimulation } from "../sim/emitterActor";
import { PARTICLE_CONSTANTS } from "../sim/emitterConstants";
import type { Rotator } from "../sim/emitterRecords";
import { IDENTITY_ROTATOR, rotateByAxes, rotatorAxes } from "../sim/particleRotation";
import { readSlotColor, readSlotVector } from "../sim/particleState";

export const PARTICLE_INSTANCE_ATTRIBUTES = { colour: "particleColour", atlas: "particleAtlas", sprite: "particleSprite" } as const;
export const PARTICLE_MATRIX_STRIDE = 16;
export const PARTICLE_VECTOR_STRIDE = 4;

export interface ParticleInstanceBuffers {
  readonly capacity: number;
  readonly matrices: Float32Array;
  readonly colours: Float32Array;
  readonly atlasRectangles: Float32Array;
  readonly spriteShapes: Float32Array;
}

export interface ParticleInstanceFrame {
  readonly emitterRotation: Rotator;
  readonly colourOverride: readonly [number, number, number, number] | null;
  readonly atlasOverride: readonly [number, number, number, number] | null;
}

const radiansPerSpinUnit = 2 * Math.PI / PARTICLE_CONSTANTS.spinUnitsPerTurn.runtimeDefault;
const unrotatedFrame: ParticleInstanceFrame = { emitterRotation: IDENTITY_ROTATOR, colourOverride: null, atlasOverride: null };

function sourceDirectionToWorld(direction: Vector3, length: number): Vector3 {
  return { x: direction.x * length, y: direction.z * length, z: direction.y * length };
}

export function createParticleInstanceBuffers(capacity: number): ParticleInstanceBuffers {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError(`Particle instance capacity ${capacity} must be a positive integer.`);
  return {
    capacity,
    matrices: new Float32Array(capacity * PARTICLE_MATRIX_STRIDE),
    colours: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
    atlasRectangles: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
    spriteShapes: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
  };
}

function writeMatrix(matrices: Float32Array, instance: number, columns: readonly [Vector3, Vector3, Vector3], translation: Vector3): void {
  const offset = instance * PARTICLE_MATRIX_STRIDE;
  columns.forEach((column, columnIndex) => matrices.set([column.x, column.y, column.z, 0], offset + columnIndex * 4));
  matrices.set([translation.x, translation.y, translation.z, 1], offset + 12);
}

function atlasRectangle(emitter: EmitterSimulation, slot: number): readonly [number, number, number, number] {
  if (emitter.kind !== "sprite") return [1, 1, 0, 0];
  const columnCount = Math.max(1, emitter.record.TextureUSubdivisions), rowCount = Math.max(1, emitter.record.TextureVSubdivisions);
  const cell = emitter.atlasCell(slot);
  return [1 / columnCount, 1 / rowCount, cell.column / columnCount, cell.row / rowCount];
}

export function writeParticleInstances(emitter: EmitterSimulation, buffers: ParticleInstanceBuffers, frame: ParticleInstanceFrame = unrotatedFrame): number {
  const liveSlots = emitter.liveSlots();
  if (liveSlots.length > buffers.capacity) throw new RangeError(`Emitter ${emitter.record.object} has ${liveSlots.length} live particles for ${buffers.capacity} instances.`);
  const emitterAxes = rotatorAxes(frame.emitterRotation), { columns } = emitter;
  liveSlots.forEach((slot, instance) => {
    const location = sourcePositionToWorld(rotateByAxes(readSlotVector(columns.location, slot), emitterAxes));
    const size = readSlotVector(columns.size, slot), vectorOffset = instance * PARTICLE_VECTOR_STRIDE;
    if (emitter.kind === "sprite") {
      writeMatrix(buffers.matrices, instance, [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], location);
      const halfExtent = sourcePositionToWorld({ x: size.x, y: 0, z: size.y });
      buffers.spriteShapes.set([halfExtent.x, halfExtent.y, emitter.spriteRoll(slot) * radiansPerSpinUnit, 0], vectorOffset);
    } else {
      const axes = rotatorAxes(emitter.meshRotator(slot));
      const forward = rotateByAxes(axes.forward, emitterAxes), right = rotateByAxes(axes.right, emitterAxes), up = rotateByAxes(axes.up, emitterAxes);
      writeMatrix(buffers.matrices, instance, [sourceDirectionToWorld(forward, size.x), sourceDirectionToWorld(up, size.z), sourceDirectionToWorld(right, size.y)], location);
      buffers.spriteShapes.set([0, 0, 0, 0], vectorOffset);
    }
    buffers.colours.set(frame.colourOverride ?? readSlotColor(emitter.columns, slot), vectorOffset);
    buffers.atlasRectangles.set(frame.atlasOverride ?? atlasRectangle(emitter, slot), vectorOffset);
  });
  return liveSlots.length;
}

export function attachParticleInstanceBuffers(mesh: Mesh, buffers: ParticleInstanceBuffers): void {
  mesh.thinInstanceSetBuffer("matrix", buffers.matrices, PARTICLE_MATRIX_STRIDE, false);
  mesh.thinInstanceSetBuffer(PARTICLE_INSTANCE_ATTRIBUTES.colour, buffers.colours, PARTICLE_VECTOR_STRIDE, false);
  mesh.thinInstanceSetBuffer(PARTICLE_INSTANCE_ATTRIBUTES.atlas, buffers.atlasRectangles, PARTICLE_VECTOR_STRIDE, false);
  mesh.thinInstanceSetBuffer(PARTICLE_INSTANCE_ATTRIBUTES.sprite, buffers.spriteShapes, PARTICLE_VECTOR_STRIDE, false);
  mesh.doNotSyncBoundingInfo = true;
  mesh.alwaysSelectAsActiveMesh = true;
  uploadParticleInstances(mesh, 0);
}

export function uploadParticleInstances(mesh: Mesh, instanceCount: number): void {
  mesh.thinInstanceCount = instanceCount;
  mesh.isVisible = instanceCount > 0;
  if (instanceCount === 0) return;
  mesh.thinInstanceBufferUpdated("matrix");
  for (const attribute of Object.values(PARTICLE_INSTANCE_ATTRIBUTES)) mesh.thinInstanceBufferUpdated(attribute);
}

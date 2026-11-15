import type { Vector3 } from "../../../shared/math/vector3";
import type { RandomStream } from "../../../shared/random";
import type { ParticleEmitterRecord, Rotator } from "./emitterRecords";

export const PARTICLE_FLAG = { active: 1, justSpawned: 2 } as const;

export interface ParticleColumns {
  readonly capacity: number;
  readonly location: Float32Array;
  readonly oldLocation: Float32Array;
  readonly startLocation: Float32Array;
  readonly velocity: Float32Array;
  readonly velocityMultiplier: Float32Array;
  readonly sprayAcceleration: Float32Array;
  readonly startSize: Float32Array;
  readonly size: Float32Array;
  readonly startSpin: Float32Array;
  readonly spinRate: Float32Array;
  readonly revolutionCenter: Float32Array;
  readonly revolutionRate: Float32Array;
  readonly revolutionMultiplier: Float32Array;
  readonly colorMultiplier: Float32Array;
  readonly color: Float32Array;
  readonly time: Float32Array;
  readonly maxLifetime: Float32Array;
  readonly mass: Float32Array;
  readonly subdivision: Int32Array;
  readonly flags: Uint8Array;
}

export interface EmitterCounters {
  activeSlots: number;
  nextSlot: number;
  spawnFraction: number;
  otherEmitterCursor: number;
  delaySeconds: number;
  initialized: boolean;
  resetTimerSeconds: number;
  inactive: boolean;
  inactiveSeconds: number;
  lastStepSeconds: number;
  lastOwnerLocation: Vector3;
  disabled: boolean;
  dead: boolean;
  warmedUp: boolean;
  killPending: boolean;
  spawnOnTrigger: number;
}

export interface OwnerPose {
  readonly location: Vector3;
  readonly rotation: Rotator;
}

export interface EmitterClassOverrides {
  afterInitialize(runtime: EmitterRuntime): void;
  afterSpawnParticle(runtime: EmitterRuntime): void;
  afterUpdateParticles(runtime: EmitterRuntime, stepSeconds: number, context: EmitterStepContext): void;
}

export interface EmitterRuntime {
  record: ParticleEmitterRecord;
  readonly stream: RandomStream;
  columns: ParticleColumns;
  readonly counters: EmitterCounters;
  readonly uniformSize: boolean;
  readonly classOverrides: EmitterClassOverrides | null;
}

export interface EmitterStepContext {
  readonly owner: OwnerPose;
  readonly emitterRotation: Rotator;
  readonly globalOffset: Vector3;
  readonly actorAutoReset: boolean;
  readonly actorAutoDestroy: boolean;
  readonly siblings: readonly EmitterRuntime[];
}

export function createParticleColumns(capacity: number): ParticleColumns {
  const vectorColumn = () => new Float32Array(capacity * 3);
  return {
    capacity,
    location: vectorColumn(), oldLocation: vectorColumn(), startLocation: vectorColumn(), velocity: vectorColumn(),
    velocityMultiplier: vectorColumn(), sprayAcceleration: vectorColumn(), startSize: vectorColumn(), size: vectorColumn(),
    startSpin: vectorColumn(), spinRate: vectorColumn(), revolutionCenter: vectorColumn(), revolutionRate: vectorColumn(),
    revolutionMultiplier: vectorColumn(), colorMultiplier: vectorColumn(), color: new Float32Array(capacity * 4),
    time: new Float32Array(capacity), maxLifetime: new Float32Array(capacity), mass: new Float32Array(capacity),
    subdivision: new Int32Array(capacity), flags: new Uint8Array(capacity),
  };
}

export function createEmitterCounters(disabled: boolean): EmitterCounters {
  return {
    activeSlots: 0, nextSlot: 0, spawnFraction: 0, otherEmitterCursor: 0, delaySeconds: 0, initialized: false, resetTimerSeconds: 0,
    inactive: false, inactiveSeconds: 0, lastStepSeconds: 0, lastOwnerLocation: { x: 0, y: 0, z: 0 }, disabled, dead: false, warmedUp: false,
    killPending: false, spawnOnTrigger: 0,
  };
}

export function readSlotVector(column: Float32Array, slot: number): Vector3 {
  const offset = slot * 3;
  return { x: column[offset]!, y: column[offset + 1]!, z: column[offset + 2]! };
}

export function writeSlotVector(column: Float32Array, slot: number, vector: Vector3): void {
  const offset = slot * 3;
  column[offset] = Math.fround(vector.x);
  column[offset + 1] = Math.fround(vector.y);
  column[offset + 2] = Math.fround(vector.z);
}

export function readSlotColor(columns: ParticleColumns, slot: number): readonly [number, number, number, number] {
  const offset = slot * 4, color = columns.color;
  return [color[offset]!, color[offset + 1]!, color[offset + 2]!, color[offset + 3]!];
}

export function writeSlotColor(columns: ParticleColumns, slot: number, rgba: readonly [number, number, number, number]): void {
  const offset = slot * 4;
  rgba.forEach((channel, channelIndex) => { columns.color[offset + channelIndex] = Math.fround(channel); });
}

export function hasParticleFlag(columns: ParticleColumns, slot: number, flag: number): boolean {
  return (columns.flags[slot]! & flag) !== 0;
}

export function setParticleFlag(columns: ParticleColumns, slot: number, flag: number, enabled: boolean): void {
  columns.flags[slot] = enabled ? columns.flags[slot]! | flag : columns.flags[slot]! & ~flag;
}

export function countVisitedSlots(columns: ParticleColumns, counters: EmitterCounters): number {
  return Math.min(columns.capacity, counters.activeSlots);
}

export function listLiveSlots(columns: ParticleColumns, counters: EmitterCounters): number[] {
  const slotLimit = countVisitedSlots(columns, counters), liveSlots: number[] = [];
  for (let slot = 0; slot < slotLimit; slot += 1) if (hasParticleFlag(columns, slot, PARTICLE_FLAG.active)) liveSlots.push(slot);
  return liveSlots;
}

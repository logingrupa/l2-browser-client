import type { Vector3 } from "../../../shared/math/vector3";
import { PARTICLE_CONSTANTS } from "./emitterConstants";

export const SIMULATED_EMITTER_CLASSES = ["Engine.SpriteEmitter", "Engine.MeshEmitter"] as const;
export type SimulatedEmitterClass = (typeof SIMULATED_EMITTER_CLASSES)[number];
export type FieldProvenance = "authored" | "class-default" | "ue-zero";

export interface FloatRange { readonly min: number; readonly max: number }
export interface RangeVector { readonly x: FloatRange; readonly y: FloatRange; readonly z: FloatRange }
export interface Rotator { readonly pitch: number; readonly yaw: number; readonly roll: number }
export interface FadeFactor { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
export interface CurveKey { readonly relativeTime: number; readonly values: readonly number[] }

export interface EmitterSourceRecord {
  readonly object: string;
  readonly class?: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly effectiveProperties: Readonly<Record<string, unknown>>;
}

export class EmitterRecordError extends Error {
  constructor(object: string, message: string) {
    super(`Emitter record ${object}: ${message}`);
    this.name = "EmitterRecordError";
  }
}

const enumOrdinalCounts = {
  "coordinate-system": 5, "draw-style": 7, "direction-usage": 8, "start-location-shape": 4,
  "velocity-direction": 4, "rotation-source": 4, "mesh-spawning": 3, "skeletal-location-update": 3,
} as const;
type EnumFieldKind = keyof typeof enumOrdinalCounts;
type FieldKind = "boolean" | "float" | "integer" | "range" | "range-vector" | "vector" | "fade-factor" | "rotator"
  | "size-curve" | "color-curve" | "velocity-curve" | "revolution-curve" | "object-reference" | "emitter-list" | EnumFieldKind;
type FieldValue<Kind extends FieldKind> =
  Kind extends "boolean" ? boolean :
  Kind extends "range" ? FloatRange :
  Kind extends "range-vector" ? RangeVector :
  Kind extends "vector" ? Vector3 :
  Kind extends "fade-factor" ? FadeFactor :
  Kind extends "rotator" ? Rotator :
  Kind extends "size-curve" | "color-curve" | "velocity-curve" | "revolution-curve" ? readonly CurveKey[] :
  Kind extends "object-reference" ? string | null :
  Kind extends "emitter-list" ? readonly string[] :
  number;
interface FieldSpecification { readonly kind: FieldKind; readonly classDefault: boolean }
type FieldTable = Readonly<Record<string, FieldSpecification>>;
type FieldValues<Table extends FieldTable> = { readonly [Name in keyof Table]: FieldValue<Table[Name]["kind"]> };

const field = <Kind extends FieldKind>(kind: Kind) => ({ kind, classDefault: false as boolean });
const classDefaultField = <Kind extends FieldKind>(kind: Kind) => ({ kind, classDefault: true as boolean });

const particleEmitterFields = {
  CoordinateSystem: classDefaultField("coordinate-system"), MaxParticles: classDefaultField("integer"),
  RespawnDeadParticles: classDefaultField("boolean"), AutomaticInitialSpawning: classDefaultField("boolean"),
  DrawStyle: classDefaultField("draw-style"), LifetimeRange: classDefaultField("range"), StartSizeRange: classDefaultField("range-vector"),
  UseRegularSizeScale: classDefaultField("boolean"), SpinCCWorCW: classDefaultField("vector"), MaxAbsVelocity: classDefaultField("vector"),
  TriggerDisabled: classDefaultField("boolean"), StartMassRange: classDefaultField("range"), Opacity: classDefaultField("float"),
  FadeInFactor: classDefaultField("fade-factor"), FadeOutFactor: classDefaultField("fade-factor"),
  AddLocationFromOtherEmitter: classDefaultField("integer"), AddVelocityFromOtherEmitter: classDefaultField("integer"),
  SpawnFromOtherEmitter: classDefaultField("integer"), AddVelocityMultiplierRange: classDefaultField("range-vector"),
  ColorMultiplierRange: classDefaultField("range-vector"), AlphaTest: classDefaultField("boolean"), ZTest: classDefaultField("boolean"),
  ZWrite: field("boolean"), Acceleration: field("vector"), IndependentSprayAccel: field("boolean"), UseCollision: field("boolean"), UseCollisionPlanes: field("boolean"),
  UseColorScale: field("boolean"), ColorScale: field("color-curve"), ColorScaleRepeats: field("float"),
  FadeOutStartTime: field("float"), FadeOut: field("boolean"), FadeInEndTime: field("float"), FadeIn: field("boolean"),
  UseActorForces: field("boolean"), WeatherEffect: field("boolean"), AutoDestroy: field("boolean"), AutoReset: field("boolean"),
  Disabled: field("boolean"), AutoResetTimeRange: field("range"), StartLocationOffset: field("vector"), StartLocationRange: field("range-vector"),
  StartLocationShape: field("start-location-shape"), SphereRadiusRange: field("range"), StartLocationPolarRange: field("range-vector"),
  MeshSpawning: field("mesh-spawning"), UseRevolution: field("boolean"), RevolutionCenterOffsetRange: field("range-vector"),
  RevolutionsPerSecondRange: field("range-vector"), UseRevolutionScale: field("boolean"), RevolutionScale: field("revolution-curve"),
  RevolutionScaleRepeats: field("float"), UseRotationFrom: field("rotation-source"), SpinParticles: field("boolean"),
  RotationOffset: field("rotator"), SpinsPerSecondRange: field("range-vector"), StartSpinRange: field("range-vector"),
  UseSizeScale: field("boolean"), SizeScale: field("size-curve"), SizeScaleRepeats: field("float"), UniformSize: field("boolean"),
  UseSkeletalLocationAs: field("skeletal-location-update"), ParticlesPerSecond: field("float"), InitialParticlesPerSecond: field("float"),
  TextureUSubdivisions: field("integer"), TextureVSubdivisions: field("integer"), BlendBetweenSubdivisions: field("boolean"),
  SubdivisionStart: field("integer"), SubdivisionEnd: field("integer"), UseRandomSubdivision: field("boolean"),
  SecondsBeforeInactive: field("float"), InitialTimeRange: field("range"), InitialDelayRange: field("range"),
  StartVelocityRange: field("range-vector"), StartVelocityRadialRange: field("range"), VelocityLossRange: field("range-vector"),
  GetVelocityDirectionFrom: field("velocity-direction"), UseVelocityScale: field("boolean"), VelocityScale: field("velocity-curve"),
  VelocityScaleRepeats: field("float"), WarmupTicksPerSecond: field("float"), RelativeWarmupTime: field("float"),
} as const satisfies FieldTable;
const spriteEmitterFields = { ...particleEmitterFields, ProjectionNormal: classDefaultField("vector"), UseDirectionAs: field("direction-usage") } as const;
const meshEmitterFields = {
  ...particleEmitterFields, UseMeshBlendMode: classDefaultField("boolean"), StaticMesh: field("object-reference"),
  RenderTwoSided: field("boolean"), UseParticleColor: field("boolean"),
} as const;
const emitterActorFields = {
  SpeedRate: classDefaultField("float"), bNoDelete: classDefaultField("boolean"), DrawScale: classDefaultField("float"),
  DrawScale3D: classDefaultField("vector"), VisibilityInterpRange: classDefaultField("float"), bSetSizeScale: classDefaultField("boolean"),
  Emitters: field("emitter-list"), AutoDestroy: field("boolean"), AutoReset: field("boolean"), AutoReplay: field("boolean"),
  GlobalOffsetRange: field("range-vector"), TimeTillResetRange: field("range"), bRotEmitter: field("boolean"), RotPerSecond: field("rotator"),
  bStatic: field("boolean"), LifeSpan: field("float"), VisibleLimit: field("range"),
} as const satisfies FieldTable;

export const MAXIMUM_PARTICLES_PER_EMITTER = PARTICLE_CONSTANTS.maximumParticlesGuard.runtimeDefault;

interface ParsedRecordBase { readonly object: string; readonly provenanceByField: Readonly<Record<string, FieldProvenance>> }
export type SpriteEmitterRecord = ParsedRecordBase & { readonly emitterClass: "Engine.SpriteEmitter" } & FieldValues<typeof spriteEmitterFields>;
export type MeshEmitterRecord = ParsedRecordBase & { readonly emitterClass: "Engine.MeshEmitter" } & FieldValues<typeof meshEmitterFields>;
export type ParticleEmitterRecord = SpriteEmitterRecord | MeshEmitterRecord;
export type EmitterActorRecord = ParsedRecordBase & FieldValues<typeof emitterActorFields>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function readFieldValue(kind: FieldKind, value: unknown): unknown {
  const readNumber = (entry: unknown) => isFiniteNumber(entry) ? entry : undefined;
  const readRange = (entry: unknown) => isRecord(entry) && isFiniteNumber(entry.Min) && isFiniteNumber(entry.Max) ? { min: entry.Min, max: entry.Max } : undefined;
  const readVector = (entry: unknown) => isRecord(entry) && isFiniteNumber(entry.X) && isFiniteNumber(entry.Y) && isFiniteNumber(entry.Z)
    ? { x: entry.X, y: entry.Y, z: entry.Z } : undefined;
  const readCurve = (valueOf: (key: Record<string, unknown>) => number[] | undefined) => {
    if (!Array.isArray(value)) return undefined;
    const keys = value.map(key => isRecord(key) && isFiniteNumber(key.RelativeTime) ? { relativeTime: key.RelativeTime, values: valueOf(key) } : undefined);
    return keys.every(key => key?.values !== undefined) ? keys : undefined;
  };
  switch (kind) {
    case "boolean": return typeof value === "boolean" ? value : undefined;
    case "float": return readNumber(value);
    case "integer": return Number.isSafeInteger(value) ? value : undefined;
    case "range": return readRange(value);
    case "range-vector": {
      if (!isRecord(value)) return undefined;
      const [x, y, z] = [readRange(value.X), readRange(value.Y), readRange(value.Z)];
      return x && y && z ? { x, y, z } : undefined;
    }
    case "vector": return readVector(value);
    case "fade-factor": return isRecord(value) && isFiniteNumber(value.W) && readVector(value) ? { ...readVector(value)!, w: value.W } : undefined;
    case "rotator": return isRecord(value) && Number.isSafeInteger(value.Pitch) && Number.isSafeInteger(value.Yaw) && Number.isSafeInteger(value.Roll)
      ? { pitch: value.Pitch, yaw: value.Yaw, roll: value.Roll } : undefined;
    case "size-curve": return readCurve(key => isFiniteNumber(key.RelativeSize) ? [key.RelativeSize] : undefined);
    case "color-curve": return readCurve(key => {
      const color = key.Color;
      if (!isRecord(color)) return undefined;
      const channels = [color.R, color.G, color.B, color.A];
      return channels.every(channel => Number.isInteger(channel) && Number(channel) >= 0 && Number(channel) <= 255) ? channels as number[] : undefined;
    });
    case "velocity-curve": return readCurve(key => { const vector = readVector(key.RelativeVelocity); return vector && [vector.x, vector.y, vector.z]; });
    case "revolution-curve": return readCurve(key => { const vector = readVector(key.RelativeRevolution); return vector && [vector.x, vector.y, vector.z]; });
    case "object-reference": return value === null ? null : isRecord(value) && typeof value.object === "string" && value.object.length > 0 ? value.object : undefined;
    case "emitter-list": return Array.isArray(value) && value.every(entry => isRecord(entry) && typeof entry.symbol === "string" && entry.symbol.length > 0)
      ? value.map(entry => (entry as { symbol: string }).symbol) : undefined;
    default: return Number.isInteger(value) && Number(value) >= 0 && Number(value) < enumOrdinalCounts[kind] ? value : undefined;
  }
}

function ueZeroValue(kind: FieldKind): unknown {
  const zeroRange = { min: 0, max: 0 };
  switch (kind) {
    case "boolean": return false;
    case "range": return zeroRange;
    case "range-vector": return { x: zeroRange, y: zeroRange, z: zeroRange };
    case "vector": return { x: 0, y: 0, z: 0 };
    case "fade-factor": return { x: 0, y: 0, z: 0, w: 0 };
    case "rotator": return { pitch: 0, yaw: 0, roll: 0 };
    case "size-curve": case "color-curve": case "velocity-curve": case "revolution-curve": case "emitter-list": return [];
    case "object-reference": return null;
    default: return 0;
  }
}

function readFields<Table extends FieldTable>(source: EmitterSourceRecord, table: Table): ParsedRecordBase & FieldValues<Table> {
  const { object, properties, effectiveProperties } = source;
  if (!isRecord(properties) || !isRecord(effectiveProperties)) throw new EmitterRecordError(object, "properties and effectiveProperties must be objects.");
  const values: Record<string, unknown> = {}, provenanceByField: Record<string, FieldProvenance> = {};
  for (const [name, specification] of Object.entries(table)) {
    const authored = Object.hasOwn(properties, name), effective = Object.hasOwn(effectiveProperties, name);
    if (authored && !effective) throw new EmitterRecordError(object, `authored field ${name} is missing from effectiveProperties.`);
    if (!effective && specification.classDefault) throw new EmitterRecordError(object, `field ${name} has no Interlude class default in effectiveProperties.`);
    if (!effective) { values[name] = ueZeroValue(specification.kind); provenanceByField[name] = "ue-zero"; continue; }
    const value = readFieldValue(specification.kind, effectiveProperties[name]);
    if (value === undefined) throw new EmitterRecordError(object, `field ${name} is not a valid ${specification.kind} value.`);
    values[name] = value;
    provenanceByField[name] = authored ? "authored" : "class-default";
  }
  return { ...values, object, provenanceByField } as ParsedRecordBase & FieldValues<Table>;
}

function requireObjectName(source: EmitterSourceRecord): void {
  if (!isRecord(source) || typeof source.object !== "string" || source.object.length === 0) throw new EmitterRecordError("(unnamed)", "object must be a non-empty name.");
}

export function parseEmitterRecord(source: EmitterSourceRecord): ParticleEmitterRecord {
  requireObjectName(source);
  const emitterClass = source.class;
  let record: ParticleEmitterRecord;
  if (emitterClass === "Engine.SpriteEmitter") record = { ...readFields(source, spriteEmitterFields), emitterClass };
  else if (emitterClass === "Engine.MeshEmitter") record = { ...readFields(source, meshEmitterFields), emitterClass };
  else throw new EmitterRecordError(source.object, `class ${String(emitterClass)} is not a simulated emitter class.`);
  if (record.MaxParticles < 0 || record.MaxParticles > MAXIMUM_PARTICLES_PER_EMITTER) {
    throw new EmitterRecordError(source.object, `MaxParticles ${record.MaxParticles} is outside 0 to ${MAXIMUM_PARTICLES_PER_EMITTER}.`);
  }
  if (record.TextureUSubdivisions < 0 || record.TextureVSubdivisions < 0) throw new EmitterRecordError(source.object, "texture subdivisions must not be negative.");
  return Object.freeze(record);
}

export function parseEmitterActorRecord(source: EmitterSourceRecord): EmitterActorRecord {
  requireObjectName(source);
  const record = readFields(source, emitterActorFields);
  if (record.SpeedRate < 0) throw new EmitterRecordError(source.object, `SpeedRate ${record.SpeedRate} must not be negative.`);
  return Object.freeze(record);
}

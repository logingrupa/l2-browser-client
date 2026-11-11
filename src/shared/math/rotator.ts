import type { ReferenceConstantRow } from "../referenceConstant";
import type { Vector3 } from "./vector3";

export interface RotatorUnits {
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export interface RotatorAxes {
  readonly forward: Vector3;
  readonly right: Vector3;
  readonly up: Vector3;
}

export type RotatorRule = "sine-table" | "exact";
export type RotatorUse = "particle-revolution" | "camera-direction" | "texture-rotator" | "placement";

export const ROTATOR_CONSTANTS = {
  unitsPerTurn: {
    id: "rotator.units-per-turn",
    value: 65536,
    provenance: ".planning/reference/lineage2js/README.md conventions (65536 units per turn); lineage2js/src/assets/unreal/utils/rotator.ts:72-77",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 65536,
  },
  sineTableLength: {
    id: "fx.sine-table",
    value: 16384,
    provenance: "Core.dll 9462f87a FGlobalMath::FGlobalMath 0x10102333 -> 0x1014D330 fills SinTab at GMath +0x8C with 16384 entries f32(appSin(fl(2i * pi) / 16384)) (fild i, fadd st0, fmul pi, fmul 2^-14); appSin 0x1012D720 jumps to the CRT sin 0x1017C430, which takes its SSE2 path 0x10186480 because the CRT turns SSE2 math on at 0x1017FFEB from cpuid (an initialiser that runs before the GMath constructor) and every FPU exception is masked, so the half-turn entry is f32(sin(pi)) with no special case; only a CPU without SSE2 would take the x87 fsin path and store 1.2246063538223773e-16 there; SinTab and CosTab read (a >> 2) & 0x3FFF and ((a + 0x4000) >> 2) & 0x3FFF at 0x1010F430 and 0x1010F450",
    status: "corrected-interlude",
    interludeEvidence: "Core.dll 9462f87a FGlobalMath::FGlobalMath 0x1014D330, appSin 0x1012D720 -> CRT sin 0x1017C430",
    runtimeDefault: 16384,
  },
} as const satisfies Record<string, ReferenceConstantRow<number>>;

export const ROTATOR_RULE_BY_USE = {
  "particle-revolution": {
    id: "fx.revolution-angle",
    value: "sine-table",
    provenance: ".planning/reference/lineage2js/04-particles.md fx.revolution-angle: the angle is quantized to the sine table; lineage2js/src/objects/emitters/base-emitter.ts:1241-1251; Core.dll FVector::RotateAngleAxis 0x10103CBA -> 0x1010F8B0",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "sine-table",
  },
  "camera-direction": {
    id: "camera.direction",
    value: "sine-table",
    provenance: ".planning/reference/lineage2js/03-movement.md camera.direction: 16384-entry float32 sine table; lineage2js/src/rendering/camera/behind-view-camera.ts:43-47",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "sine-table",
  },
  "texture-rotator": {
    id: "uv.rotator-conversion",
    value: "exact",
    provenance: ".planning/reference/lineage2js/01-materials-fog.md uv.rotator-conversion: exact units * pi / 32768 until the Core.dll SinTab re-derivation; lineage2js shader-mesh-static.vs:407-416",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "exact",
  },
  placement: {
    id: "placement.rotator-conversion",
    value: "sine-table",
    provenance: "scripts/world/static_placement.py rotation_rows: static placement matrices use the 16384-entry float32 sine table, index (units >> 2) & 16383, which equals fx.sine-table and the Core.dll FGlobalMath builder at every entry (tests/pipeline/test_world_static_placement.py); the placement rule itself is not re-derived yet",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "sine-table",
  },
} as const satisfies Record<RotatorUse, ReferenceConstantRow<RotatorRule>>;

const rotatorUnitsPerHalfTurn = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault / 2;
const sineTableLength = ROTATOR_CONSTANTS.sineTableLength.runtimeDefault;
const rotatorUnitsPerSineTableEntry = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault / sineTableLength;
const sineTable = Float32Array.from({ length: sineTableLength }, (_, entryIndex) => Math.sin(entryIndex * 2 * Math.PI / sineTableLength));

export function rotatorUnitsToRadians(rotatorUnits: number): number {
  return rotatorUnits * Math.PI / rotatorUnitsPerHalfTurn;
}

export function rotatorSineFromTable(rotatorUnits: number): number {
  return sineTable[Math.floor(rotatorUnits / rotatorUnitsPerSineTableEntry) & (sineTableLength - 1)]!;
}

const rotatorUnitsPerTurn = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault;
const rotatorUnitsPerQuarterTurn = rotatorUnitsPerTurn / 4;
const radiansPerTurn = 2 * Math.PI;

export function rotatorAxes(rotator: RotatorUnits): RotatorAxes {
  const sine = (units: number) => rotatorSineFromTable(units), cosine = (units: number) => rotatorSineFromTable(units + rotatorUnitsPerQuarterTurn);
  const sinePitch = sine(rotator.pitch), cosinePitch = cosine(rotator.pitch);
  const sineYaw = sine(rotator.yaw), cosineYaw = cosine(rotator.yaw);
  const sineRoll = sine(rotator.roll), cosineRoll = cosine(rotator.roll);
  const rollSineTimesPitchSine = sineRoll * sinePitch, rollCosineTimesPitchSine = cosineRoll * sinePitch;
  return {
    forward: { x: cosinePitch * cosineYaw, y: cosinePitch * sineYaw, z: sinePitch },
    right: { x: rollSineTimesPitchSine * cosineYaw - cosineRoll * sineYaw, y: rollSineTimesPitchSine * sineYaw + cosineRoll * cosineYaw, z: -sineRoll * cosinePitch },
    up: { x: -(rollCosineTimesPitchSine * cosineYaw + sineRoll * sineYaw), y: sineRoll * cosineYaw - rollCosineTimesPitchSine * sineYaw, z: cosineRoll * cosinePitch },
  };
}

export function sineOfRadiansFromTable(radians: number): number {
  return rotatorSineFromTable(Math.trunc(radians * rotatorUnitsPerTurn / radiansPerTurn));
}

export function cosineOfRadiansFromTable(radians: number): number {
  return rotatorSineFromTable(rotatorUnitsPerQuarterTurn - Math.trunc(radians * rotatorUnitsPerTurn / -radiansPerTurn));
}

export function rotatorSineExact(rotatorUnits: number): number {
  return Math.sin(rotatorUnitsToRadians(rotatorUnits));
}

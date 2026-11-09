import type { ReferenceConstantRow } from "../referenceConstant";

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
    provenance: ".planning/reference/lineage2js/04-particles.md fx.sine-table: 16384 float32 entries over one turn, index floor(a / 4) mod 16384, cosine is the sine of a + 16384; lineage2js/src/assets/unreal/utils/rotator.ts:72-77; re-derive at Core.dll 9462f87a FGlobalMath::SinTab 0x10103F49 -> 0x1010F430 (POL-04)",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 16384,
  },
  sineTableHalfTurnEntry: {
    id: "fx.sine-table-half-turn",
    value: 1.2246063538223773e-16,
    provenance: ".planning/reference/lineage2js/03-movement.md camera.direction and 04-particles.md fx.sine-table: the half-turn entry is 1.2246063538223773e-16, not the float32 of Math.sin(pi); lineage2js/src/assets/unreal/utils/rotator.ts:72-77 (C4 Core.dll SinTab); re-derive at Interlude Core.dll 9462f87a FGlobalMath::SinTab (POL-04)",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 1.2246063538223773e-16,
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
    provenance: "scripts/world/static_placement.py rotation_rows: static placement matrices use the 16384-entry float32 sine table, index (units >> 2) & 16383, without the fx.sine-table-half-turn entry (it differs by 4.05e-21 at units 32768-32771 until one table is shared); .planning/reference/lineage2js/03-movement.md: placement matrices state their rotator rule, pinned against src/shared/math/rotator.ts",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "sine-table",
  },
} as const satisfies Record<RotatorUse, ReferenceConstantRow<RotatorRule>>;

const rotatorUnitsPerHalfTurn = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault / 2;
const sineTableLength = ROTATOR_CONSTANTS.sineTableLength.runtimeDefault;
const rotatorUnitsPerSineTableEntry = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault / sineTableLength;
const sineTableHalfTurnIndex = sineTableLength / 2;
const sineTable = Float32Array.from({ length: sineTableLength }, (_, entryIndex) => entryIndex === sineTableHalfTurnIndex
  ? ROTATOR_CONSTANTS.sineTableHalfTurnEntry.runtimeDefault
  : Math.sin(entryIndex * 2 * Math.PI / sineTableLength));

export function rotatorUnitsToRadians(rotatorUnits: number): number {
  return rotatorUnits * Math.PI / rotatorUnitsPerHalfTurn;
}

export function rotatorSineFromTable(rotatorUnits: number): number {
  return sineTable[Math.floor(rotatorUnits / rotatorUnitsPerSineTableEntry) & (sineTableLength - 1)]!;
}

const rotatorUnitsPerTurn = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault;
const rotatorUnitsPerQuarterTurn = rotatorUnitsPerTurn / 4;
const radiansPerTurn = 2 * Math.PI;

export function sineOfRadiansFromTable(radians: number): number {
  return rotatorSineFromTable(Math.trunc(radians * rotatorUnitsPerTurn / radiansPerTurn));
}

export function cosineOfRadiansFromTable(radians: number): number {
  return rotatorSineFromTable(rotatorUnitsPerQuarterTurn - Math.trunc(radians * rotatorUnitsPerTurn / -radiansPerTurn));
}

export function rotatorSineExact(rotatorUnits: number): number {
  return Math.sin(rotatorUnitsToRadians(rotatorUnits));
}

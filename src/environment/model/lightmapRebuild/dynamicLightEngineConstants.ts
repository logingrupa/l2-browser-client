import { confirmedInterludeConstantRow } from "../../../shared/referenceConstant";

const helpersReport = "DB-17 ordinary-lightmap-rebuild-helpers.json fb15ebf4";
const engineConstant = (virtualAddress: string, byteOffset: number, bytesHex: string) =>
  `${helpersReport}; Engine.dll 4dd2f63c constant ${virtualAddress} (file offset ${byteOffset}, bytes ${bytesHex})`;
const coreConstant = (virtualAddress: string, byteOffset: number, bytesHex: string, report: string) =>
  `${report}; Core.dll 9462f87a constant ${virtualAddress} (file offset ${byteOffset}, bytes ${bytesHex})`;
const listingEvidence = (evidence: string) => `${helpersReport}; ${evidence}`;

export const DYNAMIC_LIGHT_CONSTANTS = {
  worldLightRadiusOffset: confirmedInterludeConstantRow("dynamic-light.world-light-radius-offset", 1,
    `${engineConstant("0x10852238", 5576248, "000000000000f03f")}; ALight::WorldLightRadius 0x10343137 fadd before the fmul, LightRadius float at actor +0x3c4`),
  worldLightRadiusScale: confirmedInterludeConstantRow("dynamic-light.world-light-radius-scale", 25,
    `${engineConstant("0x10854b50", 5586768, "0000000000003940")}; ALight::WorldLightRadius 0x1034313d fmul, float32 store 0x10343143, FDynamicLight::Update stores dyn +0x20 at 0x1067502a`),
  vectorRotationUnitsPerTurn: confirmedInterludeConstantRow("dynamic-light.vector-rotation-units-per-turn", 65535,
    `${coreConstant("0x101d5e50", 876112, "00000000e0ffef40", "DB-10 environment-transition-sun-moon.json claims[25]")}; FVector::Rotation 0x1014d5d8 and 0x1014d619 fmul after appAtan2`),
  vectorRotationRadiansPerTurn: confirmedInterludeConstantRow("dynamic-light.vector-rotation-radians-per-turn", 6.283185307179586,
    `${coreConstant("0x101cdf90", 843664, "182d4454fb211940", "DB-10 environment-transition-sun-moon.json claims[25]")}; FVector::Rotation 0x1014d5de and 0x1014d622 fdiv before _ftol2`),
  movableSunNegation: confirmedInterludeConstantRow("dynamic-light.movable-sun-negation", -1,
    `${engineConstant("0x108a0660", 5896800, "000000000000f0bf")}; ANMovableSunLight::Tick 0x105d8279 negates SlopeSunAngle when 0x10c51050 is set and 0x105d82da-0x105d82f2 negates the rotated vector before FVector::Rotation`),
  movableSunSlopeShift: confirmedInterludeConstantRow("dynamic-light.movable-sun-slope-shift", 15,
    listingEvidence("ANMovableSunLight::Tick 0x105d829d shl ecx, 0xf after _ftol2 of the float32 SlopeSunAngle (manager +0x174)")),
  movableSunSlopeDivisor: confirmedInterludeConstantRow("dynamic-light.movable-sun-slope-divisor", 180,
    listingEvidence("ANMovableSunLight::Tick 0x105d82a0-0x105d82b1 imul by magic 0xb60b60b7, sar 7 and sign fix: signed division toward zero by 180")),
  movableSunAngleMask: confirmedInterludeConstantRow("dynamic-light.movable-sun-angle-mask", 0xffff,
    listingEvidence("ANMovableSunLight::Tick 0x105d82b3 and eax, 0xffff before RotateAngleAxis about (1, 0, 0) set at 0x105d8282-0x105d828c")),
  lightTypeMultipliers: confirmedInterludeConstantRow("dynamic-light.light-type-multipliers", { steady: 1, steadyMultiplier: 1, switchedOff: 6, switchedOffMultiplier: 0, modulated: 7 } as const,
    listingEvidence("FDynamicLight::Update 0x10674660: LightType byte +0x3bc 1 keeps the fld1 multiplier, 6 keeps the fldz at 0x10674863, 7 runs the modulation block 0x106749ce; the multiplier scales dyn +0x38 after f32(brightness / 255) and before LevelInfo Brightness (+0x5b0) at 0x10674f12-0x10674f65")),
  lightType7: confirmedInterludeConstantRow("dynamic-light.light-type-7", {
    minimumPeriod: 1, phaseShift: 8, cyclesPerSecond: 35, unitsPerTurn: 65536, amplitude: 0.09000000357627869, base: 0.8999999761581421,
  } as const, `${engineConstant("0x108a8a40", 5930560, "0000000000804140")} 35, ${engineConstant("0x108913c0", 5834688, "000000000000f040")} 65536, ${engineConstant("0x108b3f68", 5976936, "000000803d0ab73f")} 0.09, ${engineConstant("0x108a59c0", 5918144, "000000c0ccccec3f")} 0.9 (misc/type7-constants.json); block 0x106749ce: period max(1, LightPeriod +0x3ca), phase LightPhase +0x3cb << 8, LevelInfo TimeSeconds +0x4bc, float32 store 0x10674a35`),
  timedLight: confirmedInterludeConstantRow("dynamic-light.timed-light", { switchedOnType: 1, switchedOffType: 6, switchFlags: 0x24 } as const,
    listingEvidence("timed light helper 0x105d0c70: or dword [actor +0x5c], 0x24 and LightType 1 at 0x105d0cf6, and dword [actor +0x5c], 0xffffffdb and LightType 6 at 0x105d0d1e; AActor::Tick 0x105d3c94 calls it only when bTimeLight (+0x3d0 mask 2) is set")),
} as const;

import type { ReferenceConstantRow } from "../../shared/referenceConstant";

const dayNightReport = "DB-4 report day-night-cycle.json fe5de165, claim audit verified-day-night-cycle.md";
const engineConstant = (virtualAddress: string, byteOffset: number) =>
  `${dayNightReport}; Engine.dll 4dd2f63c constant ${virtualAddress} (file offset ${byteOffset}, day-night-work/constants.json)`;
const precisionNote = "x87 runs at the CRT default 53-bit precision because D3DDrv.dll 05622dde creates the device with D3DCREATE_FPU_PRESERVE (or 2 at 0x1001DC26), so JavaScript doubles match the x87 intermediates and Math.fround marks each float32 store";

function confirmedRow<Value>(id: string, value: Value, provenance: string): ReferenceConstantRow<Value> {
  return { id, value, provenance, status: "confirmed-interlude", interludeEvidence: provenance, runtimeDefault: value };
}

export const ENVIRONMENT_ENGINE_CONSTANTS = {
  hoursPerMinute: confirmedRow("environment.hours-per-minute", 0.01666666753590107,
    `${engineConstant("0x1089dfb8", 5886904)}; UpdateNTime 0x1051b45f, SetNTime 0x10515620 and SetTimeToLobbyTime 0x10514bd6 multiply whole minutes by it; ${precisionNote}`),
  hoursPerSecond: confirmedRow("environment.hours-per-second", 0.00027777778450399637,
    `${engineConstant("0x108ac9d0", 5946832)}; UpdateNTime 0x1051b46d multiplies the float32 seconds by it`),
  secondsPerHour: confirmedRow("environment.seconds-per-hour", 3600,
    `${engineConstant("0x108ac9e0", 5946848)}; UpdateNTime 0x1051b39d and SetTimeToLobbyTime 0x10514b3c, whole hours by signed division through magic 0x91a2b3c5`),
  secondsPerMinute: confirmedRow("environment.seconds-per-minute", 60,
    `${engineConstant("0x10891498", 5834904)}; UpdateNTime 0x1051b3d4, whole minutes by signed division through magic 0x88888889`),
  minutesPerHour: confirmedRow("environment.minutes-per-hour", 60,
    `${dayNightReport}; UpdateNTime 0x1051b428 cmp edx, 0x3c carries one hour and subtracts 0x3c once; OnReceiveServerTime 0x104893e0 splits game minutes into uint8(minutes / 60) and uint8(minutes - hour * 60)`),
  secondsCarryValue: confirmedRow("environment.seconds-carry-value", 60,
    `${engineConstant("0x108acd14", 5947668)}; UpdateNTime 0x1051b417 writes this float32 60.0 when seconds reach 60, it does not zero them`),
  lastHourOfDay: confirmedRow("environment.last-hour-of-day", 23,
    `${dayNightReport}; UpdateNTime 0x1051b43b cmp ecx, 0x17 then signed remainder by 24 through magic 0xd5555555`),
  hoursPerDay: confirmedRow("environment.hours-per-day", 24,
    `${engineConstant("0x1085ada0", 5611936)} double and ${engineConstant("0x10854bac", 5586860)} float32; day-part end, sun range end, terrain map unwrap and GetShadowMapIndex normalisation; DB-7 BSP lightmap slot divisor at 0x10668c0a-0x10668d96, static mesh hour keys 0x106f4010 and their unwrap at 0x10679a1b`),
  dayPartBounds: confirmedRow("environment.day-part-bounds", { morningStart: 6, dayStart: 8, eveningStart: 22, dayEnd: 24 },
    `${engineConstant("0x10854ba0", 5586848)} 6.0, ${engineConstant("0x10891830", 5835824)} 8.0, ${engineConstant("0x1089faa0", 5893792)} 22.0 and 24.0 at 0x1085ada0; UpdateNTime 0x1051b483-0x1051b511 writes +0x130 = 0 for [6,8), 1 for [8,22), 2 for [22,24), else 3`),
  ssqDelayHours: confirmedRow("environment.ssq-delay-hours", 0.019999999552965164,
    `${engineConstant("0x1089e9cc", 5889484)}; OnSSQInfo 0x1048b890 calls ChangeEnv(first, second, 0.02, 0.02, 1, 0, 1)`),
  redSkyDelayHours: confirmedRow("environment.red-sky-delay-hours", 0.0020000000949949026,
    `${engineConstant("0x1089f6f4", 5892852)}; OnRedSky 0x1048d540 calls ChangeEnv(3, 0, 0.002, 0.002, 1, timeout, 0) and the UpdateNTime revert calls ChangeEnv(persistent target, 0, 0.002, 0.002, 1, 0, 0)`),
  redSkyEnvironmentType: confirmedRow("environment.red-sky-type", 3,
    `${dayNightReport}; OnRedSky 0x1048d540 requests environment type 3, claim env-switch`),
  celestialPhiDegrees: confirmedRow("environment.celestial-phi-degrees", 180,
    `${dayNightReport}; the UL2NEnvManager constructor 0x1051cfc0 writes 180 to +0x170, which GetSunModifierInfo 0x10514420 and GetMoonModifierInfo 0x105144e0 read as phi degrees`),
  degreesToRadians: confirmedRow("environment.degrees-to-radians", 0.017453292519943295,
    `${engineConstant("0x108ac9c0", 5946816)}; GetSunModifierInfo 0x1051442e phi = f32(+0x170 * this)`),
  sunTheta: confirmedRow("environment.sun-theta", { rangeStart: 5, morning: 6, radiansPerHour: 0.17453292519943295, quarterTurn: 1.5707963267948966, wrapEnd: 1, belowHorizon: -3.1415927410125732 },
    `${engineConstant("0x10891850", 5835856)} 5.0, ${engineConstant("0x10854ba0", 5586848)} 6.0, ${engineConstant("0x108ac9b0", 5946800)} pi/18, ${engineConstant("0x10854b80", 5586816)} pi/2, fld1 at 0x10514475, ${engineConstant("0x108ac9ac", 5946796)} -pi float32; GetSunModifierInfo 0x10514420`),
  moonTheta: confirmedRow("environment.moon-theta", { hiddenStart: 7, hiddenEnd: 23, origin: 0, radiansPerHour: 0.5235987755982988, quarterTurn: 1.5707963267948966, belowHorizon: -3.1415927410125732 },
    `${engineConstant("0x10891840", 5835840)} 7.0, ${engineConstant("0x108ac9cc", 5946828)} 23.0 float32, ${engineConstant("0x10854b60", 5586784)} 0.0, ${engineConstant("0x1089fe10", 5894672)} pi/6, pi/2 at 0x10854b80, -pi at 0x108ac9ac; GetMoonModifierInfo 0x105144e0 sends h == 23 to the formula (claim audit sun-moon)`),
  celestialBodyHours: confirmedRow("environment.celestial-body-hours", { sunStart: 6, sunEnd: 24 },
    `${dayNightReport}; blind derivation of the direction helper 0x10514560: fcom 6.0 at 0x1051457a and 24.0 float32 at 0x10514587 choose the sun for 6 <= h < 24, else the moon`),
  hsvBrightness: confirmedRow("environment.hsv-brightness", { scale: 1.399999976158142, numerator: 0.699999988079071, bias: 0.009999999776482582 },
    `${engineConstant("0x108d9120", 6128928)}, ${engineConstant("0x108bc680", 6011520)} and ${engineConstant("0x108b57f0", 5983216)}; FGetHSV 0x1073e690`),
  byteMaximum: confirmedRow("environment.byte-maximum", 255,
    `${engineConstant("0x10853b38", 5582648)}; FGetHSV 0x1073e6a9 and 0x1073e808, GetColorPlane 0x105152ef brightness divide; GetColorPlane pushes V = 0xff at 0x1051524b and 0x1051526a`),
  hsvHueSegments: confirmedRow("environment.hsv-hue-segments", { firstBoundary: 0x56, secondBoundary: 0xab, segment: 85, lastSegment: 84 },
    `${engineConstant("0x108dc5a0", 6142368)} 85.0 and ${engineConstant("0x108dc590", 6142352)} 84.0; FGetHSV 0x1073e713 cmp 0x56 and 0x1073e747 cmp 0xab`),
  bspAmbientScale: confirmedRow("environment.bsp-ambient-scale", 0.5,
    `${engineConstant("0x1089fe6c", 5894764)}; claim ambient-consumers, FLightMap::GetTextureData 0x10675bc0 multiplies the BSP ambient bytes by 0.5`),
  fogBaselineColour: confirmedRow("environment.fog-baseline-colour", [127, 127, 127, 255] as const,
    `${dayNightReport}; claim fog-baseline, helper 0x10444a30 writes BGRA 7f7f7fff at 0x10444b31-0x10444b3e`),
} as const;

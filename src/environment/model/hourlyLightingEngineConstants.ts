import type { ReferenceConstantRow } from "../../shared/referenceConstant";

const hourlyLightingReport = "DB-7 hourly-lighting-composition.json f0a6eb0f, byte replay replay-result.json 7a0b2e2f, claim audit verified-hourly-lighting.md";
const engineEvidence = (claim: string, evidence: string) => `${hourlyLightingReport}; claim ${claim}; Engine.dll 4dd2f63c ${evidence}`;
const deviceEvidence = (claim: string, evidence: string) => `${hourlyLightingReport}; claim ${claim}; D3DDrv.dll 05622dde ${evidence}`;
const precisionNote = "x87 runs at 53-bit precision as in nativeEnvironmentEngineConstants, and all 32 DB-7 fixtures recompute equally at control words 0x7f, 0x27f and 0x37f";

function confirmedRow<Value>(id: string, value: Value, provenance: string): ReferenceConstantRow<Value> {
  return { id, value, provenance, status: "confirmed-interlude", interludeEvidence: provenance, runtimeDefault: value };
}

export const HOURLY_LIGHTING_CONSTANTS = {
  terrainLightPlaneScale: confirmedRow("lighting.terrain-light-plane-scale", 0.5,
    engineEvidence("terrain-vertex-colour", `SetIntensityMap 0x10729bc0 multiplies HSVTerrainLight X, Y and Z by the double 0.5 at 0x10859038 (file offset 5604408) at 0x10729cb8-0x10729cfc and stores each as float32; ${precisionNote}`)),
  terrainIntensityDivisor: confirmedRow("lighting.terrain-intensity-divisor", 255,
    engineEvidence("terrain-vertex-colour", "SetIntensityMap 0x10729d0e divides the patch byte by the double 255.0 at 0x10853b38 (file offset 5582648) and stores float32")),
  terrainIntensityMapWidth: confirmedRow("lighting.terrain-intensity-map-width", 257,
    engineEvidence("terrain-intensity-interpolation", "SetInterpolatedIntensityMap 0x1072ccb0 indexes (sectorY + k / 17) * 257 + sectorX + k % 17 with the 257 stride hard-coded; the 20_21 TIntMap arrays are 257 x 257")),
  colourChannelScale: confirmedRow("lighting.colour-channel-scale", 255,
    engineEvidence("terrain-colour-conversion", "FColor(FPlane) 0x10373aa0 multiplies each channel by the double 255.0 at 0x10853b38, stores float32, calls Core appFloor (?appFloor@@YAHM@Z) and clamps the integer to 0..255; byte 0 from Z, 1 from Y, 2 from X, 3 from W")),
  staticMeshHourKeyHalfStep: confirmedRow("lighting.static-mesh-hour-key-half-step", 0.5,
    engineEvidence("ma-hour-keys", "key function 0x106f4010 computes float32(i * 24.0 / float32(n) + 24.0 / float32(n) * 0.5) with 24.0 at 0x1085ada0 and 0.5 at 0x10859038")),
  staticMeshCpuEntryScale: confirmedRow("lighting.static-mesh-cpu-entry-scale", 0.5,
    engineEvidence("ma-static-cpu", "0x10679c92-0x10679ce9 stores float32((previous ? 1 - w : w) * 0.5) with 0.5 at 0x10859038 before scaling the static sun plane")),
  staticMeshAuthoredColourDivisor: confirmedRow("lighting.static-mesh-authored-colour-divisor", 255,
    engineEvidence("ma-static-cpu, ma-static-base", "0x10679e0f tests mesh+0x188, then 0x10679e18-0x10679e36 multiplies each instance RGB byte by the authored byte and divides by 255 through the signed magic 0x80808081; alpha copies the authored alpha")),
  staticMeshSunTermScale: confirmedRow("lighting.static-mesh-sun-term-scale", 32,
    engineEvidence("ma-static-ambient", "0x1067b207 multiplies each static sun plane channel by the double 32.0 at 0x108b9ac8 (file offset 6000328), FISTP under a forced chop control word, keeps the low byte, adds StaticMeshAmbient >> 1 and clamps 0..255")),
  staticMeshSunTermLevelOfDetail: confirmedRow("lighting.static-mesh-sun-term-level-of-detail", 2,
    engineEvidence("ma-static-ambient, ma-static-lod", "0x1067b1c0 requires actor+0x274 null and 0x1067b1cd cmp LOD, 2; the LOD variable is 2 for mesh+0x19c at 0x1067ab2c (claim audit, disassembled from E:)")),
  dynamicLightBrightnessDivisor: confirmedRow("lighting.dynamic-light-brightness-divisor", 255,
    engineEvidence("ma-light-plane", "FDynamicLight::Update 0x10674d72 divides the brightness by the double 255.0 at 0x10853b38 and stores float32 before three FPlane * float calls")),
  dynamicLightUnhourlyKinds: confirmedRow("lighting.dynamic-light-unhourly-kinds", [8, 9] as const,
    engineEvidence("ma-light-gates", "FDynamicLight::Update 0x106746aa reads the light actor byte +0x3bc and takes the authored path for 8 and 9 at 0x106746b0 and 0x106746b9")),
  dynamicLightHalvedColourType: confirmedRow("lighting.dynamic-light-halved-colour-type", 1,
    deviceEvidence("d3d-dynamic-light, ma-render-calls", "SetLight 0x10024093 cmp esi, 1 then FPlane /= 2.0; static meshes pass light colour type 1 and skeletal actors type 0")),
  dynamicLightHalvingDivisor: confirmedRow("lighting.dynamic-light-halving-divisor", 2,
    deviceEvidence("d3d-dynamic-light", "SetLight 0x10024099 pushes the float32 2.0 at 0x100df7f8 (file offset 915448) to Core FPlane::operator/= (??_0FPlane@@QAE?AV0@M@Z)")),
  directionalLightEffect: confirmedRow("lighting.directional-light-effect", 0x13,
    deviceEvidence("d3d-dynamic-light", "SetLight 0x100240e5 cmp the light actor byte +0x3bd with 0x13 and writes D3DLIGHT_DIRECTIONAL (3)")),
  directionalLightScale: confirmedRow("lighting.directional-light-scale", 0.5,
    deviceEvidence("d3d-dynamic-light", "SetLight 0x1002415b multiplies by the double 0.5 at 0x100dd7e0 (file offset 907232, read from the hash-locked E: copy) when render state +0x1a4 is 0")),
  directionalModulatedLightScales: confirmedRow("lighting.directional-modulated-light-scales", { first: 0.25, second: 3.5 } as const,
    deviceEvidence("d3d-dynamic-light", "SetLight 0x10024135-0x10024157 multiplies by the doubles 0.25 at 0x100e5818 (file offset 940056) and 3.5 at 0x100e5810 (file offset 940048) when render state +0x1a4 is nonzero, then stores float32")),
  globalModulationImageDefault: confirmedRow("lighting.global-modulation-image-default", 5,
    deviceEvidence("d3d-modulation", "the image-initialized modulation opcode at 0x1011c578 (file offset 1164664) is 5, D3DTOP_MODULATE2X in d3d9types.h; a vendor 0x121a path with device+0x4704 < 9 writes 4 (D3DTOP_MODULATE), so the live value is a device fact")),
  lightmapModulateOperation: confirmedRow("lighting.lightmap-modulate-operation", 4,
    deviceEvidence("d3d-lightmap-stage, bsp-compressed-choice", "append-lightmap helper 0x1000f090 writes COLOROP D3DTOP_MODULATE (4) when render state +0x1a4 is 0, which EnableLighting argument 3 sets to 0 for UColorModifier materials, else the global modulation opcode")),
} as const;

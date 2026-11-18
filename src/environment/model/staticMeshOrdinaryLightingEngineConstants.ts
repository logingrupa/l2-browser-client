import { confirmedInterludeConstantRow } from "../../shared/referenceConstant";

const ordinaryLightingReport = "RM-19 ordinary-static-lighting.json ba506eea, sampler-part.json d3a4ca6b, claim audit verified-ordinary-static-lighting.md";
const engineConstant = (virtualAddress: string, byteOffset: number, bytesHex: string, use: string) =>
  `${ordinaryLightingReport}; Engine.dll 4dd2f63c constant ${virtualAddress} (file offset ${byteOffset}, bytes ${bytesHex}); ${use}`;

export const STATIC_MESH_ORDINARY_LIGHTING_CONSTANTS = {
  pointFalloffCubicScale: confirmedInterludeConstantRow("static-mesh-ordinary.point-falloff-cubic-scale", 2,
    engineConstant("0x1085b788", 5614472, "0000000000000040", "PointAttenuation 0x10670550 fld at 0x106705a4 scales u * u * u and the final product")),
  pointFalloffSquareScale: confirmedInterludeConstantRow("static-mesh-ordinary.point-falloff-square-scale", 3,
    engineConstant("0x10853b28", 5582632, "0000000000000840", "PointAttenuation fmul at 0x106705b6 scales u * u")),
  pointFalloffOffset: confirmedInterludeConstantRow("static-mesh-ordinary.point-falloff-offset", 1,
    engineConstant("0x10852238", 5576248, "000000000000f03f", "PointAttenuation fadd at 0x106705c2 closes 2u^3 - 3u^2 + 1")),
  coneUnitScale: confirmedInterludeConstantRow("static-mesh-ordinary.cone-unit-scale", 0.00390625,
    engineConstant("0x108b3060", 5973088, "000000000000703f", "SampleIntensity 0x10670640 fmul at 0x10670a56 turns LightCone into 1 - LightCone / 256 after fld1 at 0x10670a5c")),
  scaleGlowGain: confirmedInterludeConstantRow("static-mesh-ordinary.scale-glow-gain", 0.5,
    engineConstant("0x10859038", 5604408, "000000000000e03f", "ordinary rebuild 0x10677fa0 fmul at 0x1067827a forms f32(ScaleGlow * 0.5) before each light colour")),
} as const;

import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import type { FogFamily } from "./blendFactorTypes";
import { materialNotes } from "./materialNotes";

const materialFogFamilies = {
  finalBlend: ["fog-colour", "neutral-grey", "fog-colour", "black", "black", "black", "black", "black", null],
  outputBlending: ["fog-colour", "fog-colour", "neutral-grey", "black", "black", "black", "black"],
  nonBlendingRoot: "fog-colour",
} as const satisfies { finalBlend: readonly (FogFamily | null)[]; outputBlending: readonly FogFamily[]; nonBlendingRoot: FogFamily };

const particleFogFamilies: readonly FogFamily[] = ["none", "none", "fog-colour", "black", "black", "fog-colour", "black"];

export const FOG_CONSTANTS = {
  materialFamilies: {
    id: "fog.targets",
    value: materialFogFamilies,
    provenance: `${materialNotes} fog.targets: both Modulates fog toward 127/255, AlphaModulate, both Translucents, both Brightens, Darken and Invisible toward black, other world modes and terrain toward the fog colour; lineage2js/src/materials/shader-chunks/l2_fog_fragment.glsl:8-16; mesh-static-material.ts:206-214`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: materialFogFamilies,
  },
  particleFamilies: {
    id: "fog.particle-targets",
    value: particleFogFamilies,
    provenance: `${materialNotes} fog.targets: reference particles fog only Translucent, AlphaModulate and Brighten to black and Modulated and Darken to the fog colour; lineage2js/src/materials/particle-material/particle-material.ts:53-57,166-196`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: particleFogFamilies,
  },
  neutralGreyByte: {
    id: "fog.neutral-grey",
    value: 127,
    provenance: `${materialNotes} Blend table and fog family: Modulate fogs toward 127/255, neutral under 2 * src * dst`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 127,
  },
  factor: {
    id: "fog.factor",
    value: "linear clamp((depth - start) / (end - start), 0, 1) on view depth",
    provenance: `${materialNotes} fog.factor; lineage2js/src/materials/shader-chunks/l2_fog_fragment.glsl:2-6`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "linear clamp((depth - start) / (end - start), 0, 1) on view depth",
  },
  rangeUnit: {
    id: "fog.range-unit",
    value: 2000,
    provenance: `${materialNotes} fog.range-unit: 2000 per the Env.int [FOG] comment, 2048 in lineage2js/src/rendering/render-manager.ts:2032-2040`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 2048,
  },
  sourcePrecedence: {
    id: "fog.source-precedence",
    value: ["water-volume", "fog-info", "camera-zone", "environment-preset"],
    provenance: `${materialNotes} fog.source-precedence: water, L2FogInfo, zone, preset; a zone that is not sun-affected and has no distance fog turns fog off; lineage2js/src/rendering/render-manager.ts:2026-2074,2108-2153,2214-2224,2307-2321`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: ["water-volume", "fog-info", "camera-zone", "environment-preset"],
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;

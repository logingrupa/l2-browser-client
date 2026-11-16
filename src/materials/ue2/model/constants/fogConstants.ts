import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import type { FogFamily } from "./blendFactorTypes";
import { materialNotes } from "./materialNotes";

const fogAnswer = "Q12 replay-verified l2foginfo-runtime.json 77cffb57...c465 (Engine.dll, D3DDrv.dll, Engine.u, Env.int, 20_21.unr lock-equal)";

const materialFogFamilies = {
  finalBlend: ["fog-colour", "neutral-grey", "fog-colour", "black", "black", "black", "black", "black", null],
  outputBlending: ["fog-colour", "fog-colour", "neutral-grey", "black", "black", "black", "black"],
  nonBlendingRoot: "fog-colour",
} as const satisfies { finalBlend: readonly (FogFamily | null)[]; outputBlending: readonly FogFamily[]; nonBlendingRoot: FogFamily };

const particleFogFamilies: readonly FogFamily[] = ["none", "none", "fog-colour", "black", "black", "fog-colour", "black"];

const fogConstantRows = {
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
    provenance: `assumption: ${fogAnswer} finds no D3DRS_FOGTABLEMODE or D3DRS_FOGVERTEXMODE write, so the fog curve is unresolved; the linear ramp follows ${materialNotes} fog.factor`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "linear clamp((depth - start) / (end - start), 0, 1) on view depth",
  },
  rangeUnit: {
    id: "fog.range-unit",
    value: 2048,
    provenance: `${fogAnswer}: Env.int [FOG] StartRange and EndRange times 32768 * 0.0625 = 2048; the .int comment's 2000 is wrong`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll FLevelSceneNode::Render 0x1065e940 fog baseline",
    runtimeDefault: 2048,
  },
  sourcePrecedence: {
    id: "fog.source-precedence",
    value: ["volume", "local-fog-list", "camera-zone"],
    provenance: `${fogAnswer}: a physics volume with its fog flag sets fog directly; else a non-empty local L2FogInfo list blends over the Env.int preset; else ZoneInfo DistanceFog is the fallback`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll FLevelSceneNode::Render 0x1065e940",
    runtimeDefault: ["volume", "local-fog-list", "camera-zone"],
  },
  terrainClipRange: {
    id: "fog.terrain-clip-range",
    value: null,
    provenance: `${fogAnswer}: the FogRange slot follows the imported GL2TerrainCR (< 5 FogRange1 to >= 8 FogRange5); its runtime value and producer are unresolved`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: null,
  },
  fadeReferencePosition: {
    id: "fog.fade-reference-position",
    value: null,
    provenance: `${fogAnswer}: the fade 0x10444560 measures from a reference position held in the unnamed viewport field +0x3bc; which position that is stays unresolved`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: null,
  },
  localListProducer: {
    id: "fog.local-list-producer",
    value: null,
    provenance: `${fogAnswer}: FLevelSceneNode::Render loops the local fog list at level+0x74 -> +0x18c in index order; which L2FogInfo actors fill it, and in which order, stays unresolved`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: null,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;

export const FOG_CONSTANTS: Omit<typeof fogConstantRows, "terrainClipRange" | "fadeReferencePosition" | "localListProducer"> & {
  readonly terrainClipRange: ReferenceConstantRow<number | null>;
  readonly fadeReferencePosition: ReferenceConstantRow<"camera" | null>;
  readonly localListProducer: ReferenceConstantRow<"tile-fog-infos-in-export-order" | null>;
} = fogConstantRows;


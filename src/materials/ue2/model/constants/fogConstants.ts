import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import type { FogFamily } from "./blendFactorTypes";
import { materialNotes } from "./materialNotes";

const fogAnswer = "Q12 replay-verified l2foginfo-runtime.json 77cffb57...c465 (Engine.dll, D3DDrv.dll, Engine.u, Env.int, 20_21.unr lock-equal)";
const fogScopeAnswer = "RM-4 replay-verified fog-draw-scope.json b93571c0...c2ee4 (Engine.dll, Core.dll, D3DDrv.dll, Engine.u, Env.int, 15_22.unr, 20_21.unr lock-equal)";

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
    value: ["volume", "local-fog-list", "terrain-zone-environment", "camera-zone"],
    provenance: `${fogAnswer} and ${fogScopeAnswer}: fog is enabled only when the camera ZoneInfo has bDistanceFog (+0x3d8 & 8) and the viewport actor +0x5ac & 0x80000 (fog.viewport-actor-enable-flag), a separate argument from colour, so without a known camera zone a colour source is unresolved; the sources then pick colour and range: a physics volume with its fog flag sets fog directly; else a non-empty local L2FogInfo list blends over the Env.int preset; else with an empty list a ZoneInfo with bTerrainZone takes the Env.int haze colour at the hour over the Env.int preset; else ZoneInfo DistanceFog is the fallback; alpha never gates enable. Reading the +0x3d8 bits 0x04 and 0x08 as bTerrainZone and bDistanceFog is not re-derived from the Engine.u bool layout`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll FLevelSceneNode::Render 0x1065e940, setters 0x1065f96a and 0x1065f9ba",
    runtimeDefault: ["volume", "local-fog-list", "terrain-zone-environment", "camera-zone"],
  },
  viewportActorEnableFlag: {
    id: "fog.viewport-actor-enable-flag",
    value: true,
    provenance: `assumption: ${fogScopeAnswer} gates enable on viewport actor +0x5ac & 0x80000 as well as ZoneInfo +0x3d8 & 8; the flag is unnamed and the client has no viewport actor, so it is assumed set`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: true,
  },
  terrainClipRange: {
    id: "fog.terrain-clip-range",
    value: 8,
    provenance: `${fogScopeAnswer}: Option.ini [ClippingRange] Terrain=8.000000 is read in UEngine::Init and clamped to [1, 16]; ModifyGlobalClippingRange 0x10589df0 keeps the origin value with IsKeepMinFrameRate=False; the 15_22 capture shows FogRange5. This is the configured state; the live GL2TerrainCR is unmeasured`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll ModifyGlobalClippingRange 0x10589df0",
    runtimeDefault: 8,
  },
  fadeReferencePosition: {
    id: "fog.fade-reference-position",
    value: "possessed-pawn-location",
    provenance: `${fogScopeAnswer}: 0x1065ef77 reads viewport+0x3c -> Actor+0x3bc (Controller.Pawn) and measures the fade 0x10444560 from Pawn+0x1bc (Location), else from the viewport actor Location; the camera position is not used. The client takes the local pawn movement pose feet plus the profile collision height, the one Pawn Location it shares with the audio listener, so the fade follows the moving pawn rather than the server destination; that height against Pawn Location is unmeasured (open question 5)`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll 0x1065ef77",
    runtimeDefault: "possessed-pawn-location",
  },
  localListProducer: {
    id: "fog.local-list-producer",
    value: "al2foginfo-tick-add-unique",
    provenance: `${fogScopeAnswer}: AL2FogInfo::Tick 0x10444d10 runs AddUnique 0x104446c0 (pointer-equality search plus Add, no sort, no distance test) into level+0x74 -> +0x18c, and FLevelSceneNode::Render blends the list in index order`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll AL2FogInfo::Tick 0x10444d10, AddUnique 0x104446c0",
    runtimeDefault: "al2foginfo-tick-add-unique",
  },
  localListOrder: {
    id: "fog.local-list-order",
    value: "export-order",
    provenance: `assumption: ${fogScopeAnswer} leaves the actor tick order unresolved, so the list follows map export order; the runtime names the assumption only when two contributing actors could blend differently in another order`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "export-order",
  },
  localListRetention: {
    id: "fog.local-list-retention",
    value: "distance <= AffectRange.Max or distance < TextureDistance",
    provenance: `${fogScopeAnswer}: retention 0x106560f0 keeps an actor when d <= AffectRange.Max (+0x3c0) or d < [+0x3ec] (0x10652540); the weight is unchanged. RM-4 does not say which position the retention distance is measured from; the runtime measures it from the fade reference pawn, as the weight is. Reading +0x3ec as TextureDistance is not re-derived`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll 0x106560f0",
    runtimeDefault: "distance <= AffectRange.Max or distance < TextureDistance",
  },
  transitionSecondsImageDefault: {
    id: "fog.transition-seconds-image-default",
    value: 15,
    provenance: "RM-17 sky-fog-route-and-transition.json 6593fded, claim audit verified-sky-fog-route-and-transition.md: GL2FogSpeed is the Core.dll 9462f87a export 0x10237370 with the image value 15.0f; Env.int [FOG] FogSpeed replaces it when the key is read (the shipped Env.int has FogSpeed=1)",
    status: "confirmed-interlude",
    interludeEvidence: "Core.dll 9462f87a GL2FogSpeed 0x10237370",
    runtimeDefault: 15,
  },
  skySceneRoute: {
    id: "fog.sky-scene-route",
    value: null,
    provenance: `${fogScopeAnswer}: the sky scene 0x10660000 inherits the level fog through PushState, RenderLevel and PopState when !GIsEditor && GIsL2Seamless && GL2SharedSky, and otherwise runs FLevelSceneNode::Render for the sky zone; the runtime values of GIsL2Seamless and GL2SharedSky are unresolved`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: null,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;

export type SkySceneFogRoute = "inherit-level" | "own-zone";

export const FOG_CONSTANTS: Omit<typeof fogConstantRows, "skySceneRoute"> & {
  readonly skySceneRoute: ReferenceConstantRow<SkySceneFogRoute | null>;
} = fogConstantRows;


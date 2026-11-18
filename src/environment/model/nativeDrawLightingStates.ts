import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";

export type NativeLitSurface = "bsp" | "terrain" | "staticMesh" | "actor";
export type AmbientSource = "baked-into-compressed-lightmap" | "baked-into-vertex-colour" | "render-state-ambient";

export interface NativeDrawLightingState {
  readonly deviceLighting: boolean;
  readonly colourVertex: boolean;
  readonly ambientSource: AmbientSource;
  readonly evidence: string;
}

export type LightmapColourOperation =
  | { readonly operation: "modulate"; readonly opcode: number }
  | { readonly operation: "global-modulation"; readonly imageDefaultOpcode: number; readonly status: "unresolved"; readonly reason: "d3d-device-live-state" };

const { globalModulationImageDefault, lightmapModulateOperation } = HOURLY_LIGHTING_CONSTANTS;

export const nativeDrawLightingStates: Readonly<Record<NativeLitSurface, NativeDrawLightingState>> = {
  bsp: { deviceLighting: false, colourVertex: false, ambientSource: "baked-into-compressed-lightmap",
    evidence: "BSP draw 0x10668ac0 calls EnableLighting(0, 0, arg3, lightmap, viewMode == 7, FSphere(0)); the compressed child already carries the ambient (bsp-compressed-choice)" },
  terrain: { deviceLighting: false, colourVertex: true, ambientSource: "baked-into-vertex-colour",
    evidence: "terrain renderer 0x10734190 calls EnableLighting(0, 1, 1, 0, 0, sphere); SetIntensityMap 0x10729bc0 adds TerrainAmbient >> 1 into the vertex colour (d3d-terrain-caller, terrain-vertex-colour)" },
  staticMesh: { deviceLighting: true, colourVertex: true, ambientSource: "render-state-ambient",
    evidence: "static render 0x1067b15f EnableLighting and 0x1067b36e SetAmbientLight; SetAmbientLight 0x10023e00 writes D3DRS_AMBIENT (ma-render-calls, d3d-ambient)" },
  actor: { deviceLighting: true, colourVertex: false, ambientSource: "render-state-ambient",
    evidence: "skeletal render 0x106dda27 EnableLighting and 0x106ddb32 SetAmbientLight; SetAmbientLight 0x10023e00 writes D3DRS_AMBIENT (ma-render-calls, d3d-ambient)" },
};

export const globalModulationOperation = {
  operation: "global-modulation", imageDefaultOpcode: globalModulationImageDefault.value, status: "unresolved", reason: "d3d-device-live-state",
} as const satisfies LightmapColourOperation;

export function lightmapStageColourOperation(materialIsColourModifier: boolean): LightmapColourOperation {
  return materialIsColourModifier ? { operation: "modulate", opcode: lightmapModulateOperation.value } : globalModulationOperation;
}

export const staticMeshColourStreams = {
  instanceLighting: { declarationUsage: "COLOR0", materialSource: "emissive",
    evidence: "the instance FRawColorStream declares function 2, mapped to COLOR index 0; EMISSIVEMATERIALSOURCE is D3DMCS_COLOR1 (ma-stream-colours, d3d-colour-declaration, d3d-material-defaults)" },
  authoredColour: { declarationUsage: "COLOR1", materialSource: "diffuse-and-ambient when device+0x4244 bit 0x02 is set, else the white material",
    status: "unresolved", reason: "d3d-device-live-state",
    evidence: "the mesh FStaticMeshColorStream declares function 3, mapped to COLOR index 1; DIFFUSE and AMBIENT MATERIALSOURCE become D3DMCS_COLOR2 only with device+0x4244 bit 0x02, and the material Diffuse and Ambient are float4(1) (d3d-colour-declaration, d3d-material-defaults)" },
} as const;

export const hourlyLightingUnresolvedItems = [
  { id: "terrain-general-staticlight-sampleintensity", surface: "terrain", reason: "SampleIntensity for a vertex whose serialized light mask bit is set is not reduced to a formula" },
  { id: "terrain-full-runtime-map-reconstruction", surface: "terrain", reason: "the overlap write order of sector patches into one runtime map is not established; the runtime reads the authored TIntMap instead" },
  { id: "bsp-full-effect-attenuation", surface: "bsp", reason: "the light effect switch 0x10671890 of the lightmap rebuild is not a reviewed formula" },
  { id: "bsp-shadow-slot-origin", surface: "bsp", reason: "how shadow record +0x34 is built after load is not traced" },
  { id: "bsp-final-filtered-rgb", surface: "bsp", reason: "the filtered texel and framebuffer colour need live sampler and device state" },
  { id: "bsp-live-cache-state", surface: "bsp", reason: "loaded revisions, the compressed texture option and cache invalidation were not observed live" },
  { id: "ma-final-static-vertex", surface: "staticMesh", reason: "placements outside the lit set (an ordinary light of LightType 7, an unported effect or a time-varying colour, bUnlit, a ForcedRegionTag or ForcedRegion, non-uniform scale, no vertex stream sidecar, unresolved ScaleGlow or LocalToWorld) draw unlit; those light terms are not reduced to formulas" },
  { id: "ma-live-actor-fixture", surface: "actor", reason: "20_21 has no Pawn export, so no runtime skeletal actor fixes its lights and normals" },
  { id: "ma-scalar-field-name", surface: "actor", reason: "DB-7 left the light actor +0xe0 +0x5b0 multiplier unnamed; DB-8 verified-zone-binding.md names it Level (+0xe0) LevelInfo.Brightness (+0x5b0)" },
  { id: "ma-temporal-light-types", surface: "actor", reason: "the temporal light factor of each authored light type is the native switch result, not portable pseudocode" },
  { id: "d3d-programmable-composition", surface: "device", reason: "the GL2Shader vertex and pixel equations are not decoded, so no surface claims a final framebuffer colour" },
  { id: "d3d-device-live-state", surface: "device", reason: "the modulation opcode, device+0x4244 bit 0x02, GL2Shader, the light list and the inherited D3DRS_AMBIENT of the seamless fixed-function terrain path were not observed live" },
  { id: "d3d-universal-stage-number", surface: "device", reason: "the terrain and material stage count depends on the material path, so no single stage number holds" },
  { id: "rm10-selected-shader", surface: "staticMesh", reason: "RM-10 logged no GL2Shader or selected vertex and pixel bytecode, and L2CompiledShader.bin holds four zero bytes, so the programmable final equation is not claimed" },
  { id: "rm10-static-live-branch", surface: "staticMesh", reason: "RM-10 captured no live GL2Shader, device caps, cache flags, selected LOD or extra dynamic light list, so the CPU fixture branch is not proved to be the drawn one" },
  { id: "rm10-live-device-state", surface: "staticMesh", reason: "RM-10 observed no live capability branch, stage number, active lights, material fallback, material source state or GPU precision; the fixed-function equations are a conditional API reading" },
  { id: "rm10-final-gpu-colour", surface: "staticMesh", reason: "RM-10 proves the CPU instance colour only; the programmable shader output and device quantization of the final textured RGB are not observed" },
] as const;

export const staticMeshDrawnComposition = {
  status: "inferred-d3d9", reasons: ["rm10-selected-shader", "rm10-static-live-branch", "rm10-live-device-state", "rm10-final-gpu-colour"],
} as const satisfies { readonly status: string; readonly reasons: readonly HourlyLightingUnresolvedItem[] };

export type HourlyLightingUnresolvedItem = typeof hourlyLightingUnresolvedItems[number]["id"];

export const terrainRefreshThreshold = {
  status: "unresolved", reason: "terrain-refresh-threshold-unresolved",
  evidence: "Tick sets manager+0x168 when threshold +0x160 > 0 and |hour - lastHour| exceeds it (terrain-rebuild); DB-7 did not confirm that +0x160 holds Env.int ShadowTick",
} as const;

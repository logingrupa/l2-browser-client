import type { NativeTimeColourRow, NativeTimeHsvRow, NativeTimeScaleRow } from "./sampleNativeTimeTables";

export const blackStartColourSections = ["SkyBoxColor", "SunColor", "MoonColor", "TerrainAmbient", "ActorAmbient", "StaticMeshAmbient", "BSPAmbient"] as const;
export const skyLayerColourSections = ["HazeringColor", "CloudColor1", "CloudColor2", "CloudColor3"] as const;
export const hsvLightSections = ["HSVTerrainLight", "HSVActorLight", "HSVStaticMeshLight", "HSVBSPLight"] as const;
export const scaleSections = ["SunScale", "MoonScale"] as const;

export type BlackStartColourSection = typeof blackStartColourSections[number];
export type SkyLayerColourSection = typeof skyLayerColourSections[number];
export type NativeTimeColourSection = BlackStartColourSection | SkyLayerColourSection;
export type SkyEnvironmentSection = "SkyBoxColor" | SkyLayerColourSection;
export type HsvLightSection = typeof hsvLightSections[number];
export type ScaleSection = typeof scaleSections[number];

export interface NativeEnvironmentTypeTables {
  readonly colour: Readonly<Record<NativeTimeColourSection, readonly NativeTimeColourRow[]>>;
  readonly hsv: Readonly<Record<HsvLightSection, readonly NativeTimeHsvRow[]>>;
  readonly scale: Readonly<Record<ScaleSection, readonly NativeTimeScaleRow[]>>;
}

export type NativeEnvironmentTables = ReadonlyMap<number, NativeEnvironmentTypeTables>;

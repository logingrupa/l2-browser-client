import { readFileSync } from "node:fs";

export interface StaticMeshAmbientLightingRow {
  readonly vertex: number;
  readonly lightingRGB255: readonly [number, number, number];
  readonly textureMultiplierRGB: readonly [number, number, number];
}

export interface StaticMeshAmbientFixture {
  readonly actorExportIndex: number;
  readonly actor: string;
  readonly mesh: string;
  readonly hour: number;
  readonly zoneIndices: readonly number[];
  readonly runtimeSunAffect: boolean;
  readonly ambientGlow: number;
  readonly zoneMaximumAmbientVector: readonly [number, number, number];
  readonly cachedAmbientBGRA: readonly [number, number, number, number];
  readonly selectedAmbientSource: string;
  readonly setAmbientRGB: readonly [number, number, number];
  readonly hasInstance: boolean;
  readonly ordinaryEntryCount: number | null;
  readonly hourlyEntryCount: number | null;
  readonly vertexIndices: readonly number[];
  readonly serializedInstanceBGRA: readonly (readonly [number, number, number, number])[] | null;
  readonly forcedOrdinaryRebuildBGRA: readonly (readonly [number, number, number, number])[] | null;
  readonly forcedRebuildWithLightChangedClearedBGRA: readonly (readonly [number, number, number, number])[] | null;
  readonly retainedNoExtraDynamicLights: readonly StaticMeshAmbientLightingRow[] | null;
  readonly clearedLightChangedNoExtraDynamicLights: readonly StaticMeshAmbientLightingRow[] | null;
  readonly noInstanceNoExtraDynamicLights: readonly StaticMeshAmbientLightingRow[] | null;
}

export interface StaticMeshAmbientZoneFixture {
  readonly zoneIndex: number;
  readonly zoneActor: string;
  readonly ambientHue: number;
  readonly ambientSaturation: number;
  readonly ambientBrightness: number;
  readonly sunAffect: boolean;
  readonly ambientVector: readonly [number, number, number];
  readonly fallbackColorBGRA: readonly [number, number, number, number];
}

export interface StaticMeshAmbientFixtureDocument {
  readonly hourlyStaticMeshAmbientRGB: readonly [number, number, number];
  readonly fixtures: readonly StaticMeshAmbientFixture[];
  readonly zones: readonly StaticMeshAmbientZoneFixture[];
}

const fixtureFile = new URL("../fixtures/environment/static-mesh-ambient-rm20-fixtures.json", import.meta.url);

export function readStaticMeshAmbientFixtures(): StaticMeshAmbientFixtureDocument {
  return JSON.parse(readFileSync(fixtureFile, "utf8")) as StaticMeshAmbientFixtureDocument;
}

export function staticMeshAmbientFixtureOf(document: StaticMeshAmbientFixtureDocument, actorExportIndex: number): StaticMeshAmbientFixture {
  const fixture = document.fixtures.find(entry => entry.actorExportIndex === actorExportIndex);
  if (fixture === undefined) throw new Error(`RM-20 fixture ${actorExportIndex} is absent.`);
  return fixture;
}

export function zoneFieldRecords(zone: StaticMeshAmbientZoneFixture) {
  const field = (name: string, value: unknown) => ({ field: name, value, provenance: "authored", declaringClass: "Engine.ZoneInfo" });
  return { zoneIndex: zone.zoneIndex, levelInfoFallback: false, distanceFog: [], sunAffect: field("bSunAffect", zone.sunAffect),
    ambient: [field("AmbientVector", null), field("AmbientBrightness", zone.ambientBrightness), field("AmbientHue", zone.ambientHue),
      field("AmbientSaturation", zone.ambientSaturation)] };
}

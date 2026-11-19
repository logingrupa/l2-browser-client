import { readFileSync } from "node:fs";
import type { NativeVector3 } from "../../src/environment/model/lightmapRebuild/lightmapRebuildTypes";
import type { TileLightActorRecord } from "../../src/scene/world/lighting/lightmapRebuildActors";

export interface LightGateFixtureField {
  readonly field: string;
  readonly provenance: string;
  readonly value: unknown;
}

export interface LightGateFixtureLight {
  readonly exportIndex: number;
  readonly object: string;
  readonly actorClass: string;
  readonly fields: readonly LightGateFixtureField[];
}

export interface LightGateFixtureEntry {
  readonly light: number;
  readonly maskHex: string;
  readonly applied: number;
}

export interface LightGateFixtureVertex {
  readonly vertexIndex: number;
  readonly meshPosition: NativeVector3;
  readonly meshNormal: NativeVector3;
  readonly color0BGRA: readonly [number, number, number, number];
}

export interface LightGateFixtureReceiver {
  readonly exportIndex: number;
  readonly instanceExportIndex: number;
  readonly mesh: string;
  readonly bSunAffect: boolean;
  readonly ambientBGRA: readonly [number, number, number, number];
  readonly vertices: readonly LightGateFixtureVertex[];
  readonly vertexCount: number;
  readonly scaleGlow: number;
  readonly localToWorld: readonly number[];
  readonly ordinaryEntries: readonly LightGateFixtureEntry[];
  readonly hourlyEntries: readonly LightGateFixtureEntry[];
  readonly lights: readonly LightGateFixtureLight[];
}

export interface LightGateFixtureNormalVertex {
  readonly vertex: number;
  readonly localPosition: NativeVector3;
  readonly localNormal: NativeVector3;
  readonly worldPosition: NativeVector3;
  readonly worldNormal: NativeVector3;
}

export interface StaticMeshLightGateFixtureDocument {
  readonly rm19LightCacheFlags: readonly LightGateFixtureLight[];
  readonly rm26Receivers: readonly LightGateFixtureReceiver[];
  readonly rm27Normals: { readonly exportIndex: number; readonly localToWorld: readonly number[]; readonly vertices: readonly LightGateFixtureNormalVertex[] };
}

const fixtureFile = new URL("../fixtures/environment/static-mesh-light-gate-fixtures.json", import.meta.url);

export function readStaticMeshLightGateFixtures(): StaticMeshLightGateFixtureDocument {
  return JSON.parse(readFileSync(fixtureFile, "utf8")) as StaticMeshLightGateFixtureDocument;
}

export function lightGateRecord(light: LightGateFixtureLight): TileLightActorRecord {
  return { exportIndex: light.exportIndex, object: light.object, actorClass: light.actorClass,
    fields: new Map(light.fields.map(field => [field.field, { provenance: field.provenance, value: field.value }])) };
}

export function rm19LightCacheFlagsOf(document: StaticMeshLightGateFixtureDocument, exportIndex: number): LightGateFixtureLight {
  const light = document.rm19LightCacheFlags.find(entry => entry.exportIndex === exportIndex);
  if (light === undefined) throw new Error(`The light gate fixtures hold no RM-19 cache flags for light ${exportIndex}.`);
  return light;
}

import { readFileSync } from "node:fs";
import type { NativeVector3 } from "../../src/environment/model/lightmapRebuild/lightmapRebuildTypes";

export interface OrdinarySampleIntensityFixture {
  readonly function: string;
  readonly effect: number;
  readonly worldPosition: NativeVector3;
  readonly worldNormal: NativeVector3;
  readonly light: { readonly position: NativeVector3; readonly direction: NativeVector3; readonly radius: number; readonly cone: number };
  readonly intensity: number;
}

export interface OrdinaryUpdateFixture {
  readonly lightType: number;
  readonly lightBrightness: number;
  readonly lightRadius: number;
  readonly lightHue: number;
  readonly lightSaturation: number;
  readonly levelTimeSeconds: number;
  readonly location: NativeVector3;
  readonly rotation: readonly [pitch: number, yaw: number, roll: number];
  readonly colour: readonly [number, number, number, number];
  readonly radius: number;
}

export interface OrdinaryFixtureLight {
  readonly exportIndex: number;
  readonly object: string;
  readonly actorClass: string;
  readonly fields: readonly { readonly field: string; readonly provenance: string; readonly value: unknown }[];
  readonly cache: { readonly position: NativeVector3; readonly direction: NativeVector3; readonly radius: number; readonly color38: readonly [number, number, number, number] };
}

export interface OrdinaryFixtureMaskEntry {
  readonly light: number;
  readonly maskHex: string;
}

export interface OrdinaryFixtureLightSample {
  readonly vertex: number;
  readonly reference: number;
  readonly worldPosition: NativeVector3;
  readonly worldNormal: NativeVector3;
  readonly intensity: number;
  readonly contributionBGRA: readonly [number, number, number, number];
}

export interface OrdinaryIntegratedFixture {
  readonly actorObject: string;
  readonly actorExportIndex: number;
  readonly meshObject: string;
  readonly instanceExportIndex: number;
  readonly hour: number;
  readonly levelTimeSeconds: number;
  readonly scaleGlow: number;
  readonly levelBrightness: number;
  readonly vertexCount: number;
  readonly vertexIndices: readonly number[];
  readonly localNormals: Readonly<Record<string, NativeVector3>>;
  readonly localToWorld: readonly number[];
  readonly sunDirection: NativeVector3;
  readonly sunPlane: readonly [number, number, number, number];
  readonly ordinaryEntries: readonly OrdinaryFixtureMaskEntry[];
  readonly hourlyEntries: readonly OrdinaryFixtureMaskEntry[];
  readonly ordinaryLights: readonly OrdinaryFixtureLight[];
  readonly perLightSamples: readonly OrdinaryFixtureLightSample[];
  readonly ordinaryBGRA: readonly (readonly [number, number, number, number])[];
  readonly finalInstanceBGRA: readonly (readonly [number, number, number, number])[];
}

export interface OrdinaryStaticLightingFixtureDocument {
  readonly sampleIntensity: readonly OrdinarySampleIntensityFixture[];
  readonly update: readonly OrdinaryUpdateFixture[];
  readonly integrated: readonly OrdinaryIntegratedFixture[];
}

const fixtureFile = new URL("../fixtures/environment/ordinary-static-lighting-rm19-fixtures.json", import.meta.url);

export function readOrdinaryStaticLightingFixtures(): OrdinaryStaticLightingFixtureDocument {
  return JSON.parse(readFileSync(fixtureFile, "utf8")) as OrdinaryStaticLightingFixtureDocument;
}

export function integratedFixtureOf(document: OrdinaryStaticLightingFixtureDocument, actorExportIndex: number): OrdinaryIntegratedFixture {
  const fixture = document.integrated.find(entry => entry.actorExportIndex === actorExportIndex);
  if (fixture === undefined) throw new Error(`RM-19 has no integrated fixture for actor ${actorExportIndex}.`);
  return fixture;
}

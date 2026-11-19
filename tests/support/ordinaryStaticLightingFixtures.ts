import { readFileSync } from "node:fs";
import type { NativeVector3 } from "../../src/environment/model/lightmapRebuild/lightmapRebuildTypes";
import type { StaticMeshLightList, StaticMeshLightMask } from "../../src/scene/world/lighting/decodeHourlyLightingInputs";
import { parseStaticMeshVertexStreams, type StaticMeshVertexStreams } from "../../src/scene/world/lighting/loadStaticMeshVertexStreams";
import type { TileLightActorRecord } from "../../src/scene/world/lighting/lightmapRebuildActors";
import { lightGateRecord, readStaticMeshLightGateFixtures, rm19LightCacheFlagsOf } from "./staticMeshLightGateFixtures";
import { maskBytes } from "./staticMeshLightingFixtures";

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
  readonly localPositions: Readonly<Record<string, NativeVector3>>;
  readonly primaryColoursHex: string;
  readonly alternateColoursHex: string;
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

export interface OrdinaryStagedSubset {
  readonly list: StaticMeshLightList;
  readonly streams: StaticMeshVertexStreams;
}

const bitsPerByte = 8;

export function subsetVisibility(maskHex: string, vertexIndices: readonly number[]): Uint8Array {
  const full = maskBytes(maskHex), subset = new Uint8Array(Math.ceil(vertexIndices.length / bitsPerByte));
  vertexIndices.forEach((vertex, position) => {
    if ((full[Math.floor(vertex / bitsPerByte)]! >> (vertex % bitsPerByte)) & 1) subset[Math.floor(position / bitsPerByte)]! |= 1 << (position % bitsPerByte);
  });
  return subset;
}

const lightGateDocument = readStaticMeshLightGateFixtures();
const sunLightClass = "Engine.NMovableSunLight";

export function ordinaryFixtureLightRecord(light: OrdinaryFixtureLight, overrides: Readonly<Record<string, unknown>> = {}): TileLightActorRecord {
  const fields = new Map(light.fields.map(field => [field.field, { provenance: field.provenance, value: field.value }]));
  for (const flag of rm19LightCacheFlagsOf(lightGateDocument, light.exportIndex).fields) fields.set(flag.field, { provenance: flag.provenance, value: flag.value });
  for (const [field, value] of Object.entries(overrides)) fields.set(field, { provenance: "authored", value });
  return { exportIndex: light.exportIndex, object: light.object, actorClass: light.actorClass, fields };
}

export function rm19SunLightRecord(): TileLightActorRecord {
  const sun = lightGateDocument.rm19LightCacheFlags.find(light => light.actorClass === sunLightClass);
  if (sun === undefined) throw new Error("The light gate fixtures hold no RM-19 sun light.");
  return lightGateRecord(sun);
}

export function stagedOrdinarySubsetOf(fixture: OrdinaryIntegratedFixture, hourlyEntries = fixture.hourlyEntries): OrdinaryStagedSubset {
  const masks = (entries: readonly OrdinaryFixtureMaskEntry[]): StaticMeshLightMask[] =>
    entries.map(entry => ({ light: entry.light, visibility: subsetVisibility(entry.maskHex, fixture.vertexIndices) }));
  const list: StaticMeshLightList = { actorExportIndex: fixture.actorExportIndex, instanceExportIndex: fixture.instanceExportIndex,
    vertexCount: fixture.vertexIndices.length,
    ordinaryInputs: { status: "staged", value: { scaleGlow: fixture.scaleGlow, localToWorld: Float32Array.from(fixture.localToWorld) } },
    ordinaryMasks: masks(fixture.ordinaryEntries), hourlyMasks: masks(hourlyEntries) };
  const vectors = (byVertex: Readonly<Record<string, NativeVector3>>) => fixture.vertexIndices.flatMap(vertex => byVertex[String(vertex)]!);
  const streams = parseStaticMeshVertexStreams({ kind: "native-static-mesh-vertex-streams", schemaVersion: 3, sourceObject: fixture.meshObject,
    nativeVertexCount: fixture.vertexIndices.length, nativePositions: vectors(fixture.localPositions), nativeNormals: vectors(fixture.localNormals),
    primary: { bgraHex: fixture.primaryColoursHex, revision: 0 }, alternate: { bgraHex: fixture.alternateColoursHex, revision: 0 }, selector: null,
    selectorGapReason: "static-mesh-colour-selector-unresolved",
    primitives: [{ mesh: 0, primitive: 0, nativeVertices: fixture.vertexIndices.map((_, position) => position) }] });
  return { list, streams };
}

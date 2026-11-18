import { buildLightingTables } from "../../src/environment/model/lightmapRebuild/lightingTables";
import type { TileLightingSettings } from "../../src/scene/world/lighting/bindTileLighting";
import type { LightingFields } from "../../src/scene/world/lighting/lightingFieldRecords";
import type { RebuildZoneAmbient, TileLightActorRecord } from "../../src/scene/world/lighting/lightmapRebuildActors";
import type { TileLightingModel } from "../../src/scene/world/lighting/decodeTileLighting";
import { composeRebuiltLightmapRequest } from "../../src/scene/world/lighting/rebuiltLightmapRequest";
import { createRebuiltLightmapStore } from "../../src/scene/world/lighting/rebuiltLightmapStore";
import { planLightmapSections, type LightmapSectionChunk, type LightmapSectionPlan } from "../../src/scene/world/lighting/tileLightmapSections";
import type { RebuildLightEnvironment } from "../../src/scene/world/lighting/rebuildShadowLights";
import { readDayNightLoadedTables } from "./dayNightFixtures";
import { replaceArray, tileLightingArrays, tileLightingRecordsDocument } from "./tileLightingFixture";
import type { TypedPayloadFixtureArray } from "./typedPayloadFixture";

export function authoredFields(values: Readonly<Record<string, unknown>>): LightingFields {
  return new Map(Object.entries(values).map(([field, value]) => [field, { provenance: "authored", value }]));
}

export function rebuildLightActor(actorClass: string, values: Readonly<Record<string, unknown>>, exportIndex = 1): TileLightActorRecord {
  return { exportIndex, object: `20_20.Light${exportIndex}`, actorClass, fields: authoredFields(values) };
}

export function rebuildZone(zoneIndex: number, ambient: Readonly<Record<string, number>>): RebuildZoneAmbient {
  return { zoneIndex, ambient: authoredFields(ambient), levelInfoFallback: false };
}

export const pointLightFields = { bDeleteMe: false, LightEffect: 0, LightType: 1, bTimeLight: false, LightPeriod: 32, LightPhase: 0, LightHue: 0, LightSaturation: 255,
  LightBrightness: 64, bSunlightColor: false, LightRadius: 64, Location: { X: 8, Y: 8, Z: 32 } } as const;

export const rebuildEnvironmentAtHourSix: RebuildLightEnvironment = { hour: 6, dayPart: 0, celestialPhiDegrees: 180, slopeSunAngle: 30, frozen: { value: false, verified: true },
  tables: readDayNightLoadedTables(), blend: { oldType: 0, targetType: 0, weight: 1 }, levelTimeSeconds: 0 };

export function planSectionsWithoutComposition(model: TileLightingModel, chunks: readonly LightmapSectionChunk[]): LightmapSectionPlan[] {
  const store = createRebuiltLightmapStore({ model, environment: () => rebuildEnvironmentAtHourSix,
    compose: request => Promise.reject(new Error(`No lightmap composition in this fixture for an edge ${request.edge} page.`)) });
  return planLightmapSections(model, chunks, store.textureSource);
}

export function inThreadLightmapRebuild(): Pick<TileLightingSettings, "rebuildEnvironment" | "composeRebuiltLightmap"> {
  const tables = buildLightingTables();
  return { rebuildEnvironment: () => rebuildEnvironmentAtHourSix, composeRebuiltLightmap: async request => composeRebuiltLightmapRequest(request, tables) };
}

const projectionOf = () => [...new Array<number>(16).fill(0), 0, 0, 0, 1, 0, 0, 0, 1, 0];

function lightRecord(fields: Readonly<Record<string, unknown>>) {
  return { exportIndex: 5, object: "00_00.Light5", actorClass: "Engine.Light", baseClass: "Engine.Light", zone: 2,
    fields: Object.entries(fields).map(([field, value]) => ({ field, value, provenance: "authored", declaringClass: "Engine.Light" })) };
}

export function rebuiltTileLightingArrays(lightFields: Readonly<Record<string, unknown>> = pointLightFields): TypedPayloadFixtureArray[] {
  const records = { ...tileLightingRecordsDocument(), lights: [lightRecord(lightFields)],
    levelInfos: [{ exportIndex: 3, object: "00_00.LevelInfo0", actorClass: "Engine.LevelInfo", baseClass: "Engine.LevelInfo", zone: null,
      fields: [{ field: "Brightness", value: 1, provenance: "class-default", declaringClass: "Engine.LevelInfo" }] }] };
  const mismatchedTextureZero = replaceArray(tileLightingArrays(records), "LMPG.compressedRevision", [2, 2, 2, 2, 2, 2, 2, 2, 3]);
  const recordsIndex = mismatchedTextureZero.findIndex(array => array.name === "RECS.canonicalJson");
  return [...mismatchedTextureZero.slice(0, recordsIndex), ...lightmapRebuildArrays(), ...mismatchedTextureZero.slice(recordsIndex)];
}

export function lightmapRebuildArrays(): TypedPayloadFixtureArray[] {
  return [
    { name: "LMTX.rebuildInputs", type: "uint8", values: [1, 0] },
    { name: "LMRC.rectangle", type: "int32", values: [0, 0, 4, 2, 4, 4, 2, 2] },
    { name: "LMRC.projection", type: "float32", values: [...projectionOf(), ...projectionOf()] },
    { name: "LMRC.zone", type: "int32", values: [2, 2] },
    { name: "LMRC.surfaceNormal", type: "float32", values: [0, 0, -1, 0, 0, -1] },
    { name: "LMRC.surfacePolyFlags", type: "uint32", values: [0, 0] },
    { name: "LMRC.shadowStart", type: "uint32", values: [0, 1, 1] },
    { name: "LMSH.light", type: "int32", values: [0] },
    { name: "LMSH.width", type: "int32", values: [1] },
    { name: "LMSH.height", type: "int32", values: [1] },
    { name: "LMSH.rowBytes", type: "int32", values: [1] },
    { name: "LMSH.minimumX", type: "int32", values: [0] },
    { name: "LMSH.minimumY", type: "int32", values: [0] },
    { name: "LMSH.maximumX", type: "int32", values: [0] },
    { name: "LMSH.maximumY", type: "int32", values: [0] },
    { name: "LMSH.byteStart", type: "uint32", values: [0, 1] },
    { name: "LMSH.bits", type: "uint8", values: [1] },
  ];
}

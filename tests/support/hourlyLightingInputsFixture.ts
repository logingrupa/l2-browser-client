import { readFileSync } from "node:fs";
import { environmentColour, environmentLightPlane } from "../../src/environment/model/nativeEnvironmentColours";
import type { NativeEnvironmentBlend } from "../../src/environment/model/nativeEnvironmentManager";
import type { HourlyEnvironmentLighting } from "../../src/scene/world/worldTimeOfDay";
import { readDayNightLoadedTables } from "./dayNightFixtures";
import { readHourlyLightingFixtures } from "./hourlyLightingFixtures";
import { readStaticMeshLightingFixtures } from "./staticMeshLightingFixtures";
import type { TypedPayloadFixtureArray } from "./typedPayloadFixture";

interface ConverterExpectations {
  readonly staticMesh: {
    readonly mesh: { readonly vertexCount: number };
    readonly instance: { readonly actorExportIndex: number; readonly instanceExportIndex: number; readonly environmentLights: readonly { readonly light: number; readonly maskHex: string }[] };
  };
}

export const terrainMapEdge = 257;
export const probeColumn = 134, probeRow = 129;
const converterExpectationsFile = new URL("../fixtures/environment/hourly-lighting-db7-converter-expectations.json", import.meta.url);
const settledBlend: NativeEnvironmentBlend = { oldType: 0, targetType: 0, weight: 1 };

const prefixStarts = (counts: readonly number[]) => counts.reduce<number[]>((starts, count) => [...starts, starts.at(-1)! + count], [0]);
const hexBytes = (hex: string) => Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));

export function readConverterExpectations(): ConverterExpectations {
  return JSON.parse(readFileSync(converterExpectationsFile, "utf8")) as ConverterExpectations;
}

export function terrainIntensityArrays(): TypedPayloadFixtureArray[] {
  const { context } = readHourlyLightingFixtures();
  const samplesPerMap = terrainMapEdge * terrainMapEdge, probeSample = probeRow * terrainMapEdge + probeColumn;
  const intensity = new Array<number>(context.tIntMapTimes.length * samplesPerMap).fill(0);
  context.tIntMapSample134x129.forEach((value, map) => { intensity[map * samplesPerMap + probeSample] = value; });
  return [
    { name: "TINT.time", type: "float32", values: context.tIntMapTimes },
    { name: "TINT.width", type: "uint32", values: [terrainMapEdge] },
    { name: "TINT.height", type: "uint32", values: [terrainMapEdge] },
    { name: "TINT.intensity", type: "uint8", values: intensity },
  ];
}

export function terrainLightMaskArrays(maskBytes: readonly number[]): TypedPayloadFixtureArray[] {
  return [
    { name: "TSEC.exportIndex", type: "int32", values: [2181] },
    { name: "TSEC.lightStart", type: "uint32", values: [0, 1] },
    { name: "TLIT.light", type: "int32", values: [361] },
    { name: "TLIT.bitStart", type: "uint32", values: [0, maskBytes.length] },
    { name: "TLIT.bits", type: "uint8", values: maskBytes },
  ];
}

export function staticMeshLightListArrays(): TypedPayloadFixtureArray[] {
  const { mesh, instance } = readConverterExpectations().staticMesh;
  const { pillar } = readStaticMeshLightingFixtures();
  const hourlyMasks = [instance.environmentLights, pillar.hourlyMasks].map(entries => entries.map(entry => hexBytes(entry.maskHex)));
  const ordinaryMasks = pillar.ordinaryMasks.map(entry => hexBytes(entry.maskHex));
  return [
    { name: "SMLL.actorExportIndex", type: "int32", values: [instance.actorExportIndex, pillar.actorExportIndex] },
    { name: "SMLL.instanceExportIndex", type: "int32", values: [instance.instanceExportIndex, pillar.instanceExportIndex] },
    { name: "SMLL.colorCount", type: "uint32", values: [mesh.vertexCount, pillar.vertexCount] },
    { name: "SMLL.sceneStart", type: "uint32", values: [0, 0, ordinaryMasks.length] },
    { name: "SMLL.environmentStart", type: "uint32", values: prefixStarts(hourlyMasks.map(masks => masks.length)) },
    { name: "SMSC.light", type: "int32", values: pillar.ordinaryMasks.map(entry => entry.light) },
    { name: "SMSC.bitStart", type: "uint32", values: prefixStarts(ordinaryMasks.map(mask => mask.length)) },
    { name: "SMSC.bits", type: "uint8", values: ordinaryMasks.flat() },
    { name: "SMEN.light", type: "int32", values: [...instance.environmentLights, ...pillar.hourlyMasks].map(entry => entry.light) },
    { name: "SMEN.bitStart", type: "uint32", values: prefixStarts(hourlyMasks.flat().map(mask => mask.length)) },
    { name: "SMEN.bits", type: "uint8", values: hourlyMasks.flat().flat() },
  ];
}

export const staticMeshSunAffectArray: TypedPayloadFixtureArray = { name: "SMLL.sunAffect", type: "int32", values: [-1, 1] };

export function staticMeshOrdinaryInputArrays(): TypedPayloadFixtureArray[] {
  const { fixtures } = readStaticMeshLightingFixtures();
  return [
    { name: "SMLL.ordinaryInputsResolved", type: "int32", values: [0, 1] },
    { name: "SMLL.scaleGlow", type: "float32", values: [0, 1] },
    { name: "SMLL.localToWorld", type: "float32", values: [...new Array<number>(16).fill(0), ...fixtures[0]!.matrix] },
  ];
}

export function hourlyEnvironmentAt(hour: number, blend: NativeEnvironmentBlend = settledBlend): HourlyEnvironmentLighting {
  const tables = readDayNightLoadedTables();
  return { hour,
    terrainAmbient: environmentColour(tables, blend, "TerrainAmbient", hour), terrainLight: environmentLightPlane(tables, blend, "HSVTerrainLight", hour),
    staticMeshAmbient: environmentColour(tables, blend, "StaticMeshAmbient", hour), staticMeshLight: environmentLightPlane(tables, blend, "HSVStaticMeshLight", hour),
    actorAmbient: environmentColour(tables, blend, "ActorAmbient", hour) };
}

import type { TypedPayload } from "../../../shared/typedPayload";
import { TileLightingDecodeError } from "./tileLightingDecodeError";

export type StagedLightingInput<Value> =
  | { readonly status: "staged"; readonly value: Value }
  | { readonly status: "unstaged"; readonly reason: string };

export interface LightmapPageRevisions {
  readonly revision: Int32Array;
  readonly compressedRevision: Int32Array;
}

export interface TerrainIntensityMaps {
  readonly times: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly maps: readonly Uint8Array[];
}

export interface TerrainLightMaskSummary {
  readonly sectorCount: number;
  readonly lightCount: number;
  readonly lightsCoveringAVertex: number;
}

export interface StaticMeshHourlyMask {
  readonly light: number;
  readonly visibility: Uint8Array;
}

export interface StaticMeshLightList {
  readonly actorExportIndex: number;
  readonly instanceExportIndex: number;
  readonly vertexCount: number;
  readonly hourlyMasks: readonly StaticMeshHourlyMask[];
}

export interface HourlyLightingInputs {
  readonly sectionSunAffect: StagedLightingInput<Int32Array>;
  readonly pageRevisions: StagedLightingInput<LightmapPageRevisions>;
  readonly terrainIntensityMaps: StagedLightingInput<TerrainIntensityMaps>;
  readonly terrainLightMasks: StagedLightingInput<TerrainLightMaskSummary>;
  readonly staticMeshLightLists: StagedLightingInput<ReadonlyMap<number, StaticMeshLightList>>;
}

export const sunAffectUnresolved = -1;
export const hourlyLightingInputUnstagedPrefix = "hourly-lighting-input-unstaged:";
const sunAffectValues: ReadonlySet<number> = new Set([sunAffectUnresolved, 0, 1]);
const bitsPerByte = 8;

function requireInput(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TileLightingDecodeError(message);
}

function stagedWhenListed<Value>(payload: TypedPayload, names: readonly string[], decode: () => Value): StagedLightingInput<Value> {
  const listed = new Set(payload.names());
  const missing = names.find(name => !listed.has(name));
  return missing === undefined ? { status: "staged", value: decode() } : { status: "unstaged", reason: `${hourlyLightingInputUnstagedPrefix}${missing}` };
}

function requirePrefixStarts(name: string, starts: Uint32Array, count: number, total: number): void {
  requireInput(starts.length === count + 1 && starts[0] === 0 && starts[count] === total, `${name} must hold ${count + 1} starts from 0 to ${total}.`);
  const descending = starts.findIndex((start, index) => index > 0 && start < starts[index - 1]!);
  requireInput(descending === -1, `${name}[${descending}] runs backwards.`);
}

function decodeSectionSunAffect(payload: TypedPayload): Int32Array {
  const sunAffect = payload.int32("LMSC.sunAffect"), sectionCount = payload.int32("LMSC.lightmapTexture").length;
  requireInput(sunAffect.length === sectionCount, `LMSC.sunAffect holds ${sunAffect.length} values for ${sectionCount} native render sections.`);
  const outside = sunAffect.findIndex(value => !sunAffectValues.has(value));
  requireInput(outside === -1, `LMSC.sunAffect[${outside}] = ${sunAffect[outside]} is not -1, 0 or 1.`);
  return sunAffect;
}

function decodePageRevisions(payload: TypedPayload): LightmapPageRevisions {
  const revision = payload.int32("LMPG.revision"), compressedRevision = payload.int32("LMPG.compressedRevision"), pageCount = payload.int32("LMPG.texture").length;
  requireInput(revision.length === pageCount && compressedRevision.length === pageCount,
    `LMPG.revision and LMPG.compressedRevision hold ${revision.length} and ${compressedRevision.length} values for ${pageCount} pages.`);
  return { revision, compressedRevision };
}

function singleDimension(payload: TypedPayload, name: string): number {
  const values = payload.uint32(name);
  requireInput(values.length === 1 && values[0]! > 0, `${name} must hold one positive dimension.`);
  return values[0]!;
}

function decodeTerrainIntensityMaps(payload: TypedPayload): TerrainIntensityMaps {
  const times = Array.from(payload.float32("TINT.time")), width = singleDimension(payload, "TINT.width"), height = singleDimension(payload, "TINT.height");
  const intensity = payload.uint8("TINT.intensity"), sampleCount = width * height;
  requireInput(intensity.length === times.length * sampleCount, `TINT.intensity holds ${intensity.length} samples, not ${times.length} maps of ${width} x ${height}.`);
  requireInput(times.every((time, index) => Number.isFinite(time) && (index === 0 || time > times[index - 1]!)), "TINT.time must ascend strictly.");
  return { times, width, height, maps: times.map((_, index) => intensity.subarray(index * sampleCount, (index + 1) * sampleCount)) };
}

function decodeTerrainLightMasks(payload: TypedPayload): TerrainLightMaskSummary {
  const sectorCount = payload.int32("TSEC.exportIndex").length, lightStart = payload.uint32("TSEC.lightStart");
  const lightCount = payload.int32("TLIT.light").length, bitStart = payload.uint32("TLIT.bitStart"), bits = payload.uint8("TLIT.bits");
  requirePrefixStarts("TSEC.lightStart", lightStart, sectorCount, lightCount);
  requirePrefixStarts("TLIT.bitStart", bitStart, lightCount, bits.length);
  let lightsCoveringAVertex = 0;
  for (let light = 0; light < lightCount; light += 1) if (bits.subarray(bitStart[light]!, bitStart[light + 1]!).some(byte => byte !== 0)) lightsCoveringAVertex += 1;
  return { sectorCount, lightCount, lightsCoveringAVertex };
}

function decodeStaticMeshLightLists(payload: TypedPayload): ReadonlyMap<number, StaticMeshLightList> {
  const actorExportIndex = payload.int32("SMLL.actorExportIndex"), instanceExportIndex = payload.int32("SMLL.instanceExportIndex");
  const colourCount = payload.uint32("SMLL.colorCount"), environmentStart = payload.uint32("SMLL.environmentStart");
  const light = payload.int32("SMEN.light"), bitStart = payload.uint32("SMEN.bitStart"), bits = payload.uint8("SMEN.bits");
  const listCount = actorExportIndex.length;
  requireInput(instanceExportIndex.length === listCount && colourCount.length === listCount, "SMLL arrays disagree on the light list count.");
  requirePrefixStarts("SMLL.environmentStart", environmentStart, listCount, light.length);
  requirePrefixStarts("SMEN.bitStart", bitStart, light.length, bits.length);
  const lists = new Map<number, StaticMeshLightList>();
  for (let list = 0; list < listCount; list += 1) {
    const vertexCount = colourCount[list]!, actor = actorExportIndex[list]!;
    requireInput(!lists.has(actor), `static mesh actor ${actor} has two light lists.`);
    const hourlyMasks = Array.from({ length: environmentStart[list + 1]! - environmentStart[list]! }, (_, offset) => {
      const entry = environmentStart[list]! + offset, visibility = bits.subarray(bitStart[entry]!, bitStart[entry + 1]!);
      requireInput(visibility.length * bitsPerByte >= vertexCount, `static mesh actor ${actor} hourly mask ${offset} covers ${visibility.length * bitsPerByte} of ${vertexCount} vertices.`);
      return { light: light[entry]!, visibility };
    });
    lists.set(actor, { actorExportIndex: actor, instanceExportIndex: instanceExportIndex[list]!, vertexCount, hourlyMasks });
  }
  return lists;
}

export function decodeHourlyLightingInputs(payload: TypedPayload): HourlyLightingInputs {
  return {
    sectionSunAffect: stagedWhenListed(payload, ["LMSC.sunAffect"], () => decodeSectionSunAffect(payload)),
    pageRevisions: stagedWhenListed(payload, ["LMPG.revision", "LMPG.compressedRevision"], () => decodePageRevisions(payload)),
    terrainIntensityMaps: stagedWhenListed(payload, ["TINT.time", "TINT.width", "TINT.height", "TINT.intensity"], () => decodeTerrainIntensityMaps(payload)),
    terrainLightMasks: stagedWhenListed(payload, ["TSEC.exportIndex", "TSEC.lightStart", "TLIT.light", "TLIT.bitStart", "TLIT.bits"],
      () => decodeTerrainLightMasks(payload)),
    staticMeshLightLists: stagedWhenListed(payload, ["SMLL.actorExportIndex", "SMLL.instanceExportIndex", "SMLL.colorCount", "SMLL.environmentStart",
      "SMEN.light", "SMEN.bitStart", "SMEN.bits"], () => decodeStaticMeshLightLists(payload)),
  };
}

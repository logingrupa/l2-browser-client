import type { TypedPayload } from "../../../shared/typedPayload";
import { decodeLightmapRebuildInputs, lightmapRebuildInputNames, type LightmapRebuildInputs } from "./decodeLightmapRebuildInputs";
import { decodeLightActorRecords, type LightActorRecords } from "./lightmapRebuildActors";
import { requireLightingInput, requireLightingPrefixStarts, stagedWhenListed, type StagedLightingInput } from "./stagedLightingInput";
import type { TileLightingRecordsDocument } from "./tileLightingRecords";

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

export interface StaticMeshLightMask {
  readonly light: number;
  readonly visibility: Uint8Array;
}

export interface StaticMeshOrdinaryInputs {
  readonly scaleGlow: number;
  readonly localToWorld: Float32Array;
}

export interface StaticMeshLightList {
  readonly actorExportIndex: number;
  readonly instanceExportIndex: number;
  readonly vertexCount: number;
  readonly sunAffect: StagedLightingInput<number>;
  readonly ordinaryInputs: StagedLightingInput<StaticMeshOrdinaryInputs>;
  readonly ordinaryMasks: readonly StaticMeshLightMask[];
  readonly hourlyMasks: readonly StaticMeshLightMask[];
}

export interface HourlyLightingInputs {
  readonly nodeRangeSunAffect: StagedLightingInput<Int32Array>;
  readonly pageRevisions: StagedLightingInput<LightmapPageRevisions>;
  readonly terrainIntensityMaps: StagedLightingInput<TerrainIntensityMaps>;
  readonly terrainLightMasks: StagedLightingInput<TerrainLightMaskSummary>;
  readonly staticMeshLightLists: StagedLightingInput<ReadonlyMap<number, StaticMeshLightList>>;
  readonly lightmapRebuild: StagedLightingInput<LightmapRebuildInputs>;
  readonly lightActors: LightActorRecords;
}

export const sunAffectUnresolved = -1;
export const sunAffected = 1;
export const staticMeshOrdinaryInputsUnresolvedReason = "static-mesh-ordinary-inputs-unresolved";
const sunAffectValues: ReadonlySet<number> = new Set([sunAffectUnresolved, 0, sunAffected]);
const bitsPerByte = 8;
const localToWorldComponents = 16;
const localToWorldAffineColumn = [[3, 0], [7, 0], [11, 0], [15, 1]] as const;
const ordinaryInputsResolved = 1;

function decodeNodeRangeSunAffect(payload: TypedPayload): Int32Array {
  const sunAffect = payload.int32("LMNR.sunAffect"), nodeRangeCount = payload.int32("LMNR.node").length;
  requireLightingInput(sunAffect.length === nodeRangeCount, `LMNR.sunAffect holds ${sunAffect.length} values for ${nodeRangeCount} lightmap node ranges.`);
  const outside = sunAffect.findIndex(value => !sunAffectValues.has(value));
  requireLightingInput(outside === -1, `LMNR.sunAffect[${outside}] = ${sunAffect[outside]} is not -1, 0 or 1.`);
  return sunAffect;
}

function decodePageRevisions(payload: TypedPayload): LightmapPageRevisions {
  const revision = payload.int32("LMPG.revision"), compressedRevision = payload.int32("LMPG.compressedRevision"), pageCount = payload.int32("LMPG.texture").length;
  requireLightingInput(revision.length === pageCount && compressedRevision.length === pageCount,
    `LMPG.revision and LMPG.compressedRevision hold ${revision.length} and ${compressedRevision.length} values for ${pageCount} pages.`);
  return { revision, compressedRevision };
}

function singleDimension(payload: TypedPayload, name: string): number {
  const values = payload.uint32(name);
  requireLightingInput(values.length === 1 && values[0]! > 0, `${name} must hold one positive dimension.`);
  return values[0]!;
}

function decodeTerrainIntensityMaps(payload: TypedPayload): TerrainIntensityMaps {
  const times = Array.from(payload.float32("TINT.time")), width = singleDimension(payload, "TINT.width"), height = singleDimension(payload, "TINT.height");
  const intensity = payload.uint8("TINT.intensity"), sampleCount = width * height;
  requireLightingInput(intensity.length === times.length * sampleCount, `TINT.intensity holds ${intensity.length} samples, not ${times.length} maps of ${width} x ${height}.`);
  requireLightingInput(times.every((time, index) => Number.isFinite(time) && (index === 0 || time > times[index - 1]!)), "TINT.time must ascend strictly.");
  return { times, width, height, maps: times.map((_, index) => intensity.subarray(index * sampleCount, (index + 1) * sampleCount)) };
}

function decodeTerrainLightMasks(payload: TypedPayload): TerrainLightMaskSummary {
  const sectorCount = payload.int32("TSEC.exportIndex").length, lightStart = payload.uint32("TSEC.lightStart");
  const lightCount = payload.int32("TLIT.light").length, bitStart = payload.uint32("TLIT.bitStart"), bits = payload.uint8("TLIT.bits");
  requireLightingPrefixStarts("TSEC.lightStart", lightStart, sectorCount, lightCount);
  requireLightingPrefixStarts("TLIT.bitStart", bitStart, lightCount, bits.length);
  let lightsCoveringAVertex = 0;
  for (let light = 0; light < lightCount; light += 1) if (bits.subarray(bitStart[light]!, bitStart[light + 1]!).some(byte => byte !== 0)) lightsCoveringAVertex += 1;
  return { sectorCount, lightCount, lightsCoveringAVertex };
}

function decodeStaticMeshSunAffect(payload: TypedPayload, listCount: number): (list: number) => StagedLightingInput<number> {
  const name = "SMLL.sunAffect";
  const staged = stagedWhenListed(payload, [name], () => {
    const sunAffect = payload.int32(name);
    requireLightingInput(sunAffect.length === listCount, `${name} holds ${sunAffect.length} values for ${listCount} static mesh light lists.`);
    const outside = sunAffect.findIndex(value => !sunAffectValues.has(value));
    requireLightingInput(outside === -1, `${name}[${outside}] = ${sunAffect[outside]} is not -1, 0 or 1.`);
    return sunAffect;
  });
  if (staged.status === "unstaged") return () => staged;
  return list => ({ status: "staged", value: staged.value[list]! });
}

function decodeStaticMeshOrdinaryInputs(payload: TypedPayload, listCount: number): (list: number) => StagedLightingInput<StaticMeshOrdinaryInputs> {
  const resolvedName = "SMLL.ordinaryInputsResolved", scaleGlowName = "SMLL.scaleGlow", localToWorldName = "SMLL.localToWorld";
  const staged = stagedWhenListed(payload, [resolvedName, scaleGlowName, localToWorldName], () => {
    const resolved = payload.int32(resolvedName), scaleGlow = payload.float32(scaleGlowName), localToWorld = payload.float32(localToWorldName);
    requireLightingInput(resolved.length === listCount && scaleGlow.length === listCount && localToWorld.length === listCount * localToWorldComponents,
      `${resolvedName}, ${scaleGlowName} and ${localToWorldName} hold ${resolved.length}, ${scaleGlow.length} and ${localToWorld.length} values for ${listCount} static mesh light lists.`);
    for (let list = 0; list < listCount; list += 1) {
      requireLightingInput(resolved[list] === 0 || resolved[list] === ordinaryInputsResolved, `${resolvedName}[${list}] = ${resolved[list]} is not 0 or 1.`);
      if (resolved[list] !== ordinaryInputsResolved) continue;
      const start = list * localToWorldComponents;
      requireLightingInput(localToWorldAffineColumn.every(([index, value]) => localToWorld[start + index] === value),
        `${localToWorldName} of static mesh light list ${list} is not an affine row-major matrix.`);
    }
    return { resolved, scaleGlow, localToWorld };
  });
  if (staged.status === "unstaged") return () => staged;
  const { resolved, scaleGlow, localToWorld } = staged.value;
  return list => resolved[list] === ordinaryInputsResolved
    ? { status: "staged", value: { scaleGlow: scaleGlow[list]!, localToWorld: localToWorld.subarray(list * localToWorldComponents, (list + 1) * localToWorldComponents) } }
    : { status: "unstaged", reason: staticMeshOrdinaryInputsUnresolvedReason };
}

function decodeStaticMeshLightLists(payload: TypedPayload): ReadonlyMap<number, StaticMeshLightList> {
  const actorExportIndex = payload.int32("SMLL.actorExportIndex"), instanceExportIndex = payload.int32("SMLL.instanceExportIndex");
  const colourCount = payload.uint32("SMLL.colorCount"), environmentStart = payload.uint32("SMLL.environmentStart"), sceneStart = payload.uint32("SMLL.sceneStart");
  const light = payload.int32("SMEN.light"), bitStart = payload.uint32("SMEN.bitStart"), bits = payload.uint8("SMEN.bits");
  const sceneLight = payload.int32("SMSC.light"), sceneBitStart = payload.uint32("SMSC.bitStart"), sceneBits = payload.uint8("SMSC.bits");
  const listCount = actorExportIndex.length;
  requireLightingInput(instanceExportIndex.length === listCount && colourCount.length === listCount, "SMLL arrays disagree on the light list count.");
  requireLightingPrefixStarts("SMLL.environmentStart", environmentStart, listCount, light.length);
  requireLightingPrefixStarts("SMEN.bitStart", bitStart, light.length, bits.length);
  requireLightingPrefixStarts("SMLL.sceneStart", sceneStart, listCount, sceneLight.length);
  requireLightingPrefixStarts("SMSC.bitStart", sceneBitStart, sceneLight.length, sceneBits.length);
  const sunAffectOf = decodeStaticMeshSunAffect(payload, listCount), ordinaryInputsOf = decodeStaticMeshOrdinaryInputs(payload, listCount);
  const lists = new Map<number, StaticMeshLightList>();
  for (let list = 0; list < listCount; list += 1) {
    const vertexCount = colourCount[list]!, actor = actorExportIndex[list]!;
    requireLightingInput(!lists.has(actor), `static mesh actor ${actor} has two light lists.`);
    const masks = (kind: string, starts: Uint32Array, lights: Int32Array, maskStarts: Uint32Array, maskBits: Uint8Array): StaticMeshLightMask[] =>
      Array.from({ length: starts[list + 1]! - starts[list]! }, (_, offset) => {
        const entry = starts[list]! + offset, visibility = maskBits.subarray(maskStarts[entry]!, maskStarts[entry + 1]!);
        requireLightingInput(visibility.length * bitsPerByte >= vertexCount,
          `static mesh actor ${actor} ${kind} mask ${offset} covers ${visibility.length * bitsPerByte} of ${vertexCount} vertices.`);
        return { light: lights[entry]!, visibility };
      });
    lists.set(actor, { actorExportIndex: actor, instanceExportIndex: instanceExportIndex[list]!, vertexCount, sunAffect: sunAffectOf(list),
      ordinaryInputs: ordinaryInputsOf(list), ordinaryMasks: masks("ordinary light", sceneStart, sceneLight, sceneBitStart, sceneBits), hourlyMasks: masks("hourly", environmentStart, light, bitStart, bits) });
  }
  return lists;
}

export function decodeHourlyLightingInputs(payload: TypedPayload, recordsDocument: TileLightingRecordsDocument): HourlyLightingInputs {
  const lightActors = decodeLightActorRecords(recordsDocument);
  return {
    nodeRangeSunAffect: stagedWhenListed(payload, ["LMNR.sunAffect"], () => decodeNodeRangeSunAffect(payload)),
    pageRevisions: stagedWhenListed(payload, ["LMPG.revision", "LMPG.compressedRevision"], () => decodePageRevisions(payload)),
    terrainIntensityMaps: stagedWhenListed(payload, ["TINT.time", "TINT.width", "TINT.height", "TINT.intensity"], () => decodeTerrainIntensityMaps(payload)),
    terrainLightMasks: stagedWhenListed(payload, ["TSEC.exportIndex", "TSEC.lightStart", "TLIT.light", "TLIT.bitStart", "TLIT.bits"],
      () => decodeTerrainLightMasks(payload)),
    staticMeshLightLists: stagedWhenListed(payload, ["SMLL.actorExportIndex", "SMLL.instanceExportIndex", "SMLL.colorCount", "SMLL.environmentStart",
      "SMLL.sceneStart", "SMEN.light", "SMEN.bitStart", "SMEN.bits", "SMSC.light", "SMSC.bitStart", "SMSC.bits"], () => decodeStaticMeshLightLists(payload)),
    lightmapRebuild: stagedWhenListed(payload, lightmapRebuildInputNames, () => decodeLightmapRebuildInputs(payload, recordsDocument, lightActors)),
    lightActors,
  };
}

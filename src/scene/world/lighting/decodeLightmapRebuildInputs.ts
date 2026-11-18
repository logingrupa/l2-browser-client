import type { LightmapProjection, LightmapSurface, NativeVector3, PackedShadowRecord } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import type { TypedPayload } from "../../../shared/typedPayload";
import { decodeLightmapRebuildActors, type LightmapRebuildActors } from "./lightmapRebuildActors";
import { requireLightingInput, requireLightingPrefixStarts } from "./stagedLightingInput";
import type { TileLightingRecordsDocument } from "./tileLightingRecords";

export const unlistedShadowLightIndex = -1;

export interface LightmapRebuildShadow extends PackedShadowRecord {
  readonly light: number;
}

export interface LightmapRebuildRecord {
  readonly zone: number;
  readonly atlasX: number;
  readonly atlasY: number;
  readonly surface: LightmapSurface;
  readonly projection: LightmapProjection;
  readonly shadows: readonly LightmapRebuildShadow[];
}

export interface LightmapRebuildInputs {
  readonly textureHasInputs: readonly boolean[];
  readonly textureRecords: readonly (readonly LightmapRebuildRecord[])[];
  readonly actors: LightmapRebuildActors;
}

interface LightmapRebuildModelFacts {
  readonly textureEdges: readonly number[];
  readonly textureHasMismatchedPage: readonly boolean[];
}

export const lightmapRebuildInputNames = ["LMTX.rebuildInputs", "LMRC.rectangle", "LMRC.projection", "LMRC.zone", "LMRC.surfaceNormal", "LMRC.surfacePolyFlags",
  "LMRC.shadowStart", "LMSH.light", "LMSH.width", "LMSH.height", "LMSH.rowBytes", "LMSH.minimumX", "LMSH.minimumY", "LMSH.maximumX", "LMSH.maximumY",
  "LMSH.byteStart", "LMSH.bits"] as const;

const rectangleValues = 4;
const projectionValues = 25;
const projectionOriginOffset = 16;
const projectionUStepOffset = 19;
const projectionVStepOffset = 22;
const normalAxes = 3;
const bitsPerMaskByte = 8;

function vectorAt(values: Float32Array, offset: number): NativeVector3 {
  return [values[offset]!, values[offset + 1]!, values[offset + 2]!];
}

function requireCount(name: string, actual: number, expected: number): void {
  requireLightingInput(actual === expected, `${name} holds ${actual} values; the counts need ${expected}.`);
}

function decodeShadows(payload: TypedPayload): LightmapRebuildShadow[] {
  const light = payload.int32("LMSH.light"), shadowCount = light.length, byteStart = payload.uint32("LMSH.byteStart"), bits = payload.uint8("LMSH.bits").slice();
  const fields = { width: payload.int32("LMSH.width"), height: payload.int32("LMSH.height"), rowBytes: payload.int32("LMSH.rowBytes"),
    minimumX: payload.int32("LMSH.minimumX"), minimumY: payload.int32("LMSH.minimumY"), maximumX: payload.int32("LMSH.maximumX"), maximumY: payload.int32("LMSH.maximumY") };
  for (const [name, values] of Object.entries(fields)) requireCount(`LMSH.${name}`, values.length, shadowCount);
  requireLightingPrefixStarts("LMSH.byteStart", byteStart, shadowCount, bits.length);
  return Array.from(light, (lightIndex, shadow) => {
    const width = fields.width[shadow]!, height = fields.height[shadow]!, rowBytes = fields.rowBytes[shadow]!;
    const minimumX = fields.minimumX[shadow]!, minimumY = fields.minimumY[shadow]!, maximumX = fields.maximumX[shadow]!, maximumY = fields.maximumY[shadow]!;
    const shadowBits = bits.subarray(byteStart[shadow]!, byteStart[shadow + 1]!);
    requireLightingInput((lightIndex >= 0 || lightIndex === unlistedShadowLightIndex) && width > 0 && height > 0 && rowBytes === Math.ceil(width / bitsPerMaskByte) && shadowBits.length === rowBytes * height
      && maximumX === minimumX + width - 1 && maximumY === minimumY + height - 1 && minimumX >= 0 && minimumY >= 0,
    `LMSH shadow ${shadow} (light ${lightIndex}, ${width} x ${height}, ${rowBytes} row bytes, ${shadowBits.length} bytes) is not a packed mask of its rectangle.`);
    return { light: lightIndex, height, rowBytes, minimumX, minimumY, maximumX, maximumY, bits: shadowBits };
  });
}

interface RecordArrays {
  readonly rectangle: Int32Array;
  readonly projection: Float32Array;
  readonly zone: Int32Array;
  readonly surfaceNormal: Float32Array;
  readonly surfacePolyFlags: Uint32Array;
  readonly shadowStart: Uint32Array;
}

function readRecordArrays(payload: TypedPayload, recordCount: number, shadowCount: number): RecordArrays {
  const arrays = { rectangle: payload.int32("LMRC.rectangle"), projection: payload.float32("LMRC.projection"), zone: payload.int32("LMRC.zone"),
    surfaceNormal: payload.float32("LMRC.surfaceNormal"), surfacePolyFlags: payload.uint32("LMRC.surfacePolyFlags"), shadowStart: payload.uint32("LMRC.shadowStart") };
  requireCount("LMRC.rectangle", arrays.rectangle.length, recordCount * rectangleValues);
  requireCount("LMRC.projection", arrays.projection.length, recordCount * projectionValues);
  requireCount("LMRC.zone", arrays.zone.length, recordCount);
  requireCount("LMRC.surfaceNormal", arrays.surfaceNormal.length, recordCount * normalAxes);
  requireCount("LMRC.surfacePolyFlags", arrays.surfacePolyFlags.length, recordCount);
  requireLightingPrefixStarts("LMRC.shadowStart", arrays.shadowStart, recordCount, shadowCount);
  return arrays;
}

function decodeRecord(arrays: RecordArrays, record: number, shadows: readonly LightmapRebuildShadow[]): LightmapRebuildRecord {
  const [atlasX, atlasY, width, height] = arrays.rectangle.subarray(record * rectangleValues, (record + 1) * rectangleValues);
  const projectionStart = record * projectionValues;
  const recordShadows = shadows.slice(arrays.shadowStart[record]!, arrays.shadowStart[record + 1]!);
  requireLightingInput(width! > 0 && height! > 0, `LMRC record ${record} rectangle is ${width} x ${height}.`);
  const outside = recordShadows.findIndex(shadow => shadow.maximumX >= width! || shadow.maximumY >= height!);
  requireLightingInput(outside === -1, `LMRC record ${record} shadow ${outside} leaves its ${width} x ${height} rectangle.`);
  return { zone: arrays.zone[record]!, atlasX: atlasX!, atlasY: atlasY!,
    surface: { normal: vectorAt(arrays.surfaceNormal, record * normalAxes), polyFlags: arrays.surfacePolyFlags[record]! },
    projection: { width: width!, height: height!, origin: vectorAt(arrays.projection, projectionStart + projectionOriginOffset),
      uStep: vectorAt(arrays.projection, projectionStart + projectionUStepOffset), vStep: vectorAt(arrays.projection, projectionStart + projectionVStepOffset) },
    shadows: recordShadows };
}

export function decodeLightmapRebuildInputs(payload: TypedPayload, recordsDocument: TileLightingRecordsDocument): LightmapRebuildInputs {
  const rebuildInputs = payload.uint8("LMTX.rebuildInputs"), recordStart = payload.uint32("LMTX.recordStart"), textureCount = rebuildInputs.length;
  requireLightingPrefixStarts("LMTX.recordStart", recordStart, textureCount, recordStart[recordStart.length - 1] ?? 0);
  const shadows = decodeShadows(payload), arrays = readRecordArrays(payload, recordStart[textureCount]!, shadows.length);
  const outsideFlag = rebuildInputs.findIndex(flag => flag > 1);
  requireLightingInput(outsideFlag === -1, `LMTX.rebuildInputs[${outsideFlag}] = ${rebuildInputs[outsideFlag]} is not 0 or 1.`);
  const textureHasInputs = Array.from(rebuildInputs, flag => flag === 1);
  const textureRecords = textureHasInputs.map((hasInputs, texture) => {
    const first = recordStart[texture]!, end = recordStart[texture + 1]!;
    if (hasInputs) return Array.from({ length: end - first }, (_, offset) => decodeRecord(arrays, first + offset, shadows));
    requireLightingInput(arrays.shadowStart[first] === arrays.shadowStart[end], `lightmap texture ${texture} has no rebuild inputs but its records list shadow masks.`);
    return [];
  });
  return { textureHasInputs, textureRecords, actors: decodeLightmapRebuildActors(recordsDocument) };
}

export function requireLightmapRebuildInputsMatchModel(inputs: LightmapRebuildInputs, facts: LightmapRebuildModelFacts): void {
  const lightCount = inputs.actors.lights.length;
  requireCount("LMTX.rebuildInputs", inputs.textureHasInputs.length, facts.textureEdges.length);
  inputs.textureHasInputs.forEach((hasInputs, texture) => {
    requireLightingInput(hasInputs === facts.textureHasMismatchedPage[texture],
      `lightmap texture ${texture} rebuild inputs ${hasInputs ? "are" : "are not"} listed, but ${facts.textureHasMismatchedPage[texture] ? "a" : "no"} page has revision != compressed revision.`);
    const edge = facts.textureEdges[texture]!;
    inputs.textureRecords[texture]!.forEach((record, position) => {
      requireLightingInput(record.atlasX >= 0 && record.atlasY >= 0 && record.atlasX + record.projection.width <= edge && record.atlasY + record.projection.height <= edge,
        `lightmap texture ${texture} record ${position} leaves the ${edge} x ${edge} page.`);
      const unlisted = record.shadows.find(shadow => shadow.light >= lightCount);
      requireLightingInput(unlisted === undefined, `lightmap texture ${texture} record ${position} names light ${unlisted?.light} of ${lightCount} RECS lights.`);
    });
  });
}

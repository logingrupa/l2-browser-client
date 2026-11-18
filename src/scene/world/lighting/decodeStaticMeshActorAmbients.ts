import { fGetHsv } from "../../../environment/model/fGetHsv";
import { resolvedResult } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import { staticMeshRenderDataAmbient } from "../../../environment/model/meshLightingTerms";
import type { BgraBytes } from "../../../environment/model/nativeColourBytes";
import type { NativePlane } from "../../../environment/model/nativePlane";
import type { TypedPayload } from "../../../shared/typedPayload";
import { isJsonRecord, readLightingFields, requireLightingRecords, type LightingFields } from "./lightingFieldRecords";
import { allFieldsResolved, readBooleanField, readByteField, type RebuildFieldResult } from "./rebuildFieldReaders";
import { requireLightingInput, requireLightingPrefixStarts } from "./stagedLightingInput";
import type { TileLightingRecordsDocument } from "./tileLightingRecords";

export interface StaticMeshActorAmbient {
  readonly runtimeSunAffect: boolean;
  readonly renderDataAmbient: BgraBytes;
}

export type StaticMeshActorAmbientResult = RebuildFieldResult<StaticMeshActorAmbient>;

interface ZoneAmbient {
  readonly ambientVector: NativePlane;
  readonly sunAffect: boolean;
}

export const staticMeshActorAmbientReasons = {
  zonesUnresolved: "static-mesh-ambient-zones-unresolved",
  unlitActor: "static-mesh-unlit-actor-ambient-unresolved",
} as const;

export const staticMeshAmbientZoneArrayNames = ["SMAZ.actorExportIndex", "SMAZ.resolved", "SMAZ.ambientGlow", "SMAZ.unlit", "SMAZ.zoneStart", "SMAZ.zone"] as const;

const byteMaximum = 0xff;
const flagValues: ReadonlySet<number> = new Set([0, 1]);

function readZoneFields(document: TileLightingRecordsDocument): ReadonlyMap<number, LightingFields> {
  requireLightingRecords(Array.isArray(document.zones), "static mesh actor ambients need the zones list.");
  const zones = new Map<number, LightingFields>();
  (document.zones as unknown[]).forEach((value, position) => {
    const label = `zones[${position}]`;
    requireLightingRecords(isJsonRecord(value) && Number.isSafeInteger(value.zoneIndex) && Array.isArray(value.ambient) && isJsonRecord(value.sunAffect),
      `${label} has no zoneIndex, ambient list and sunAffect field.`);
    zones.set(value.zoneIndex as number, readLightingFields([...(value.ambient as unknown[]), value.sunAffect], label));
  });
  return zones;
}

function zoneAmbient(fields: LightingFields, zoneIndex: number): RebuildFieldResult<ZoneAmbient> {
  const owner = { fields, reasonPrefix: "static-mesh-ambient-zone", label: `zone ${zoneIndex}` };
  const read = allFieldsResolved({ hue: readByteField(owner, "AmbientHue"), saturation: readByteField(owner, "AmbientSaturation"),
    brightness: readByteField(owner, "AmbientBrightness"), sunAffect: readBooleanField(owner, "bSunAffect") });
  if (read.status !== "resolved") return read;
  const { hue, saturation, brightness, sunAffect } = read.value;
  return resolvedResult({ ambientVector: fGetHsv(hue, saturation, brightness), sunAffect });
}

function requireFlags(name: string, values: Int32Array): void {
  const outside = values.findIndex(value => !flagValues.has(value));
  requireLightingInput(outside === -1, `${name}[${outside}] = ${values[outside]} is not 0 or 1.`);
}

export function decodeStaticMeshActorAmbients(payload: TypedPayload, document: TileLightingRecordsDocument): ReadonlyMap<number, StaticMeshActorAmbientResult> {
  const actorExportIndex = payload.int32("SMAZ.actorExportIndex"), resolved = payload.int32("SMAZ.resolved"), ambientGlow = payload.int32("SMAZ.ambientGlow");
  const unlit = payload.int32("SMAZ.unlit"), zoneStart = payload.uint32("SMAZ.zoneStart"), zone = payload.int32("SMAZ.zone");
  const actorCount = actorExportIndex.length;
  requireLightingInput(resolved.length === actorCount && ambientGlow.length === actorCount && unlit.length === actorCount,
    "SMAZ arrays disagree on the static mesh actor count.");
  requireFlags("SMAZ.resolved", resolved);
  requireFlags("SMAZ.unlit", unlit);
  const glowOutside = ambientGlow.findIndex(glow => glow < 0 || glow > byteMaximum);
  requireLightingInput(glowOutside === -1, `SMAZ.ambientGlow[${glowOutside}] = ${ambientGlow[glowOutside]} is not a byte.`);
  requireLightingPrefixStarts("SMAZ.zoneStart", zoneStart, actorCount, zone.length);
  const zoneFields = readZoneFields(document), zoneAmbients = new Map<number, RebuildFieldResult<ZoneAmbient>>();
  const zoneAmbientOf = (zoneIndex: number) => {
    if (!zoneAmbients.has(zoneIndex)) {
      const fields = zoneFields.get(zoneIndex);
      requireLightingInput(fields !== undefined, `SMAZ.zone names zone ${zoneIndex}, which the lighting records do not list.`);
      zoneAmbients.set(zoneIndex, zoneAmbient(fields, zoneIndex));
    }
    return zoneAmbients.get(zoneIndex)!;
  };
  const ambients = new Map<number, StaticMeshActorAmbientResult>();
  for (let actor = 0; actor < actorCount; actor += 1) {
    const exportIndex = actorExportIndex[actor]!, touched = zone.subarray(zoneStart[actor]!, zoneStart[actor + 1]!);
    requireLightingInput(!ambients.has(exportIndex), `static mesh actor ${exportIndex} has two SMAZ rows.`);
    requireLightingInput(resolved[actor] === 1 || touched.length === 0, `unresolved SMAZ row of static mesh actor ${exportIndex} lists zones.`);
    if (resolved[actor] !== 1) { ambients.set(exportIndex, { status: "unresolved", reason: staticMeshActorAmbientReasons.zonesUnresolved }); continue; }
    if (unlit[actor] === 1) { ambients.set(exportIndex, { status: "unresolved", reason: staticMeshActorAmbientReasons.unlitActor }); continue; }
    ambients.set(exportIndex, touchedZoneAmbient(Array.from(touched, zoneAmbientOf), ambientGlow[actor]!));
  }
  return ambients;
}

function touchedZoneAmbient(touchedZones: readonly RebuildFieldResult<ZoneAmbient>[], ambientGlow: number): StaticMeshActorAmbientResult {
  const zones: ZoneAmbient[] = [];
  for (const touched of touchedZones) {
    if (touched.status !== "resolved") return touched;
    zones.push(touched.value);
  }
  return resolvedResult({ runtimeSunAffect: zones.some(entry => entry.sunAffect),
    renderDataAmbient: staticMeshRenderDataAmbient(zones.map(entry => entry.ambientVector), ambientGlow) });
}

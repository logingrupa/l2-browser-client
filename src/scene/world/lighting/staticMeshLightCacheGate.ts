import { resolvedResult } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import type { StaticMeshLightList } from "./decodeHourlyLightingInputs";
import type { TileLightActorRecord } from "./lightmapRebuildActors";
import { allFieldsResolved, readBooleanField, type RebuildFieldOwner, type RebuildFieldResult } from "./rebuildFieldReaders";

export interface StaticMeshHourlyEntry {
  readonly visibility: Uint8Array;
  readonly cacheKept: boolean;
}

const staticMeshHourlyLightReasons = {
  recordAbsentPrefix: "static-mesh-hourly-light-record-absent:",
  nullLight: "static-mesh-hourly-light-null",
} as const;

export const nullLightReference = 0;
const bitsPerByte = 8;

export function staticMeshMaskSetsAnyVertex(visibility: Uint8Array, vertexCount: number): boolean {
  const wholeBytes = Math.floor(vertexCount / bitsPerByte), trailingBits = vertexCount % bitsPerByte;
  if (visibility.subarray(0, wholeBytes).some(byte => byte !== 0)) return true;
  return trailingBits > 0 && (visibility[wholeBytes]! & ((1 << trailingBits) - 1)) !== 0;
}

export function staticMeshLightCacheExcluded(owner: RebuildFieldOwner): RebuildFieldResult<boolean> {
  const flags = allFieldsResolved({ dynamicLight: readBooleanField(owner, "bDynamicLight"), lightChanged: readBooleanField(owner, "bLightChanged"),
    deleteMe: readBooleanField(owner, "bDeleteMe") });
  if (flags.status !== "resolved") return flags;
  const { dynamicLight, lightChanged, deleteMe } = flags.value;
  const dynamicCacheFlag = dynamicLight, changedCacheFlag = !dynamicLight && (lightChanged || deleteMe);
  return resolvedResult(dynamicCacheFlag || changedCacheFlag);
}

function hourlyLightOwner(actor: TileLightActorRecord): RebuildFieldOwner {
  return { fields: actor.fields, reasonPrefix: "static-mesh-hourly-light", label: `light ${actor.object}` };
}

export function resolveStaticMeshHourlyEntries(list: StaticMeshLightList, lightsByExportIndex: ReadonlyMap<number, TileLightActorRecord>):
  RebuildFieldResult<readonly StaticMeshHourlyEntry[]> {
  const entries: StaticMeshHourlyEntry[] = [];
  for (const mask of list.hourlyMasks) {
    if (mask.light === nullLightReference) return { status: "unresolved", reason: staticMeshHourlyLightReasons.nullLight };
    if (!staticMeshMaskSetsAnyVertex(mask.visibility, list.vertexCount)) {
      entries.push({ visibility: mask.visibility, cacheKept: false });
      continue;
    }
    const actor = lightsByExportIndex.get(mask.light);
    if (actor === undefined) return { status: "unresolved", reason: `${staticMeshHourlyLightReasons.recordAbsentPrefix}${mask.light}` };
    const excluded = staticMeshLightCacheExcluded(hourlyLightOwner(actor));
    if (excluded.status !== "resolved") return excluded;
    entries.push({ visibility: mask.visibility, cacheKept: !excluded.value });
  }
  return resolvedResult(entries);
}

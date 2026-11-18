import type { LightingTables } from "../../../environment/model/lightmapRebuild/lightingTables";
import { lightmapAmbientBgra } from "../../../environment/model/lightmapRebuild/lightmapAmbientColour";
import { resolvedResult } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import type { BgraBytes } from "../../../environment/model/nativeColourBytes";
import { composeRebuiltLightmap, type RebuiltLightmapResult, type RebuiltLightmapSources } from "./composeRebuiltLightmap";
import { unlistedShadowLightIndex, type LightmapRebuildRecord } from "./decodeLightmapRebuildInputs";
import { allFieldsResolved, readByteField, type RebuildFieldResult } from "./rebuildFieldReaders";
import { rebuildLevelBrightness, resolveShadowLight, type RebuildLightEnvironment, type ShadowLight } from "./rebuildShadowLights";
import type { RebuildZoneAmbient, TileLevelInfoRecord, TileLightActorRecord } from "./lightmapRebuildActors";

export interface RebuiltLightmapRequest {
  readonly edge: number;
  readonly records: readonly LightmapRebuildRecord[];
  readonly lights: readonly TileLightActorRecord[];
  readonly zones: readonly RebuildZoneAmbient[];
  readonly levelInfos: readonly TileLevelInfoRecord[];
  readonly environment: RebuildLightEnvironment;
}

export const shadowLightUnlistedReason = "bsp-rebuild-shadow-light-unlisted";

function memoised<Value>(resolve: (key: number) => Value): (key: number) => Value {
  const known = new Map<number, Value>();
  return key => {
    if (!known.has(key)) known.set(key, resolve(key));
    return known.get(key)!;
  };
}

function zoneAmbient(zones: ReadonlyMap<number, RebuildZoneAmbient>, zoneIndex: number): RebuildFieldResult<BgraBytes> {
  const zone = zones.get(zoneIndex);
  if (zone === undefined) return { status: "unresolved", reason: `bsp-rebuild-zone-unlisted:${zoneIndex}` };
  if (zone.levelInfoFallback) return { status: "unresolved", reason: `bsp-rebuild-zone-actor-fallback:${zoneIndex}` };
  const owner = { fields: zone.ambient, reasonPrefix: "bsp-rebuild-zone-ambient", label: `zone ${zoneIndex} ambient` };
  const ambient = allFieldsResolved({ hue: readByteField(owner, "AmbientHue"), saturation: readByteField(owner, "AmbientSaturation"),
    brightness: readByteField(owner, "AmbientBrightness") });
  return ambient.status === "resolved" ? resolvedResult(lightmapAmbientBgra(ambient.value)) : ambient;
}

function rebuiltLightmapSources(request: RebuiltLightmapRequest, tables: LightingTables): RebuiltLightmapSources {
  const zones = new Map(request.zones.map(zone => [zone.zoneIndex, zone]));
  let levelBrightness: RebuildFieldResult<number> | null = null;
  const shadowLight = (light: number): RebuildFieldResult<ShadowLight> => {
    if (light === unlistedShadowLightIndex) return { status: "unresolved", reason: shadowLightUnlistedReason };
    levelBrightness ??= rebuildLevelBrightness(request.levelInfos);
    if (levelBrightness.status !== "resolved") return levelBrightness;
    return resolveShadowLight(request.lights[light]!, levelBrightness.value, request.environment);
  };
  return { zoneAmbient: memoised(zoneIndex => zoneAmbient(zones, zoneIndex)), shadowLight: memoised(shadowLight), tables };
}

export function composeRebuiltLightmapRequest(request: RebuiltLightmapRequest, tables: LightingTables): RebuiltLightmapResult {
  return composeRebuiltLightmap(request.edge, request.records, rebuiltLightmapSources(request, tables));
}

import { DYNAMIC_LIGHT_CONSTANTS } from "../../../environment/model/lightmapRebuild/dynamicLightEngineConstants";
import { resolvedResult } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import { rotatorVector } from "../../../environment/model/lightmapRebuild/rotatorVector";
import { worldLightRadius } from "../../../environment/model/lightmapRebuild/worldLightRadius";
import type { NativePlane } from "../../../environment/model/nativePlane";
import { staticMeshLightSamplerEffect, type StaticMeshLightSampler, type StaticMeshOrdinaryLight } from "../../../environment/model/staticMeshOrdinaryLighting";
import type { StaticMeshLightList } from "./decodeHourlyLightingInputs";
import { resolveLightActorColour } from "./lightActorColour";
import type { LightActorRecords, TileLevelInfoRecord, TileLightActorRecord } from "./lightmapRebuildActors";
import { allFieldsResolved, readBooleanField, readByteField, readNumberField, readRotatorField, readVectorField, type RebuildFieldOwner, type RebuildFieldResult } from "./rebuildFieldReaders";
import { rebuildLevelBrightness, type RebuildLightEnvironment } from "./rebuildShadowLights";

export type StaticMeshOrdinaryLightState =
  | { readonly contributes: false }
  | { readonly contributes: true; readonly light: StaticMeshOrdinaryLight };

export interface StaticMeshOrdinaryMaskLight {
  readonly light: StaticMeshOrdinaryLight;
  readonly visibility: Uint8Array;
}

export interface StaticMeshOrdinaryLightRecords {
  readonly lightsByExportIndex: ReadonlyMap<number, TileLightActorRecord>;
  readonly levelInfos: readonly TileLevelInfoRecord[];
}

export const staticMeshOrdinaryLightReasons = {
  timeVaryingColour: "static-mesh-ordinary-light-time-varying-colour-unported",
  lightType7TimeSeconds: "static-mesh-ordinary-light-type7-time-seconds-unverified",
  recordAbsentPrefix: "static-mesh-ordinary-light-record-absent:",
} as const;

const darkLight: StaticMeshOrdinaryLightState = { contributes: false };
const nullLightReference = 0;
const bitsPerByte = 8;
const modulatedLightType = DYNAMIC_LIGHT_CONSTANTS.lightTypeMultipliers.value.modulated;

function maskSetsAnyVertex(visibility: Uint8Array, vertexCount: number): boolean {
  const wholeBytes = Math.floor(vertexCount / bitsPerByte), trailingBits = vertexCount % bitsPerByte;
  if (visibility.subarray(0, wholeBytes).some(byte => byte !== 0)) return true;
  return trailingBits > 0 && (visibility[wholeBytes]! & ((1 << trailingBits) - 1)) !== 0;
}

function lightOwner(actor: TileLightActorRecord): RebuildFieldOwner {
  return { fields: actor.fields, reasonPrefix: "static-mesh-ordinary-light", label: `light ${actor.object}` };
}

const colourIsDark = (colour: NativePlane) => colour[0] === 0 && colour[1] === 0 && colour[2] === 0;

function lightSampler(owner: RebuildFieldOwner): RebuildFieldResult<StaticMeshLightSampler> {
  const lightEffect = readByteField(owner, "LightEffect");
  if (lightEffect.status !== "resolved") return lightEffect;
  const effect = staticMeshLightSamplerEffect(lightEffect.value);
  if (effect.status !== "resolved") return effect;
  const placement = allFieldsResolved({ position: readVectorField(owner, "Location"), lightRadius: readNumberField(owner, "LightRadius") });
  if (placement.status !== "resolved") return placement;
  const { position, lightRadius } = placement.value, radius = worldLightRadius(lightRadius);
  if (effect.value === "point") return resolvedResult({ effect: "point", position, radius });
  const spot = allFieldsResolved({ cone: readByteField(owner, "LightCone"), rotation: readRotatorField(owner, "Rotation") });
  if (spot.status !== "resolved") return spot;
  return resolvedResult({ effect: "spot", position, radius, cone: spot.value.cone, direction: rotatorVector(spot.value.rotation) });
}

export function resolveStaticMeshOrdinaryLight(actor: TileLightActorRecord, levelBrightness: number, environment: RebuildLightEnvironment):
  RebuildFieldResult<StaticMeshOrdinaryLightState> {
  const owner = lightOwner(actor);
  const authored = allFieldsResolved({ lightType: readByteField(owner, "LightType"), timeLight: readBooleanField(owner, "bTimeLight"),
    sunlightColour: readBooleanField(owner, "bSunlightColor") });
  if (authored.status !== "resolved") return authored;
  if (authored.value.timeLight || authored.value.sunlightColour) return { status: "unresolved", reason: staticMeshOrdinaryLightReasons.timeVaryingColour };
  const colour = resolveLightActorColour(owner, authored.value.lightType, levelBrightness, environment);
  if (colour.status !== "resolved") return colour;
  if (colourIsDark(colour.value)) return resolvedResult(darkLight);
  const cacheFlags = allFieldsResolved({ dynamicLight: readBooleanField(owner, "bDynamicLight"), deleteMe: readBooleanField(owner, "bDeleteMe") });
  if (cacheFlags.status !== "resolved") return cacheFlags;
  if (cacheFlags.value.dynamicLight || cacheFlags.value.deleteMe) return resolvedResult(darkLight);
  if (authored.value.lightType === modulatedLightType) return { status: "unresolved", reason: staticMeshOrdinaryLightReasons.lightType7TimeSeconds };
  const sampler = lightSampler(owner);
  if (sampler.status !== "resolved") return sampler;
  return resolvedResult({ contributes: true, light: { colour: colour.value, sampler: sampler.value } });
}

export function staticMeshOrdinaryLightRecords(lightActors: LightActorRecords): StaticMeshOrdinaryLightRecords {
  return { lightsByExportIndex: new Map(lightActors.lights.map(light => [light.exportIndex, light])), levelInfos: lightActors.levelInfos };
}

export function resolveStaticMeshOrdinaryTerm(list: StaticMeshLightList, records: StaticMeshOrdinaryLightRecords, environment: RebuildLightEnvironment):
  RebuildFieldResult<readonly StaticMeshOrdinaryMaskLight[]> {
  let levelBrightness: RebuildFieldResult<number> | null = null;
  const contributing: StaticMeshOrdinaryMaskLight[] = [];
  for (const mask of list.ordinaryMasks) {
    if (mask.light === nullLightReference || !maskSetsAnyVertex(mask.visibility, list.vertexCount)) continue;
    const actor = records.lightsByExportIndex.get(mask.light);
    if (actor === undefined) return { status: "unresolved", reason: `${staticMeshOrdinaryLightReasons.recordAbsentPrefix}${mask.light}` };
    levelBrightness ??= rebuildLevelBrightness(records.levelInfos);
    if (levelBrightness.status !== "resolved") return levelBrightness;
    const state = resolveStaticMeshOrdinaryLight(actor, levelBrightness.value, environment);
    if (state.status !== "resolved") return state;
    if (state.value.contributes) contributing.push({ light: state.value.light, visibility: mask.visibility });
  }
  return resolvedResult(contributing);
}

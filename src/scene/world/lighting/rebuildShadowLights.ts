import { dynamicLightColour } from "../../../environment/model/lightmapRebuild/dynamicLightColour";
import { DYNAMIC_LIGHT_CONSTANTS } from "../../../environment/model/lightmapRebuild/dynamicLightEngineConstants";
import { lightAttenuationBranch, type AttenuationLight, type LightAttenuationBranch } from "../../../environment/model/lightmapRebuild/lightAttenuation";
import { buildLightColourTable } from "../../../environment/model/lightmapRebuild/lightColourTable";
import { resolvedResult } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import { movableSunRotation } from "../../../environment/model/lightmapRebuild/movableSunRotation";
import { rotatorVector } from "../../../environment/model/lightmapRebuild/rotatorVector";
import { applyTimeLightRule } from "../../../environment/model/lightmapRebuild/timedLightSwitch";
import { worldLightRadius } from "../../../environment/model/lightmapRebuild/worldLightRadius";
import type { DayPart, NativeEnvironmentBlend } from "../../../environment/model/nativeEnvironmentManager";
import type { NativeEnvironmentTables } from "../../../environment/model/nativeEnvironmentTypeTables";
import {
  allFieldsResolved, readBooleanField, readByteField, readNumberField, readRotatorField, readVectorField, type RebuildFieldOwner, type RebuildFieldResult,
} from "./rebuildFieldReaders";
import { rebuiltLightmapNotes, type RebuiltLightmapNote } from "./composeRebuiltLightmap";
import type { TileLevelInfoRecord, TileLightActorRecord } from "./lightmapRebuildActors";

export interface RebuildFrozenFlag {
  readonly value: boolean;
  readonly verified: boolean;
}

export interface RebuildLightEnvironment {
  readonly hour: number;
  readonly dayPart: DayPart;
  readonly celestialPhiDegrees: number;
  readonly slopeSunAngle: number;
  readonly frozen: RebuildFrozenFlag;
  readonly tables: NativeEnvironmentTables;
  readonly blend: NativeEnvironmentBlend;
  readonly levelTimeSeconds: number;
}

export type ShadowLight =
  | { readonly applied: false }
  | { readonly applied: true; readonly attenuation: AttenuationLight; readonly colourTable: Uint8Array; readonly notes: readonly RebuiltLightmapNote[] };

interface ShadowLightAttenuation {
  readonly light: AttenuationLight;
  readonly notes: readonly RebuiltLightmapNote[];
}

const movableSunLightClass = "Engine.NMovableSunLight";
const untrackedTimedLightState = { switchFlags: 0, lightLifeTime: 0, lightPreviousTime: 0 } as const;
const modulatedLightType = DYNAMIC_LIGHT_CONSTANTS.lightTypeMultipliers.value.modulated;

function lightOwner(actor: TileLightActorRecord): RebuildFieldOwner {
  return { fields: actor.fields, reasonPrefix: "bsp-rebuild-light", label: `light ${actor.object}` };
}

export function rebuildLevelBrightness(levelInfos: readonly TileLevelInfoRecord[]): RebuildFieldResult<number> {
  if (levelInfos.length !== 1) return { status: "unresolved", reason: `bsp-rebuild-level-info-count:${levelInfos.length}` };
  const levelInfo = levelInfos[0]!;
  return readNumberField({ fields: levelInfo.fields, reasonPrefix: "bsp-rebuild-level-info", label: `level info ${levelInfo.exportIndex}` }, "Brightness");
}

function effectiveLightType(owner: RebuildFieldOwner, hour: number): RebuildFieldResult<number> {
  const authored = allFieldsResolved({ lightType: readByteField(owner, "LightType"), timeLight: readBooleanField(owner, "bTimeLight") });
  if (authored.status !== "resolved") return authored;
  const { lightType, timeLight } = authored.value;
  if (!timeLight) return resolvedResult(lightType);
  const schedule = allFieldsResolved({ lightOnTime: readNumberField(owner, "LightOnTime"), lightOffTime: readNumberField(owner, "LightOffTime") });
  if (schedule.status !== "resolved") return schedule;
  return resolvedResult(applyTimeLightRule({ timeLight, ...schedule.value }, { lightType, ...untrackedTimedLightState }, hour).lightType);
}

function lightColourTable(owner: RebuildFieldOwner, lightType: number, levelBrightness: number, environment: RebuildLightEnvironment): RebuildFieldResult<Uint8Array> {
  const source = allFieldsResolved({ lightPeriod: readByteField(owner, "LightPeriod"), lightPhase: readByteField(owner, "LightPhase"),
    lightHue: readByteField(owner, "LightHue"), lightSaturation: readByteField(owner, "LightSaturation"), lightBrightness: readNumberField(owner, "LightBrightness"),
    sunlightColour: readBooleanField(owner, "bSunlightColor") });
  if (source.status !== "resolved") return source;
  const colour = dynamicLightColour({ lightType, ...source.value },
    { tables: environment.tables, blend: environment.blend, hour: environment.hour, levelBrightness, levelTimeSeconds: environment.levelTimeSeconds });
  return colour.status === "resolved" ? resolvedResult(buildLightColourTable(colour.value)) : colour;
}

function sunDirectionLight(actor: TileLightActorRecord, owner: RebuildFieldOwner, environment: RebuildLightEnvironment): RebuildFieldResult<ShadowLightAttenuation> {
  if (actor.actorClass === movableSunLightClass) {
    const rotation = movableSunRotation({ ...environment, frozen: environment.frozen.value });
    return resolvedResult({ light: { branch: "sun-direction", direction: rotatorVector(rotation) },
      notes: environment.frozen.verified ? [] : [rebuiltLightmapNotes.sunFreezeFlag] });
  }
  const rotation = readRotatorField(owner, "Rotation");
  return rotation.status === "resolved" ? resolvedResult({ light: { branch: "sun-direction", direction: rotatorVector(rotation.value) }, notes: [] }) : rotation;
}

function positionedLight(branch: Exclude<LightAttenuationBranch, "sun-direction">, owner: RebuildFieldOwner): RebuildFieldResult<AttenuationLight> {
  const placement = allFieldsResolved({ position: readVectorField(owner, "Location"), lightRadius: readNumberField(owner, "LightRadius") });
  if (placement.status !== "resolved") return placement;
  const { position, lightRadius } = placement.value, radius = worldLightRadius(lightRadius);
  if (branch === "point-falloff") return resolvedResult({ branch, position, radius });
  const spot = allFieldsResolved({ cone: readByteField(owner, "LightCone"), rotation: readRotatorField(owner, "Rotation") });
  if (spot.status !== "resolved") return spot;
  return resolvedResult({ branch, position, radius, cone: spot.value.cone, spotDirection: rotatorVector(spot.value.rotation) });
}

function attenuationLight(actor: TileLightActorRecord, owner: RebuildFieldOwner, environment: RebuildLightEnvironment): RebuildFieldResult<ShadowLightAttenuation> {
  const lightEffect = readByteField(owner, "LightEffect");
  if (lightEffect.status !== "resolved") return lightEffect;
  const branch = lightAttenuationBranch(lightEffect.value);
  if (branch.status !== "resolved") return branch;
  if (branch.value === "sun-direction") return sunDirectionLight(actor, owner, environment);
  const positioned = positionedLight(branch.value, owner);
  return positioned.status === "resolved" ? resolvedResult({ light: positioned.value, notes: [] }) : positioned;
}

export function resolveShadowLight(actor: TileLightActorRecord, levelBrightness: number, environment: RebuildLightEnvironment): RebuildFieldResult<ShadowLight> {
  const owner = lightOwner(actor);
  const deleteMe = readBooleanField(owner, "bDeleteMe");
  if (deleteMe.status !== "resolved") return deleteMe;
  if (deleteMe.value) return resolvedResult({ applied: false });
  const attenuation = attenuationLight(actor, owner, environment);
  if (attenuation.status !== "resolved") return attenuation;
  const lightType = effectiveLightType(owner, environment.hour);
  if (lightType.status !== "resolved") return lightType;
  const colourTable = lightColourTable(owner, lightType.value, levelBrightness, environment);
  if (colourTable.status !== "resolved") return colourTable;
  const notes = lightType.value === modulatedLightType ? [...attenuation.value.notes, rebuiltLightmapNotes.lightType7TimeSeconds] : attenuation.value.notes;
  return resolvedResult({ applied: true, attenuation: attenuation.value.light, colourTable: colourTable.value, notes });
}

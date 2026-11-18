import { bspLightmapRebuildAmbient } from "../../../environment/model/bspLightmapSelection";
import { HOURLY_LIGHTING_CONSTANTS } from "../../../environment/model/hourlyLightingEngineConstants";
import { actorAmbientLight, staticMeshAmbientLight, type AmbientLight } from "../../../environment/model/meshLightingTerms";
import type { RgbaBytes } from "../../../environment/model/nativeColourBytes";
import {
  globalModulationOperation, hourlyLightingUnresolvedItems, nativeDrawLightingStates, staticMeshColourStreams,
  type HourlyLightingUnresolvedItem, type NativeDrawLightingState,
} from "../../../environment/model/nativeDrawLightingStates";
import type { EnvironmentResult } from "../../../environment/model/nativeEnvironmentColours";
import { zeroPlane } from "../../../environment/model/nativePlane";
import type { RgbBytes } from "../../../environment/model/sampleNativeTimeTables";
import type { HourlyEnvironmentLighting } from "../worldTimeOfDay";

export type HourlyAmbientInspection =
  | { readonly status: "resolved"; readonly value: RgbaBytes; readonly condition: string }
  | { readonly status: "unresolved"; readonly reason: string; readonly condition: string };

export interface UnresolvedDeviceFact {
  readonly status: "unresolved";
  readonly reason: "d3d-device-live-state" | "d3d-programmable-composition";
  readonly evidence: string;
}

export interface HourlyLightingTerms {
  readonly hour: number;
  readonly staticMesh: {
    readonly drawState: NativeDrawLightingState;
    readonly ambient: HourlyAmbientInspection;
    readonly levelOfDetailSunTermAmbient: HourlyAmbientInspection;
    readonly levelOfDetailSelection: { readonly status: "unresolved"; readonly reason: "static-mesh-level-of-detail-unresolved" };
    readonly colour0: { readonly drawn: "per-placement-instance-colour"; readonly condition: typeof staticMeshInstanceColourCondition;
      readonly ineligibleReason: "ma-final-static-vertex"; readonly declaration: typeof staticMeshColourStreams.instanceLighting };
    readonly colour1: { readonly drawn: "white"; readonly condition: typeof staticMeshAuthoredColourCondition;
      readonly reasons: readonly ["static-mesh-colour-selector-unresolved", "d3d-device-live-state"]; readonly declaration: typeof staticMeshColourStreams.authoredColour };
    readonly serializedInstanceColour: "serialized instance colours are cache data, not the runtime result";
  };
  readonly actor: { readonly drawState: NativeDrawLightingState; readonly ambient: HourlyAmbientInspection };
  readonly bsp: { readonly drawState: NativeDrawLightingState; readonly rebuildAmbient: EnvironmentResult<RgbBytes>; readonly rebuildAmbientBound: false };
  readonly terrainDrawState: NativeDrawLightingState;
  readonly dynamicLights: { readonly applied: false; readonly reasons: readonly ["d3d-device-live-state", "ma-temporal-light-types"] };
  readonly device: {
    readonly modulationOperation: typeof globalModulationOperation;
    readonly gl2Shader: UnresolvedDeviceFact;
    readonly materialSourceBit: UnresolvedDeviceFact;
    readonly lightList: UnresolvedDeviceFact;
    readonly seamlessTerrainAmbient: UnresolvedDeviceFact;
    readonly finalShaderColour: UnresolvedDeviceFact;
  };
  readonly unresolvedItems: readonly HourlyLightingUnresolvedItem[];
}

const staticMeshInstanceColourCondition = "COLOR0 is the RM-10 hourly CPU colour of each lit placement: hourly entries present, SMLL.sunAffect 1, no ordinary light mask bit, a vertex stream sidecar whose vertex count equals the light list, uniform scale; the shader adds the instance ambient and clamps per vertex, then MODULATE2X";
const staticMeshAuthoredColourCondition = "both authored colour streams are white on every lit placement, so COLOR1 is 1 whatever the selector, device+0x4244 bit 0x02 or mesh+0x188 choose";
const sunAffectedActorCondition = "an actor with bSunAffect (actor +0x13c bit 0); other actors are static-mesh-unhourly-ambient-unresolved or actor-unhourly-ambient-unresolved";
const { staticMeshSunTermLevelOfDetail } = HOURLY_LIGHTING_CONSTANTS;
const deviceLiveState = (evidence: string): UnresolvedDeviceFact => ({ status: "unresolved", reason: "d3d-device-live-state", evidence });

function ambientInspection<Reason extends string>(environment: EnvironmentResult<RgbBytes>, condition: string,
  light: (hourlyAmbient: RgbBytes) => AmbientLight<Reason>): HourlyAmbientInspection {
  if (environment.status !== "resolved") return { status: "unresolved", reason: environment.reason, condition };
  const result = light(environment.value);
  return result.status === "resolved" ? { status: "resolved", value: result.value, condition } : { status: "unresolved", reason: result.reason, condition };
}

function staticMeshAmbient(environment: HourlyEnvironmentLighting, levelOfDetailSunTerm: boolean): HourlyAmbientInspection {
  const condition = levelOfDetailSunTerm
    ? `${sunAffectedActorCondition}, drawn at LOD ${staticMeshSunTermLevelOfDetail.value} with no static mesh instance (actor +0x274 null)`
    : `${sunAffectedActorCondition}, with a static mesh instance or another LOD`;
  if (levelOfDetailSunTerm && environment.staticMeshLight.status !== "resolved") {
    return { status: "unresolved", reason: environment.staticMeshLight.reason, condition };
  }
  const staticSunPlane = levelOfDetailSunTerm && environment.staticMeshLight.status === "resolved" ? environment.staticMeshLight.value : zeroPlane;
  return ambientInspection(environment.staticMeshAmbient, condition, hourlyAmbient => staticMeshAmbientLight({ hourlyAmbient, actorSunAffect: true,
    selectedLevelOfDetail: levelOfDetailSunTerm ? staticMeshSunTermLevelOfDetail.value : 0, hasStaticMeshInstance: !levelOfDetailSunTerm, staticSunPlane }));
}

export function staticMeshInstanceAmbient(environment: HourlyEnvironmentLighting): HourlyAmbientInspection {
  return staticMeshAmbient(environment, false);
}

export function hourlyLightingTerms(environment: HourlyEnvironmentLighting): HourlyLightingTerms {
  const { bspAmbient } = environment;
  return {
    hour: environment.hour,
    staticMesh: {
      drawState: nativeDrawLightingStates.staticMesh,
      ambient: staticMeshInstanceAmbient(environment),
      levelOfDetailSunTermAmbient: staticMeshAmbient(environment, true),
      levelOfDetailSelection: { status: "unresolved", reason: "static-mesh-level-of-detail-unresolved" },
      colour0: { drawn: "per-placement-instance-colour", condition: staticMeshInstanceColourCondition, ineligibleReason: "ma-final-static-vertex",
        declaration: staticMeshColourStreams.instanceLighting },
      colour1: { drawn: "white", condition: staticMeshAuthoredColourCondition, reasons: ["static-mesh-colour-selector-unresolved", "d3d-device-live-state"],
        declaration: staticMeshColourStreams.authoredColour },
      serializedInstanceColour: "serialized instance colours are cache data, not the runtime result",
    },
    actor: { drawState: nativeDrawLightingStates.actor,
      ambient: ambientInspection(environment.actorAmbient, sunAffectedActorCondition, hourlyAmbient => actorAmbientLight(hourlyAmbient, true)) },
    bsp: { drawState: nativeDrawLightingStates.bsp, rebuildAmbientBound: false,
      rebuildAmbient: bspAmbient.status === "resolved" ? { status: "resolved", value: bspLightmapRebuildAmbient(bspAmbient.value) } : bspAmbient },
    terrainDrawState: nativeDrawLightingStates.terrain,
    dynamicLights: { applied: false, reasons: ["d3d-device-live-state", "ma-temporal-light-types"] },
    device: {
      modulationOperation: globalModulationOperation,
      gl2Shader: deviceLiveState("GL2Shader on or off decides the static mesh shader-visibility path against the CPU rebuild path"),
      materialSourceBit: deviceLiveState("device+0x4244 bit 0x02 makes COLOR1 the diffuse and ambient material source, otherwise the material is white"),
      lightList: deviceLiveState("the D3D light list the mesh and actor draws enable"),
      seamlessTerrainAmbient: deviceLiveState("the inherited D3DRS_AMBIENT on the seamless fixed-function terrain path that runs EnableLighting(1, 1, 1)"),
      finalShaderColour: { status: "unresolved", reason: "d3d-programmable-composition",
        evidence: "the GL2Shader vertex and pixel equations are not decoded, so no surface claims a final framebuffer colour" },
    },
    unresolvedItems: hourlyLightingUnresolvedItems.map(item => item.id),
  };
}

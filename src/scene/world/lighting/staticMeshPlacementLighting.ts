import { staticMeshRenderDataAmbientLight } from "../../../environment/model/meshLightingTerms";
import type { RgbaBytes } from "../../../environment/model/nativeColourBytes";
import type { NativePlane } from "../../../environment/model/nativePlane";
import {
  staticMeshHourlyEntryBlend, staticMeshHourlyEntryContributions, staticMeshHourlyInstanceColour, staticMeshSampleIntensity, staticMeshVertexVisible,
  type StaticMeshHourlyEntryContribution,
} from "../../../environment/model/staticMeshHourlyLighting";
import {
  staticMeshLocalToWorldFromRowMajorMatrix, staticMeshWorldNormal, staticMeshWorldPosition, type NativeLocalToWorld,
} from "../../../environment/model/staticMeshLocalToWorld";
import { staticMeshOrdinaryLightGain, staticMeshOrdinaryVertexColour } from "../../../environment/model/staticMeshOrdinaryLighting";
import type { Vector3 } from "../../../shared/math/vector3";
import type { NativeTileChunkPlacement } from "../nativeTileChunkManifest";
import type { StaticMeshLightList } from "./decodeHourlyLightingInputs";
import type { StaticMeshActorAmbientResult } from "./decodeStaticMeshActorAmbients";
import { authoredColourStreamsWhite, type StaticMeshVertexStreams } from "./loadStaticMeshVertexStreams";
import type { StaticMeshHourlyEntry } from "./staticMeshLightCacheGate";
import type { StaticMeshOrdinaryMaskLight } from "./staticMeshOrdinaryLights";
import type { StagedLightingInput } from "./stagedLightingInput";

export interface StaticMeshSunFrame {
  readonly hour: number;
  readonly lightDirection: Vector3;
  readonly staticSunPlane: NativePlane;
}

export interface StaticMeshPlacementOrdinaryTerm {
  readonly gain: number;
  readonly lights: readonly StaticMeshOrdinaryMaskLight[];
}

export interface StaticMeshPlacementInstance {
  readonly list: StaticMeshLightList;
  readonly localToWorld: NativeLocalToWorld;
  readonly gain: number;
}

export type StaticMeshPlacementAmbient =
  | { readonly source: "hourly" }
  | { readonly source: "render-data"; readonly ambient: RgbaBytes };

export type StaticMeshPlacementLightingJoin =
  | { readonly status: "eligible"; readonly instance: StaticMeshPlacementInstance | null; readonly runtimeSunAffect: boolean; readonly ambient: StaticMeshPlacementAmbient }
  | { readonly status: "unlit"; readonly reason: string };

export const staticMeshLightingReasons = {
  actorAmbientAbsent: "static-mesh-actor-ambient-absent",
  vertexCountMismatch: "static-mesh-vertex-streams-count-mismatch",
  colourSelector: "static-mesh-colour-selector-unresolved",
  primitiveUnjoined: "static-mesh-primitive-unjoined",
  levelOfDetailUnresolved: "static-mesh-level-of-detail-unresolved",
} as const;

const rgbChannels = 3;
const vectorComponents = 3;
const hourlyAmbient: StaticMeshPlacementAmbient = { source: "hourly" };

export function staticMeshPlacementLightingJoin(lightLists: StagedLightingInput<ReadonlyMap<number, StaticMeshLightList>>,
  actorAmbients: StagedLightingInput<ReadonlyMap<number, StaticMeshActorAmbientResult>>, placement: NativeTileChunkPlacement): StaticMeshPlacementLightingJoin {
  if (actorAmbients.status === "unstaged") return { status: "unlit", reason: actorAmbients.reason };
  const actorAmbient = actorAmbients.value.get(placement.exportIndex);
  if (actorAmbient === undefined) return { status: "unlit", reason: staticMeshLightingReasons.actorAmbientAbsent };
  if (actorAmbient.status !== "resolved") return { status: "unlit", reason: actorAmbient.reason };
  const { runtimeSunAffect, renderDataAmbient } = actorAmbient.value;
  const ambient: StaticMeshPlacementAmbient = runtimeSunAffect ? hourlyAmbient : { source: "render-data", ambient: staticMeshRenderDataAmbientLight(renderDataAmbient) };
  if (placement.vertexStreams.status === "gap") return { status: "unlit", reason: placement.vertexStreams.reason };
  if (lightLists.status === "unstaged") return { status: "unlit", reason: lightLists.reason };
  const list = lightLists.value.get(placement.exportIndex);
  if (list === undefined && runtimeSunAffect) return { status: "unlit", reason: staticMeshLightingReasons.levelOfDetailUnresolved };
  if (list === undefined) return { status: "eligible", instance: null, runtimeSunAffect, ambient };
  if (list.ordinaryInputs.status === "unstaged") return { status: "unlit", reason: list.ordinaryInputs.reason };
  const { localToWorld, scaleGlow } = list.ordinaryInputs.value;
  return { status: "eligible", instance: { list, localToWorld: staticMeshLocalToWorldFromRowMajorMatrix(localToWorld), gain: staticMeshOrdinaryLightGain(scaleGlow) },
    runtimeSunAffect, ambient };
}

export function staticMeshVertexStreamsReason(list: StaticMeshLightList | null, streams: StaticMeshVertexStreams): string | null {
  if (list !== null && streams.nativeVertexCount !== list.vertexCount) return staticMeshLightingReasons.vertexCountMismatch;
  return authoredColourStreamsWhite(streams) ? null : staticMeshLightingReasons.colourSelector;
}

function vertexVector(components: Float32Array, vertex: number): Vector3 {
  const offset = vertex * vectorComponents;
  return { x: components[offset]!, y: components[offset + 1]!, z: components[offset + 2]! };
}

export function staticMeshAbsentInstanceColours(streams: StaticMeshVertexStreams): Uint8Array {
  return new Uint8Array(streams.nativeVertexCount * rgbChannels);
}

export function staticMeshPlacementInstanceColours(instance: StaticMeshPlacementInstance, hourlyEntries: readonly StaticMeshHourlyEntry[],
  streams: StaticMeshVertexStreams, ordinary: StaticMeshPlacementOrdinaryTerm, frame: StaticMeshSunFrame): Uint8Array {
  const { list, localToWorld } = instance;
  const blend = hourlyEntries.length > 0 ? staticMeshHourlyEntryBlend(hourlyEntries.length, frame.hour) : null;
  const entryContributes = (entry: StaticMeshHourlyEntry, vertex: number) => entry.cacheKept && staticMeshVertexVisible(entry.visibility, vertex);
  const colours = new Uint8Array(list.vertexCount * rgbChannels);
  for (let vertex = 0; vertex < list.vertexCount; vertex += 1) {
    const worldNormal = staticMeshWorldNormal(localToWorld.rows, vertexVector(streams.nativeNormals, vertex));
    const worldPosition = staticMeshWorldPosition(localToWorld, vertexVector(streams.nativePositions, vertex));
    const lights = ordinary.lights.filter(entry => staticMeshVertexVisible(entry.visibility, vertex)).map(entry => entry.light);
    const ordinaryColour = staticMeshOrdinaryVertexColour(lights, ordinary.gain, { worldPosition: [worldPosition.x, worldPosition.y, worldPosition.z],
      worldNormal: [worldNormal.x, worldNormal.y, worldNormal.z] });
    const entries: readonly StaticMeshHourlyEntryContribution[] = blend === null ? [] : staticMeshHourlyEntryContributions(blend,
      entryContributes(hourlyEntries[blend.index]!, vertex), entryContributes(hourlyEntries[blend.nextIndex]!, vertex));
    colours.set(staticMeshHourlyInstanceColour(staticMeshSampleIntensity(worldNormal, frame.lightDirection), entries, frame.staticSunPlane, ordinaryColour),
      vertex * rgbChannels);
  }
  return colours;
}

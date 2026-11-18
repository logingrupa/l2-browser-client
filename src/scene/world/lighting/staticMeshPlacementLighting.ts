import type { NativePlane } from "../../../environment/model/nativePlane";
import {
  staticMeshHourlyEntryBlend, staticMeshHourlyEntryContributions, staticMeshHourlyInstanceColour, staticMeshSampleIntensity, staticMeshVertexVisible,
} from "../../../environment/model/staticMeshHourlyLighting";
import { staticMeshWorldNormal, staticMeshWorldPosition, type NativeLocalToWorld } from "../../../environment/model/staticMeshLocalToWorld";
import { staticMeshOrdinaryLightGain, staticMeshOrdinaryVertexColour } from "../../../environment/model/staticMeshOrdinaryLighting";
import type { Vector3 } from "../../../shared/math/vector3";
import type { NativeTileChunkPlacement } from "../nativeTileChunkManifest";
import { sunAffected, type StaticMeshLightList } from "./decodeHourlyLightingInputs";
import { authoredColourStreamsWhite, type StaticMeshVertexStreams } from "./loadStaticMeshVertexStreams";
import type { StaticMeshOrdinaryMaskLight } from "./staticMeshOrdinaryLights";
import { staticMeshPlacementLocalToWorld } from "./staticMeshPlacementLocalToWorld";
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

export type StaticMeshPlacementLightingJoin =
  | { readonly status: "eligible"; readonly list: StaticMeshLightList; readonly localToWorld: NativeLocalToWorld; readonly gain: number }
  | { readonly status: "unlit"; readonly reason: string };

export const staticMeshLightingReasons = {
  lightListAbsent: "static-mesh-light-list-absent",
  ambientFallbackProducer: "rm10-static-ambient-fallback-producer",
  vertexCountMismatch: "static-mesh-vertex-streams-count-mismatch",
  colourSelector: "static-mesh-colour-selector-unresolved",
  primitiveUnjoined: "static-mesh-primitive-unjoined",
} as const;

const rgbChannels = 3;
const vectorComponents = 3;

export function staticMeshPlacementLightingJoin(lightLists: StagedLightingInput<ReadonlyMap<number, StaticMeshLightList>>,
  placement: NativeTileChunkPlacement): StaticMeshPlacementLightingJoin {
  if (lightLists.status === "unstaged") return { status: "unlit", reason: lightLists.reason };
  const list = lightLists.value.get(placement.exportIndex);
  if (list === undefined) return { status: "unlit", reason: staticMeshLightingReasons.lightListAbsent };
  if (list.hourlyMasks.length === 0) return { status: "unlit", reason: staticMeshLightingReasons.ambientFallbackProducer };
  if (list.sunAffect.status === "unstaged") return { status: "unlit", reason: list.sunAffect.reason };
  if (list.sunAffect.value !== sunAffected) return { status: "unlit", reason: staticMeshLightingReasons.ambientFallbackProducer };
  if (placement.vertexStreams.status === "gap") return { status: "unlit", reason: placement.vertexStreams.reason };
  if (list.ordinaryInputs.status === "unstaged") return { status: "unlit", reason: list.ordinaryInputs.reason };
  const transform = staticMeshPlacementLocalToWorld(list.ordinaryInputs.value.localToWorld);
  if (transform.status === "unresolved") return { status: "unlit", reason: transform.reason };
  return { status: "eligible", list, localToWorld: transform.localToWorld, gain: staticMeshOrdinaryLightGain(list.ordinaryInputs.value.scaleGlow) };
}

export function staticMeshVertexStreamsReason(list: StaticMeshLightList, streams: StaticMeshVertexStreams): string | null {
  if (streams.nativeVertexCount !== list.vertexCount) return staticMeshLightingReasons.vertexCountMismatch;
  return authoredColourStreamsWhite(streams) ? null : staticMeshLightingReasons.colourSelector;
}

function vertexVector(components: Float32Array, vertex: number): Vector3 {
  const offset = vertex * vectorComponents;
  return { x: components[offset]!, y: components[offset + 1]!, z: components[offset + 2]! };
}

export function staticMeshPlacementInstanceColours(list: StaticMeshLightList, streams: StaticMeshVertexStreams, localToWorld: NativeLocalToWorld,
  ordinary: StaticMeshPlacementOrdinaryTerm, frame: StaticMeshSunFrame): Uint8Array {
  const blend = list.hourlyMasks.length === 0 ? null : staticMeshHourlyEntryBlend(list.hourlyMasks.length, frame.hour);
  const colours = new Uint8Array(list.vertexCount * rgbChannels);
  for (let vertex = 0; vertex < list.vertexCount; vertex += 1) {
    const worldNormal = staticMeshWorldNormal(localToWorld.rows, vertexVector(streams.nativeNormals, vertex));
    const worldPosition = staticMeshWorldPosition(localToWorld, vertexVector(streams.nativePositions, vertex));
    const lights = ordinary.lights.filter(entry => staticMeshVertexVisible(entry.visibility, vertex)).map(entry => entry.light);
    const ordinaryColour = staticMeshOrdinaryVertexColour(lights, ordinary.gain, { worldPosition: [worldPosition.x, worldPosition.y, worldPosition.z],
      worldNormal: [worldNormal.x, worldNormal.y, worldNormal.z] });
    const entries = blend === null ? [] : staticMeshHourlyEntryContributions(blend,
      staticMeshVertexVisible(list.hourlyMasks[blend.index]!.visibility, vertex), staticMeshVertexVisible(list.hourlyMasks[blend.nextIndex]!.visibility, vertex));
    colours.set(staticMeshHourlyInstanceColour(staticMeshSampleIntensity(worldNormal, frame.lightDirection), entries, frame.staticSunPlane, ordinaryColour),
      vertex * rgbChannels);
  }
  return colours;
}

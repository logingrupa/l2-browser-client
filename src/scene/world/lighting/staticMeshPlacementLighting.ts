import type { NativePlane } from "../../../environment/model/nativePlane";
import {
  staticMeshHourlyEntryBlend, staticMeshHourlyEntryContributions, staticMeshHourlyInstanceColour, staticMeshSampleIntensity, staticMeshVertexVisible,
  staticMeshWorldNormal, type NativeLocalToWorldRows,
} from "../../../environment/model/staticMeshHourlyLighting";
import type { Vector3 } from "../../../shared/math/vector3";
import type { NativeTileChunkPlacement } from "../nativeTileChunkManifest";
import { sunAffected, type StagedLightingInput, type StaticMeshLightList } from "./decodeHourlyLightingInputs";
import { authoredColourStreamsWhite, type StaticMeshVertexStreams } from "./loadStaticMeshVertexStreams";
import { staticMeshPlacementNormalTransform } from "./staticMeshPlacementNormalTransform";

export interface StaticMeshSunFrame {
  readonly hour: number;
  readonly lightDirection: Vector3;
  readonly staticSunPlane: NativePlane;
}

export type StaticMeshPlacementLightingJoin =
  | { readonly status: "eligible"; readonly list: StaticMeshLightList; readonly rows: NativeLocalToWorldRows }
  | { readonly status: "unlit"; readonly reason: string };

export const staticMeshLightingReasons = {
  lightListAbsent: "static-mesh-light-list-absent",
  ambientFallbackProducer: "rm10-static-ambient-fallback-producer",
  allLightEffects: "rm10-all-light-effects",
  vertexCountMismatch: "static-mesh-vertex-streams-count-mismatch",
  colourSelector: "static-mesh-colour-selector-unresolved",
  primitiveUnjoined: "static-mesh-primitive-unjoined",
} as const;

const rgbChannels = 3;
const normalComponents = 3;

export function staticMeshPlacementLightingJoin(lightLists: StagedLightingInput<ReadonlyMap<number, StaticMeshLightList>>,
  placement: NativeTileChunkPlacement): StaticMeshPlacementLightingJoin {
  if (lightLists.status === "unstaged") return { status: "unlit", reason: lightLists.reason };
  const list = lightLists.value.get(placement.exportIndex);
  if (list === undefined) return { status: "unlit", reason: staticMeshLightingReasons.lightListAbsent };
  if (list.hourlyMasks.length === 0) return { status: "unlit", reason: staticMeshLightingReasons.ambientFallbackProducer };
  if (list.sunAffect.status === "unstaged") return { status: "unlit", reason: list.sunAffect.reason };
  if (list.sunAffect.value !== sunAffected) return { status: "unlit", reason: staticMeshLightingReasons.ambientFallbackProducer };
  if (list.ordinaryLightVertexMask.some(byte => byte !== 0)) return { status: "unlit", reason: staticMeshLightingReasons.allLightEffects };
  if (placement.vertexStreams.status === "gap") return { status: "unlit", reason: placement.vertexStreams.reason };
  const transform = staticMeshPlacementNormalTransform(placement.matrix);
  if (transform.status === "unresolved") return { status: "unlit", reason: transform.reason };
  return { status: "eligible", list, rows: transform.rows };
}

export function staticMeshVertexStreamsReason(list: StaticMeshLightList, streams: StaticMeshVertexStreams): string | null {
  if (streams.nativeVertexCount !== list.vertexCount) return staticMeshLightingReasons.vertexCountMismatch;
  return authoredColourStreamsWhite(streams) ? null : staticMeshLightingReasons.colourSelector;
}

export function staticMeshPlacementInstanceColours(list: StaticMeshLightList, streams: StaticMeshVertexStreams, rows: NativeLocalToWorldRows,
  frame: StaticMeshSunFrame): Uint8Array {
  const blend = staticMeshHourlyEntryBlend(list.hourlyMasks.length, frame.hour);
  const previous = list.hourlyMasks[blend.index]!.visibility, next = list.hourlyMasks[blend.nextIndex]!.visibility;
  const colours = new Uint8Array(list.vertexCount * rgbChannels);
  for (let vertex = 0; vertex < list.vertexCount; vertex += 1) {
    const offset = vertex * normalComponents;
    const normal = { x: streams.nativeNormals[offset]!, y: streams.nativeNormals[offset + 1]!, z: streams.nativeNormals[offset + 2]! };
    const sampleIntensity = staticMeshSampleIntensity(staticMeshWorldNormal(rows, normal), frame.lightDirection);
    const entries = staticMeshHourlyEntryContributions(blend, staticMeshVertexVisible(previous, vertex), staticMeshVertexVisible(next, vertex));
    colours.set(staticMeshHourlyInstanceColour(sampleIntensity, entries, frame.staticSunPlane), vertex * rgbChannels);
  }
  return colours;
}

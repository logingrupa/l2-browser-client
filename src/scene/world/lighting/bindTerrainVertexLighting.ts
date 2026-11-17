import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { HOURLY_LIGHTING_CONSTANTS } from "../../../environment/model/hourlyLightingEngineConstants";
import type { BgraBytes } from "../../../environment/model/nativeColourBytes";
import { terrainRefreshThreshold } from "../../../environment/model/nativeDrawLightingStates";
import type { NativePlane } from "../../../environment/model/nativePlane";
import { terrainIntensityMapBlend, type HourlyKeyBlend, type RgbBytes } from "../../../environment/model/sampleNativeTimeTables";
import {
  terrainIntensitySampleIndex, terrainVertexColour, terrainVertexStaticBase, truncatedTerrainIntensity,
} from "../../../environment/model/terrainVertexLighting";
import type { HourlyEnvironmentLighting } from "../worldTimeOfDay";
import { terrainLightingUnportedReason } from "./bindTerrainLayerMaterials";
import type { StagedLightingInput, TerrainIntensityMaps, TerrainLightMaskSummary } from "./decodeHourlyLightingInputs";
import { terrainVertexSampleIndices } from "./terrainVertexSampleIndices";

export interface TerrainVertexLightingProbe {
  readonly column: number;
  readonly row: number;
  readonly intensity: number;
  readonly bgra: BgraBytes;
}

export interface TerrainStaticBaseInspection {
  readonly status: "resolved" | "unresolved";
  readonly reasons: readonly string[];
  readonly lightsCoveringAVertex: number | null;
}

export interface TerrainVertexLightingInspection {
  readonly gap: string | null;
  readonly rebuildCount: number;
  readonly lastRebuildHour: number | null;
  readonly heldReason: string | null;
  readonly mapTimes: readonly number[];
  readonly mapBlend: HourlyKeyBlend | null;
  readonly ambient: RgbBytes | null;
  readonly halvedAmbient: RgbBytes | null;
  readonly light: NativePlane | null;
  readonly probe: TerrainVertexLightingProbe | null;
  readonly staticBase: TerrainStaticBaseInspection;
  readonly colouredMeshCount: number;
  readonly colouredVertexCount: number;
  readonly meshGaps: Readonly<Record<string, number>>;
  readonly drawn: { readonly value: false; readonly reason: typeof terrainLightingUnportedReason };
  readonly refreshThreshold: typeof terrainRefreshThreshold;
}

export interface TerrainVertexLightingBinding {
  addChunk(chunkId: string, meshes: readonly AbstractMesh[], environment: () => HourlyEnvironmentLighting): void;
  removeChunk(chunkId: string): void;
  update(lightingDirty: boolean, environment: () => HourlyEnvironmentLighting): void;
  inspection(): TerrainVertexLightingInspection;
}

interface KeyedTerrainMesh {
  readonly mesh: Mesh;
  readonly sampleIndices: Int32Array;
  readonly colours: Float32Array;
}

interface KeyedTerrainChunk {
  readonly keyedMeshes: readonly KeyedTerrainMesh[];
  readonly meshGaps: readonly string[];
}

interface LatchedTerrainLighting {
  readonly hour: number;
  readonly mapBlend: HourlyKeyBlend;
  readonly ambient: RgbBytes;
  readonly light: NativePlane;
  readonly colourByIntensity: readonly BgraBytes[];
}

export const terrainProbeSample = { column: 134, row: 129, source: "DB-7 claim audit terrain sample 20_21 TerrainSector136 vertex global (134,129)" } as const;
export const terrainLightMaskSectorOriginUnstagedReason = "terrain-light-mask-sector-origin-unstaged";
const terrainIntensityMapsEmptyReason = "terrain-intensity-maps-empty";
const terrainVertexColourUndrawn = { value: false, reason: terrainLightingUnportedReason } as const;
const terrainIntensityMapWidthUnportedPrefix = "terrain-intensity-map-size-unported:";
const intensityLevels = 256;
const rgbaChannels = 4;
const byteMaximum = 255;
const { terrainIntensityMapWidth } = HOURLY_LIGHTING_CONSTANTS;

function intensityMapsGap(input: StagedLightingInput<TerrainIntensityMaps>): string | null {
  if (input.status === "unstaged") return input.reason;
  const { width, height, times } = input.value;
  if (width !== terrainIntensityMapWidth.value || height !== terrainIntensityMapWidth.value) return `${terrainIntensityMapWidthUnportedPrefix}${width}x${height}`;
  return times.length === 0 ? terrainIntensityMapsEmptyReason : null;
}

function staticBaseInspection(lightMasks: StagedLightingInput<TerrainLightMaskSummary>): TerrainStaticBaseInspection {
  if (lightMasks.status === "unstaged") return { status: "unresolved", reasons: [lightMasks.reason], lightsCoveringAVertex: null };
  const { lightsCoveringAVertex } = lightMasks.value;
  if (lightsCoveringAVertex === 0) return { status: "resolved", reasons: [], lightsCoveringAVertex };
  return { status: "unresolved", reasons: ["terrain-general-staticlight-sampleintensity", terrainLightMaskSectorOriginUnstagedReason], lightsCoveringAVertex };
}

function halved(ambient: RgbBytes): RgbBytes {
  return [ambient[0] >> 1, ambient[1] >> 1, ambient[2] >> 1];
}

function latchTerrainLighting(maps: TerrainIntensityMaps, environment: HourlyEnvironmentLighting, staticBaseState: TerrainStaticBaseInspection): LatchedTerrainLighting | string {
  const { terrainAmbient, terrainLight, hour } = environment;
  if (terrainAmbient.status !== "resolved") return terrainAmbient.reason;
  if (terrainLight.status !== "resolved") return terrainLight.reason;
  const vertexStaticBase = terrainVertexStaticBase(staticBaseState.status !== "resolved");
  if (vertexStaticBase.status !== "resolved") return staticBaseState.reasons.join(", ");
  const staticBase = vertexStaticBase.value;
  const colourByIntensity = Array.from({ length: intensityLevels }, (_, intensity) => terrainVertexColour(staticBase, terrainLight.value, intensity, terrainAmbient.value));
  return { hour, mapBlend: terrainIntensityMapBlend(maps.times, hour), ambient: terrainAmbient.value, light: terrainLight.value, colourByIntensity };
}

function writeVertexColours(maps: TerrainIntensityMaps, latched: LatchedTerrainLighting, keyed: KeyedTerrainMesh): void {
  const { index, nextIndex, weight } = latched.mapBlend;
  const previousMap = maps.maps[index]!, nextMap = maps.maps[nextIndex]!;
  for (let vertex = 0; vertex < keyed.sampleIndices.length; vertex += 1) {
    const bgra = latched.colourByIntensity[truncatedTerrainIntensity(previousMap, nextMap, keyed.sampleIndices[vertex]!, weight)]!;
    keyed.colours.set([bgra[2] / byteMaximum, bgra[1] / byteMaximum, bgra[0] / byteMaximum, bgra[3] / byteMaximum], vertex * rgbaChannels);
  }
  if (keyed.mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) keyed.mesh.updateVerticesData(VertexBuffer.ColorKind, keyed.colours);
  else keyed.mesh.setVerticesData(VertexBuffer.ColorKind, keyed.colours, true, rgbaChannels);
  keyed.mesh.useVertexColors = false;
}

function probeOf(maps: TerrainIntensityMaps, latched: LatchedTerrainLighting): TerrainVertexLightingProbe {
  const sample = terrainIntensitySampleIndex(terrainProbeSample.column, terrainProbeSample.row);
  const intensity = truncatedTerrainIntensity(maps.maps[latched.mapBlend.index]!, maps.maps[latched.mapBlend.nextIndex]!, sample, latched.mapBlend.weight);
  return { column: terrainProbeSample.column, row: terrainProbeSample.row, intensity, bgra: latched.colourByIntensity[intensity]! };
}

function keyTerrainMesh(mesh: AbstractMesh, maps: TerrainIntensityMaps): KeyedTerrainMesh | string {
  if (!(mesh instanceof Mesh)) return `terrain-mesh-not-editable:${mesh.name}`;
  const vertexCount = mesh.getTotalVertices();
  const keyed = terrainVertexSampleIndices(mesh.name, mesh.metadata, vertexCount, maps.width, maps.height);
  return keyed.status === "gap" ? keyed.reason : { mesh, sampleIndices: keyed.sampleIndices, colours: new Float32Array(vertexCount * rgbaChannels) };
}

export function bindTerrainVertexLighting(intensityMaps: StagedLightingInput<TerrainIntensityMaps>,
  lightMasks: StagedLightingInput<TerrainLightMaskSummary>): TerrainVertexLightingBinding {
  const gap = intensityMapsGap(intensityMaps);
  const maps = gap === null && intensityMaps.status === "staged" ? intensityMaps.value : null;
  const staticBase = staticBaseInspection(lightMasks);
  const chunks = new Map<string, KeyedTerrainChunk>();
  let latched: LatchedTerrainLighting | null = null, heldReason: string | null = null, rebuildCount = 0;
  const colourChunk = (keyedMeshes: readonly KeyedTerrainMesh[]) => {
    if (maps !== null && latched !== null) for (const keyed of keyedMeshes) writeVertexColours(maps, latched, keyed);
  };
  const rebuild = (environment: HourlyEnvironmentLighting) => {
    if (maps === null) return;
    const latchedNow = latchTerrainLighting(maps, environment, staticBase);
    if (typeof latchedNow === "string") { heldReason = latchedNow; return; }
    latched = latchedNow;
    heldReason = null;
    rebuildCount += 1;
    for (const chunk of chunks.values()) colourChunk(chunk.keyedMeshes);
  };
  const keyedMeshesOf = () => [...chunks.values()].flatMap(chunk => chunk.keyedMeshes);
  const meshGapCounts = () => {
    const counts: Record<string, number> = {};
    for (const chunk of chunks.values()) for (const reason of chunk.meshGaps) counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  };
  return {
    addChunk(chunkId, meshes, environment) {
      if (maps === null || chunks.has(chunkId)) return;
      const keyedMeshes: KeyedTerrainMesh[] = [], meshGaps: string[] = [];
      for (const mesh of meshes) {
        const keyed = keyTerrainMesh(mesh, maps);
        if (typeof keyed === "string") meshGaps.push(keyed);
        else keyedMeshes.push(keyed);
      }
      chunks.set(chunkId, { keyedMeshes, meshGaps });
      if (latched === null) rebuild(environment());
      else colourChunk(keyedMeshes);
    },
    removeChunk(chunkId) { chunks.delete(chunkId); },
    update(lightingDirty, environment) {
      if (maps !== null && (latched === null || lightingDirty)) rebuild(environment());
    },
    inspection() {
      const keyedMeshes = keyedMeshesOf();
      return { gap, rebuildCount, lastRebuildHour: latched?.hour ?? null, heldReason, mapTimes: maps?.times ?? [], mapBlend: latched?.mapBlend ?? null,
        ambient: latched?.ambient ?? null, halvedAmbient: latched === null ? null : halved(latched.ambient), light: latched?.light ?? null,
        probe: maps !== null && latched !== null ? probeOf(maps, latched) : null, staticBase, colouredMeshCount: latched === null ? 0 : keyedMeshes.length,
        colouredVertexCount: latched === null ? 0 : keyedMeshes.reduce((sum, keyed) => sum + keyed.sampleIndices.length, 0),
        meshGaps: meshGapCounts(), drawn: terrainVertexColourUndrawn, refreshThreshold: terrainRefreshThreshold };
    },
  };
}

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { drawNativeSessionSeed } from "../../../assets/native/nativeSessionSeed";
import { loadNativeMaterial, type NativeMaterialUniforms } from "../../../materials/ue2/babylon/material";
import { createPresentationClock } from "../../../shared/presentationClock";
import { worldPositionToSource } from "../../../world/sourceFrame";
import type { TileVisibilityFrame } from "../bspVisibility/core/tileVisibilityFrame";
import { computeCameraEnvironment, type CameraEnvironment } from "../cameraEnvironment";
import type { NativeTileManifest } from "../nativeTileManifest";
import { loadStaticMeshMaterialsListing } from "../staticMeshLibraryMaterials";
import { bindStaticMeshLibraryMaterials, type StaticMeshLibraryBinding, type StaticMeshLibraryInspection } from "./bindStaticMeshLibraryMaterials";
import { bindTileLighting, type TileLightingBinding, type TileLightingBspChunk, type TileLightingInspection } from "./bindTileLighting";
import type { TileLightingModel } from "./decodeTileLighting";
import { loadTileLighting } from "./loadTileLighting";
import { readNativeMaterialProgramPin } from "../../../assets/native/nativeMaterialProgramPin";
import { worldTimeOfDayFor } from "../worldTimeOfDay";

export interface TileLightingGapInspection {
  readonly gap: string;
}

export type TerrainLayerStatus = "program-unconverted" | "library-terrain-layers-unported";

type TerrainLayerCounts = Partial<Record<TerrainLayerStatus, number>>;

export interface TileLightingRuntimeInspection extends TileLightingInspection {
  readonly cameraEnvironment: CameraEnvironment;
  readonly staticMeshSlots: StaticMeshLibraryInspection;
  readonly terrainLayers: Readonly<TerrainLayerCounts>;
}

export interface TileLightingChunkSurfaces {
  readonly chunkId: string;
  readonly bspChunk: TileLightingBspChunk | null;
  readonly staticMeshes: readonly AbstractMesh[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export interface AttachedTileLighting {
  readonly materialUniforms: (() => NativeMaterialUniforms) | null;
  readonly binding: TileLightingBinding | null;
  addChunk(surfaces: TileLightingChunkSurfaces): Promise<void>;
  removeChunk(chunkId: string): void;
  inspection(): TileLightingRuntimeInspection | TileLightingGapInspection;
  dispose(): void;
}

const lightingResourceKind = "lighting";
export const lightingResourceAbsentReason = "lighting-resource-absent";
const payloadInvalidReasonPrefix = "lighting-payload-invalid:";
const millisecondsPerSecond = 1000;

function unboundTileLighting(gap: string): AttachedTileLighting {
  return { materialUniforms: null, binding: null, addChunk: async () => {}, removeChunk() {}, inspection: () => ({ gap }), dispose() {} };
}

function terrainLayerCounts(meshes: readonly AbstractMesh[]): TerrainLayerCounts {
  const counts: TerrainLayerCounts = {};
  for (const mesh of meshes) {
    const status = readNativeMaterialProgramPin(mesh.material) === null ? "program-unconverted" : "library-terrain-layers-unported";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function summedTerrainLayerCounts(perChunk: readonly TerrainLayerCounts[]): TerrainLayerCounts {
  const sum: TerrainLayerCounts = {};
  for (const counts of perChunk) {
    for (const [status, count] of Object.entries(counts) as [TerrainLayerStatus, number][]) sum[status] = (sum[status] ?? 0) + count;
  }
  return sum;
}

function cameraEnvironmentOf(scene: Scene, model: TileLightingModel, cameraFrame: () => TileVisibilityFrame | null): CameraEnvironment {
  const cameraPosition = scene.activeCamera?.globalPosition;
  const cameraSourcePosition = cameraPosition === undefined ? null : worldPositionToSource({ x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z });
  return computeCameraEnvironment({ frame: cameraFrame(), cameraSourcePosition, collision: null, records: model.records });
}

export async function attachTileLighting(scene: Scene, manifest: NativeTileManifest, cameraFrame: () => TileVisibilityFrame | null, signal: AbortSignal):
  Promise<AttachedTileLighting> {
  const resource = manifest.resources.find(entry => entry.kind === lightingResourceKind);
  if (resource === undefined) return unboundTileLighting(lightingResourceAbsentReason);
  const timeOfDay = worldTimeOfDayFor(scene);
  if (timeOfDay.status === "gap") return unboundTileLighting(timeOfDay.reason);
  let model: TileLightingModel;
  try {
    model = await loadTileLighting(resource, signal);
  } catch (error) {
    signal.throwIfAborted();
    const name = error instanceof Error ? error.name : "Error", message = error instanceof Error ? error.message : String(error);
    return unboundTileLighting(`${payloadInvalidReasonPrefix}${name}: ${message}`);
  }
  const staticMeshMaterials = await loadStaticMeshMaterialsListing(manifest, signal);
  const presentationClock = createPresentationClock();
  let cameraEnvironment = cameraEnvironmentOf(scene, model, cameraFrame);
  const advance = scene.onBeforeRenderObservable.add(() => {
    presentationClock.advance(scene.getEngine().getDeltaTime() / millisecondsPerSecond);
    cameraEnvironment = cameraEnvironmentOf(scene, model, cameraFrame);
  });
  const sessionSeed = drawNativeSessionSeed();
  const materialUniforms = (): NativeMaterialUniforms => {
    const environment = timeOfDay.sample();
    return { levelSeconds: presentationClock.levelSeconds, hour: environment.hour, environmentType: environment.targetType, fog: cameraEnvironment.fog };
  };
  const binding = bindTileLighting({ scene, model, sessionSeed, environment: () => timeOfDay.sample(),
    levelSeconds: () => presentationClock.levelSeconds, fog: () => cameraEnvironment.fog, loadProgram: loadNativeMaterial });
  const staticMeshBinding: StaticMeshLibraryBinding = bindStaticMeshLibraryMaterials({ scene, load: staticMeshMaterials, sessionSeed,
    uniforms: materialUniforms, loadProgram: loadNativeMaterial });
  const terrainLayerCountsByChunk = new Map<string, TerrainLayerCounts>();
  return {
    materialUniforms, binding,
    async addChunk(surfaces) {
      const counts = terrainLayerCounts(surfaces.terrainMeshes);
      if (surfaces.bspChunk !== null) await binding.addChunk(surfaces.bspChunk);
      await staticMeshBinding.addChunk(surfaces.chunkId, surfaces.staticMeshes);
      terrainLayerCountsByChunk.set(surfaces.chunkId, counts);
    },
    removeChunk(chunkId) {
      terrainLayerCountsByChunk.delete(chunkId);
      binding.removeChunk(chunkId);
      staticMeshBinding.removeChunk(chunkId);
    },
    inspection: () => ({ ...binding.inspection(), cameraEnvironment, staticMeshSlots: staticMeshBinding.inspection(),
      terrainLayers: summedTerrainLayerCounts([...terrainLayerCountsByChunk.values()]) }),
    dispose() { scene.onBeforeRenderObservable.remove(advance); binding.dispose(); staticMeshBinding.dispose(); },
  };
}

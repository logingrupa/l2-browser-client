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
import { loadTerrainMaterialsListing } from "../terrainLayerMaterials";
import { bindStaticMeshLibraryMaterials, type StaticMeshLibraryBinding, type StaticMeshLibraryInspection } from "./bindStaticMeshLibraryMaterials";
import { bindTerrainLayerMaterials, type TerrainLayerInspection } from "./bindTerrainLayerMaterials";
import { bindTileLighting, type TileLightingBinding, type TileLightingBspChunk, type TileLightingInspection } from "./bindTileLighting";
import type { TileLightingModel } from "./decodeTileLighting";
import { loadTileLighting } from "./loadTileLighting";
import { worldTimeOfDayFor } from "../worldTimeOfDay";

export interface TileLightingGapInspection {
  readonly gap: string;
}

export interface TileLightingRuntimeInspection extends TileLightingInspection {
  readonly cameraEnvironment: CameraEnvironment;
  readonly staticMeshSlots: StaticMeshLibraryInspection;
  readonly terrainLayers: TerrainLayerInspection;
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

function cameraEnvironmentOf(scene: Scene, model: TileLightingModel, cameraFrame: () => TileVisibilityFrame | null, hour: number): CameraEnvironment {
  const cameraPosition = scene.activeCamera?.globalPosition;
  const cameraSourcePosition = cameraPosition === undefined ? null : worldPositionToSource({ x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z });
  return computeCameraEnvironment({ frame: cameraFrame(), cameraSourcePosition, collision: null, records: model.records,
    environmentFogRanges: null, hour });
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
  const terrainMaterials = await loadTerrainMaterialsListing(manifest, signal);
  const presentationClock = createPresentationClock();
  let cameraEnvironment = cameraEnvironmentOf(scene, model, cameraFrame, timeOfDay.sample().hour);
  const advance = scene.onBeforeRenderObservable.add(() => {
    presentationClock.advance(scene.getEngine().getDeltaTime() / millisecondsPerSecond);
    cameraEnvironment = cameraEnvironmentOf(scene, model, cameraFrame, timeOfDay.sample().hour);
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
  const terrainLayerBinding = bindTerrainLayerMaterials({ scene, load: terrainMaterials, fog: () => cameraEnvironment.fog, loadProgram: loadNativeMaterial });
  return {
    materialUniforms, binding,
    async addChunk(surfaces) {
      if (surfaces.bspChunk !== null) await binding.addChunk(surfaces.bspChunk);
      await staticMeshBinding.addChunk(surfaces.chunkId, surfaces.staticMeshes);
      await terrainLayerBinding.addChunk(surfaces.chunkId, surfaces.terrainMeshes);
    },
    removeChunk(chunkId) {
      terrainLayerBinding.removeChunk(chunkId);
      binding.removeChunk(chunkId);
      staticMeshBinding.removeChunk(chunkId);
    },
    inspection: () => ({ ...binding.inspection(), cameraEnvironment, staticMeshSlots: staticMeshBinding.inspection(),
      terrainLayers: terrainLayerBinding.inspection() }),
    dispose() { scene.onBeforeRenderObservable.remove(advance); binding.dispose(); staticMeshBinding.dispose(); terrainLayerBinding.dispose(); },
  };
}

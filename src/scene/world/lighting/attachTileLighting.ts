import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { drawNativeSessionSeed } from "../../../assets/native/nativeSessionSeed";
import { nativeSunLightDirection } from "../../../environment/model/nativeSunLightDirection";
import { loadNativeMaterial, type NativeMaterialUniforms } from "../../../materials/ue2/babylon/material";
import { createPresentationClock } from "../../../shared/presentationClock";
import { worldPositionToSource } from "../../../world/sourceFrame";
import type { TileVisibilityFrame } from "../bspVisibility/core/tileVisibilityFrame";
import { computeCameraEnvironment, type CameraEnvironment, type CameraEnvironmentFog } from "../cameraEnvironment";
import { createCameraFogTransition, type CameraFogTransitionInspection } from "../cameraFogTransition";
import { fogReferencePawnFor, type FogReferencePawn } from "../fogReferencePawn";
import type { NativeTileManifest } from "../nativeTileManifest";
import { loadStaticMeshMaterialsListing } from "../staticMeshLibraryMaterials";
import { loadTerrainMaterialsListing } from "../terrainLayerMaterials";
import {
  bindStaticMeshLibraryMaterials, type StaticMeshHourlyLightingFrame, type StaticMeshLibraryBinding, type StaticMeshLibraryInspection, type StaticMeshPlacementSurfaces,
} from "./bindStaticMeshLibraryMaterials";
import { bindTerrainLayerMaterials, type TerrainLayerInspection } from "./bindTerrainLayerMaterials";
import { bindTerrainVertexLighting, type TerrainVertexLightingInspection } from "./bindTerrainVertexLighting";
import { bindTileLighting, type TileLightingBinding, type TileLightingBspChunk, type TileLightingInspection } from "./bindTileLighting";
import { hourlyLightingTerms, staticMeshInstanceAmbient, type HourlyLightingTerms } from "./hourlyLightingTerms";
import { loadStaticMeshVertexStreams } from "./loadStaticMeshVertexStreams";
import { bindStaticMeshHourlyVisibility, type StaticMeshHourlyVisibilityInspection } from "./staticMeshHourlyVisibility";
import { staticMeshOrdinaryLightRecords } from "./staticMeshOrdinaryLights";
import type { TileLightingModel } from "./decodeTileLighting";
import { loadTileLighting } from "./loadTileLighting";
import { createRebuiltLightmapWorkerComposer } from "./rebuiltLightmapWorkerProtocol";
import type { RebuildLightEnvironment } from "./rebuildShadowLights";
import type { TileLightingVisibility } from "./tileLightingVisibility";
import { worldTimeOfDayFor, type RunningWorldTimeOfDay } from "../worldTimeOfDay";

export interface TileLightingGapInspection {
  readonly gap: string;
}

export interface HourlyLightingInspection {
  readonly terms: HourlyLightingTerms;
  readonly terrain: TerrainVertexLightingInspection;
  readonly staticMeshVisibility: StaticMeshHourlyVisibilityInspection;
}

export interface TileLightingRuntimeInspection extends TileLightingInspection {
  readonly cameraEnvironment: CameraEnvironment;
  readonly fogTransition: CameraFogTransitionInspection;
  readonly staticMeshSlots: StaticMeshLibraryInspection;
  readonly terrainLayers: TerrainLayerInspection;
  readonly hourly: HourlyLightingInspection;
}

export interface TileLightingChunkSurfaces {
  readonly chunkId: string;
  readonly bspChunk: TileLightingBspChunk | null;
  readonly staticMeshPlacements: readonly StaticMeshPlacementSurfaces[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export interface AttachedTileLighting {
  readonly skyMaterialUniforms: (() => NativeMaterialUniforms) | null;
  readonly cameraFog: (() => CameraEnvironmentFog) | null;
  readonly binding: TileLightingBinding | null;
  addChunk(surfaces: TileLightingChunkSurfaces): Promise<void>;
  removeChunk(chunkId: string): void;
  inspection(): TileLightingRuntimeInspection | TileLightingGapInspection;
  dispose(): void;
}

const lightingResourceKind = "lighting";
const lightingResourceAbsentReason = "lighting-resource-absent";
const payloadInvalidReasonPrefix = "lighting-payload-invalid:";
const millisecondsPerSecond = 1000;

function unboundTileLighting(gap: string): AttachedTileLighting {
  return { skyMaterialUniforms: null, cameraFog: null, binding: null, addChunk: async () => {}, removeChunk() {}, inspection: () => ({ gap }), dispose() {} };
}

function startRebuiltLightmapWorker(): Worker {
  return new Worker(new URL("./rebuiltLightmapWorker.ts", import.meta.url), { type: "module" });
}

function rebuildLightEnvironment(timeOfDay: RunningWorldTimeOfDay, levelTimeSeconds: number): RebuildLightEnvironment {
  const snapshot = timeOfDay.manager.snapshot();
  return { hour: timeOfDay.manager.hour(), dayPart: snapshot.dayPart, celestialPhiDegrees: snapshot.celestialPhiDegrees, slopeSunAngle: snapshot.slopeSunAngleDegrees,
    frozen: { value: snapshot.frozen.value, verified: snapshot.frozen.status !== "unresolved" }, tables: timeOfDay.tables, blend: timeOfDay.manager.blend(), levelTimeSeconds };
}

function cameraEnvironmentOf(scene: Scene, model: TileLightingModel, frame: TileVisibilityFrame | null, timeOfDay: RunningWorldTimeOfDay,
  referencePawn: FogReferencePawn): CameraEnvironment {
  const cameraPosition = scene.activeCamera?.globalPosition;
  const cameraSourcePosition = cameraPosition === undefined ? null : worldPositionToSource({ x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z });
  const pawnPosition = referencePawn.position();
  return computeCameraEnvironment({ frame, cameraSourcePosition, referencePawnSourcePosition: pawnPosition === null ? null : worldPositionToSource(pawnPosition),
    collision: null, records: model.records,
    fogEnvironment: { hour: timeOfDay.sample().hour, fogRanges: timeOfDay.fogRanges, hazeColour: timeOfDay.hazeColour() } });
}

export async function attachTileLighting(scene: Scene, manifest: NativeTileManifest, visibility: TileLightingVisibility | null, signal: AbortSignal):
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
  const terrainVertexLighting = bindTerrainVertexLighting(model.hourly.terrainIntensityMaps, model.hourly.terrainLightMasks);
  const staticMeshVisibility = bindStaticMeshHourlyVisibility(model.hourly.staticMeshLightLists);
  const hourlyEnvironment = () => timeOfDay.hourlyEnvironmentLighting();
  const staticMeshHourlyLighting = (): StaticMeshHourlyLightingFrame => {
    const environment = hourlyEnvironment(), ambient = staticMeshInstanceAmbient(environment);
    if (ambient.status !== "resolved") return { status: "unresolved", reason: ambient.reason };
    if (environment.staticMeshLight.status !== "resolved") return { status: "unresolved", reason: environment.staticMeshLight.reason };
    const { dayPart, celestialPhiDegrees, slopeSunAngleDegrees } = timeOfDay.manager.snapshot();
    const sun = nativeSunLightDirection({ hour: environment.hour, dayPart, phiDegrees: celestialPhiDegrees, slopeSunAngleDegrees });
    return { status: "resolved", ambient: ambient.value, sun: { hour: environment.hour, lightDirection: sun.direction, staticSunPlane: environment.staticMeshLight.value },
      lightEnvironment: rebuildLightEnvironment(timeOfDay, presentationClock.levelSeconds) };
  };
  const referencePawn = fogReferencePawnFor(scene);
  const fogTransition = createCameraFogTransition(timeOfDay.fogSpeedSeconds);
  let cameraEnvironment = fogTransition.advance(cameraEnvironmentOf(scene, model, visibility?.frame() ?? null, timeOfDay, referencePawn), 0);
  const advance = scene.onBeforeRenderObservable.add(() => {
    const frameSeconds = scene.getEngine().getDeltaTime() / millisecondsPerSecond;
    presentationClock.advance(frameSeconds);
    cameraEnvironment = fogTransition.advance(cameraEnvironmentOf(scene, model, visibility?.frame() ?? null, timeOfDay, referencePawn), Math.fround(frameSeconds));
    const { lightingDirty } = timeOfDay.manager.snapshot();
    terrainVertexLighting.update(lightingDirty, hourlyEnvironment);
    staticMeshBinding.update(lightingDirty);
  });
  const sessionSeed = drawNativeSessionSeed();
  const materialUniforms = (): NativeMaterialUniforms => {
    const environment = timeOfDay.sample();
    return { levelSeconds: presentationClock.levelSeconds, hour: environment.hour, environmentType: environment.targetType, fog: cameraEnvironment.fog };
  };
  const skyMaterialUniforms = (): NativeMaterialUniforms => ({ ...materialUniforms(), fog: cameraEnvironment.skyFog.fog });
  const rebuiltLightmapComposer = createRebuiltLightmapWorkerComposer(startRebuiltLightmapWorker);
  const binding = bindTileLighting({ scene, model, sessionSeed, environment: () => timeOfDay.sample(),
    levelSeconds: () => presentationClock.levelSeconds, fog: () => cameraEnvironment.fog, visibility, loadProgram: loadNativeMaterial,
    rebuildEnvironment: () => rebuildLightEnvironment(timeOfDay, presentationClock.levelSeconds), composeRebuiltLightmap: rebuiltLightmapComposer.compose });
  const staticMeshBinding: StaticMeshLibraryBinding = bindStaticMeshLibraryMaterials({ scene, load: staticMeshMaterials, sessionSeed,
    uniforms: materialUniforms, loadProgram: loadNativeMaterial, lightLists: model.hourly.staticMeshLightLists,
    actorAmbients: model.hourly.staticMeshActorAmbients, ordinaryLightRecords: staticMeshOrdinaryLightRecords(model.hourly.lightActors), hourlyLighting: staticMeshHourlyLighting,
    loadVertexStreams: loadStaticMeshVertexStreams });
  const terrainLayerBinding = bindTerrainLayerMaterials({ scene, load: terrainMaterials, fog: () => cameraEnvironment.fog, loadProgram: loadNativeMaterial });
  const hourlyInspection = (): HourlyLightingInspection => {
    const environment = hourlyEnvironment();
    return { terms: hourlyLightingTerms(environment), terrain: terrainVertexLighting.inspection(), staticMeshVisibility: staticMeshVisibility.inspection(environment.hour) };
  };
  return {
    skyMaterialUniforms, cameraFog: () => cameraEnvironment, binding,
    async addChunk(surfaces) {
      if (surfaces.bspChunk !== null) await binding.addChunk(surfaces.bspChunk);
      await staticMeshBinding.addChunk(surfaces.chunkId, surfaces.staticMeshPlacements);
      await terrainLayerBinding.addChunk(surfaces.chunkId, surfaces.terrainMeshes);
      terrainVertexLighting.addChunk(surfaces.chunkId, surfaces.terrainMeshes, hourlyEnvironment);
      staticMeshVisibility.addChunk(surfaces.chunkId, surfaces.staticMeshPlacements.map(({ placement }) => ({ sourceActor: placement.sourceActor,
        exportIndex: placement.exportIndex })));
    },
    removeChunk(chunkId) {
      terrainLayerBinding.removeChunk(chunkId);
      binding.removeChunk(chunkId);
      staticMeshBinding.removeChunk(chunkId);
      terrainVertexLighting.removeChunk(chunkId);
      staticMeshVisibility.removeChunk(chunkId);
    },
    inspection: () => ({ ...binding.inspection(), cameraEnvironment, fogTransition: fogTransition.inspection(), staticMeshSlots: staticMeshBinding.inspection(),
      terrainLayers: terrainLayerBinding.inspection(), hourly: hourlyInspection() }),
    dispose() {
      scene.onBeforeRenderObservable.remove(advance);
      binding.dispose();
      rebuiltLightmapComposer.dispose();
      staticMeshBinding.dispose();
      terrainLayerBinding.dispose();
    },
  };
}

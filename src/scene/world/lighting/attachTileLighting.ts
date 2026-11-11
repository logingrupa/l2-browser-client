import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { drawNativeSessionSeed } from "../../../assets/native/nativeSessionSeed";
import { loadNativeMaterial } from "../../../materials/ue2/babylon/material";
import { createPresentationClock } from "../../../shared/presentationClock";
import { worldPositionToSource } from "../../../world/sourceFrame";
import type { TileVisibilityFrame } from "../bspVisibility/core/tileVisibilityFrame";
import { computeCameraEnvironment, type CameraEnvironment } from "../cameraEnvironment";
import type { NativeTileManifest } from "../nativeTileManifest";
import { bindTileLighting, type TileLightingBinding, type TileLightingBspChunk, type TileLightingInspection } from "./bindTileLighting";
import type { TileLightingModel } from "./decodeTileLighting";
import { loadTileLighting } from "./loadTileLighting";
import { readNativeMaterialProgramPin } from "../../../assets/native/nativeMaterialProgramPin";
import { createWorldEnvironmentClock, type WorldEnvironmentClock } from "./worldEnvironmentClock";

export interface TileLightingGapInspection {
  readonly gap: string;
}

export type UnlitSurfaceStatus = "program-unconverted" | "library-vertex-lighting-unported" | "library-terrain-layers-unported";

export interface TileLightingRuntimeInspection extends TileLightingInspection {
  readonly cameraEnvironment: CameraEnvironment;
  readonly staticMeshSlots: Readonly<Partial<Record<UnlitSurfaceStatus, number>>>;
  readonly terrainLayers: Readonly<Partial<Record<UnlitSurfaceStatus, number>>>;
}

export interface TileLightingSurfaces {
  readonly bspChunks: readonly TileLightingBspChunk[];
  readonly staticMeshes: readonly AbstractMesh[];
  readonly terrainMeshes: readonly AbstractMesh[];
  readonly cameraFrame: () => TileVisibilityFrame | null;
}

export interface AttachedTileLighting {
  readonly environmentClock: WorldEnvironmentClock | null;
  readonly binding: TileLightingBinding | null;
  inspection(): TileLightingRuntimeInspection | TileLightingGapInspection;
  dispose(): void;
}

const lightingResourceKind = "lighting";
export const lightingResourceAbsentReason = "lighting-resource-absent";
const payloadInvalidReasonPrefix = "lighting-payload-invalid:";
const millisecondsPerSecond = 1000;

function unboundTileLighting(gap: string): AttachedTileLighting {
  return { environmentClock: null, binding: null, inspection: () => ({ gap }), dispose() {} };
}

function unlitSurfaceCounts(meshes: readonly AbstractMesh[], programStatus: UnlitSurfaceStatus): Partial<Record<UnlitSurfaceStatus, number>> {
  const counts: Partial<Record<UnlitSurfaceStatus, number>> = {};
  for (const mesh of meshes) {
    const status = readNativeMaterialProgramPin(mesh.material) === null ? "program-unconverted" : programStatus;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function cameraEnvironmentOf(scene: Scene, model: TileLightingModel, cameraFrame: () => TileVisibilityFrame | null): CameraEnvironment {
  const cameraPosition = scene.activeCamera?.globalPosition;
  const cameraSourcePosition = cameraPosition === undefined ? null : worldPositionToSource({ x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z });
  return computeCameraEnvironment({ frame: cameraFrame(), cameraSourcePosition, collision: null, records: model.records });
}

export async function attachTileLighting(scene: Scene, manifest: NativeTileManifest, surfaces: TileLightingSurfaces, signal: AbortSignal): Promise<AttachedTileLighting> {
  const resource = manifest.resources.find(entry => entry.kind === lightingResourceKind);
  if (resource === undefined) return unboundTileLighting(lightingResourceAbsentReason);
  let model: TileLightingModel;
  try {
    model = await loadTileLighting(resource, signal);
  } catch (error) {
    signal.throwIfAborted();
    const name = error instanceof Error ? error.name : "Error", message = error instanceof Error ? error.message : String(error);
    return unboundTileLighting(`${payloadInvalidReasonPrefix}${name}: ${message}`);
  }
  const staticMeshSlots = unlitSurfaceCounts(surfaces.staticMeshes, "library-vertex-lighting-unported");
  const terrainLayers = unlitSurfaceCounts(surfaces.terrainMeshes, "library-terrain-layers-unported");
  const presentationClock = createPresentationClock();
  const environmentClock = createWorldEnvironmentClock({ program: model.records.environmentProgram, presentationClock });
  let cameraEnvironment = cameraEnvironmentOf(scene, model, surfaces.cameraFrame);
  const advance = scene.onBeforeRenderObservable.add(() => {
    presentationClock.advance(scene.getEngine().getDeltaTime() / millisecondsPerSecond);
    cameraEnvironment = cameraEnvironmentOf(scene, model, surfaces.cameraFrame);
  });
  try {
    const binding = await bindTileLighting({ scene, model, bspChunks: surfaces.bspChunks, sessionSeed: drawNativeSessionSeed(),
      environment: () => environmentClock.sample(), levelSeconds: () => presentationClock.levelSeconds, fog: () => cameraEnvironment.fog,
      loadProgram: loadNativeMaterial }, signal);
    return { environmentClock, binding, inspection: () => ({ ...binding.inspection(), cameraEnvironment, staticMeshSlots, terrainLayers }),
      dispose() { scene.onBeforeRenderObservable.remove(advance); binding.dispose(); } };
  } catch (error) {
    scene.onBeforeRenderObservable.remove(advance);
    throw error;
  }
}

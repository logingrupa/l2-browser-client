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

type UnlitSurfaceCounts = Partial<Record<UnlitSurfaceStatus, number>>;

export interface TileLightingRuntimeInspection extends TileLightingInspection {
  readonly cameraEnvironment: CameraEnvironment;
  readonly staticMeshSlots: Readonly<UnlitSurfaceCounts>;
  readonly terrainLayers: Readonly<UnlitSurfaceCounts>;
}

export interface TileLightingChunkSurfaces {
  readonly chunkId: string;
  readonly bspChunk: TileLightingBspChunk | null;
  readonly staticMeshes: readonly AbstractMesh[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export interface AttachedTileLighting {
  readonly environmentClock: WorldEnvironmentClock | null;
  readonly binding: TileLightingBinding | null;
  addChunk(surfaces: TileLightingChunkSurfaces): Promise<void>;
  removeChunk(chunkId: string): void;
  inspection(): TileLightingRuntimeInspection | TileLightingGapInspection;
  dispose(): void;
}

interface ChunkUnlitSurfaceCounts {
  readonly staticMeshSlots: UnlitSurfaceCounts;
  readonly terrainLayers: UnlitSurfaceCounts;
}

const lightingResourceKind = "lighting";
export const lightingResourceAbsentReason = "lighting-resource-absent";
const payloadInvalidReasonPrefix = "lighting-payload-invalid:";
const millisecondsPerSecond = 1000;

function unboundTileLighting(gap: string): AttachedTileLighting {
  return { environmentClock: null, binding: null, addChunk: async () => {}, removeChunk() {}, inspection: () => ({ gap }), dispose() {} };
}

function unlitSurfaceCounts(meshes: readonly AbstractMesh[], programStatus: UnlitSurfaceStatus): UnlitSurfaceCounts {
  const counts: UnlitSurfaceCounts = {};
  for (const mesh of meshes) {
    const status = readNativeMaterialProgramPin(mesh.material) === null ? "program-unconverted" : programStatus;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function summedSurfaceCounts(perChunk: readonly UnlitSurfaceCounts[]): UnlitSurfaceCounts {
  const sum: UnlitSurfaceCounts = {};
  for (const counts of perChunk) {
    for (const [status, count] of Object.entries(counts) as [UnlitSurfaceStatus, number][]) sum[status] = (sum[status] ?? 0) + count;
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
  let model: TileLightingModel;
  try {
    model = await loadTileLighting(resource, signal);
  } catch (error) {
    signal.throwIfAborted();
    const name = error instanceof Error ? error.name : "Error", message = error instanceof Error ? error.message : String(error);
    return unboundTileLighting(`${payloadInvalidReasonPrefix}${name}: ${message}`);
  }
  const presentationClock = createPresentationClock();
  const environmentClock = createWorldEnvironmentClock({ program: model.records.environmentProgram, presentationClock });
  let cameraEnvironment = cameraEnvironmentOf(scene, model, cameraFrame);
  const advance = scene.onBeforeRenderObservable.add(() => {
    presentationClock.advance(scene.getEngine().getDeltaTime() / millisecondsPerSecond);
    cameraEnvironment = cameraEnvironmentOf(scene, model, cameraFrame);
  });
  const binding = bindTileLighting({ scene, model, sessionSeed: drawNativeSessionSeed(), environment: () => environmentClock.sample(),
    levelSeconds: () => presentationClock.levelSeconds, fog: () => cameraEnvironment.fog, loadProgram: loadNativeMaterial });
  const surfaceCountsByChunk = new Map<string, ChunkUnlitSurfaceCounts>();
  return {
    environmentClock, binding,
    async addChunk(surfaces) {
      const counts: ChunkUnlitSurfaceCounts = { staticMeshSlots: unlitSurfaceCounts(surfaces.staticMeshes, "library-vertex-lighting-unported"),
        terrainLayers: unlitSurfaceCounts(surfaces.terrainMeshes, "library-terrain-layers-unported") };
      if (surfaces.bspChunk !== null) await binding.addChunk(surfaces.bspChunk);
      surfaceCountsByChunk.set(surfaces.chunkId, counts);
    },
    removeChunk(chunkId) {
      surfaceCountsByChunk.delete(chunkId);
      binding.removeChunk(chunkId);
    },
    inspection: () => {
      const counts = [...surfaceCountsByChunk.values()];
      return { ...binding.inspection(), cameraEnvironment, staticMeshSlots: summedSurfaceCounts(counts.map(entry => entry.staticMeshSlots)),
        terrainLayers: summedSurfaceCounts(counts.map(entry => entry.terrainLayers)) };
    },
    dispose() { scene.onBeforeRenderObservable.remove(advance); binding.dispose(); },
  };
}

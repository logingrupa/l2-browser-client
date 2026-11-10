import type { Scene } from "@babylonjs/core/scene";
import { drawNativeSessionSeed } from "../../../assets/native/nativeSessionSeed";
import { loadNativeMaterial, type FogState } from "../../../materials/ue2/babylon/material";
import { createPresentationClock } from "../../../shared/presentationClock";
import type { NativeTileManifest } from "../nativeTileManifest";
import { bindTileLighting, type TileLightingBinding, type TileLightingBspChunk, type TileLightingInspection } from "./bindTileLighting";
import type { TileLightingModel } from "./decodeTileLighting";
import { loadTileLighting } from "./loadTileLighting";
import { createWorldEnvironmentClock, type WorldEnvironmentClock } from "./worldEnvironmentClock";

export interface TileLightingGapInspection {
  readonly gap: string;
}

export interface AttachedTileLighting {
  readonly model: TileLightingModel | null;
  readonly environmentClock: WorldEnvironmentClock | null;
  readonly binding: TileLightingBinding | null;
  inspection(): TileLightingInspection | TileLightingGapInspection;
  dispose(): void;
}

const lightingResourceKind = "lighting";
export const lightingResourceAbsentReason = "lighting-resource-absent";
const payloadInvalidReasonPrefix = "lighting-payload-invalid:";
const millisecondsPerSecond = 1000;

function unboundTileLighting(gap: string): AttachedTileLighting {
  return { model: null, environmentClock: null, binding: null, inspection: () => ({ gap }), dispose() {} };
}

export async function attachTileLighting(scene: Scene, manifest: NativeTileManifest, bspChunks: readonly TileLightingBspChunk[], fog: () => FogState,
  signal: AbortSignal): Promise<AttachedTileLighting> {
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
  const advance = scene.onBeforeRenderObservable.add(() => presentationClock.advance(scene.getEngine().getDeltaTime() / millisecondsPerSecond));
  try {
    const binding = await bindTileLighting({ scene, model, bspChunks, sessionSeed: drawNativeSessionSeed(), environment: () => environmentClock.sample(),
      levelSeconds: () => presentationClock.levelSeconds, fog, loadProgram: loadNativeMaterial }, signal);
    return { model, environmentClock, binding, inspection: () => binding.inspection(),
      dispose() { scene.onBeforeRenderObservable.remove(advance); binding.dispose(); } };
  } catch (error) {
    scene.onBeforeRenderObservable.remove(advance);
    throw error;
  }
}

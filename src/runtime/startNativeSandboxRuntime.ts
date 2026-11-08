import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { createNativeSliceRuntime, type NativeSliceSettings } from "./createNativeSliceRuntime";
import type { NativeSandboxConfiguration } from "./nativeSandboxConfiguration";
import { catalogNativeSliceWorldSource } from "./nativeSliceWorldSource";
import { registerSceneStartup, reportSceneStartup, requireSceneStartup } from "../scene/prepareSceneForReveal";

function nativeSliceSettingsFromConfiguration(configuration: NativeSandboxConfiguration): NativeSliceSettings {
  return {
    playerProfileId: configuration.playerProfileId,
    origin: Vector3.FromArray(configuration.origin),
    leatherShirt: configuration.leatherShirt,
    fighterIdle: configuration.fighterIdle,
    fighterRun: configuration.fighterRun,
    fighterAttack: configuration.fighterAttack,
    fighterDeath: configuration.fighterDeath,
    materialOverrideEnabled: configuration.materialOverrideEnabled,
    materialEntityId: configuration.materialEntityId,
    materialSource: configuration.materialSource,
    materialTint: Vector3.FromArray(configuration.materialTint),
    materialRoughness: configuration.materialRoughness,
    flamePreviewEnabled: configuration.flamePreviewEnabled,
    flameTextureSeconds: configuration.flameTextureSeconds,
    flameFadeSeconds: configuration.flameFadeSeconds,
    flameTextureRate: configuration.flameTextureRate,
    flameFadeRate: configuration.flameFadeRate,
  };
}

export function startNativeSandboxRuntime(scene: Scene, camera: ArcRotateCamera, configuration: NativeSandboxConfiguration): void {
  requireSceneStartup(scene, "native-world");
  const lifetime = new AbortController();
  let stopRuntime: (() => void) | undefined;
  scene.onDisposeObservable.addOnce(() => {
    lifetime.abort();
    stopRuntime?.();
    stopRuntime = undefined;
  });
  const ready = createNativeSliceRuntime(scene, camera, nativeSliceSettingsFromConfiguration(configuration), lifetime.signal, {
    requireWorld: true,
    worldSource: catalogNativeSliceWorldSource,
    onProgress: progress => reportSceneStartup(scene, progress),
  }).then(stop => {
    if (lifetime.signal.aborted) {
      stop();
      throw new Error("Native scene startup was cancelled.");
    }
    stopRuntime = stop;
  });
  registerSceneStartup(scene, "native-world", ready);
}

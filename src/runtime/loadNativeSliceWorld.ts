import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { NativeSection } from "../scene/world/loadNativeSection";
import { loadNativeMovers, type NativeMovers } from "../scene/world/loadNativeMovers";
import { createWorldNavigation } from "../scene/navigation/meshNavigation";
import type { WorldNavigation } from "../world/WorldNavigation";
import { createNativeFlamePresentation, type NativeFlamePresentation } from "../scene/world/nativeFlamePresentation";
import { nativeFlameBrowserToNative } from "../scene/world/nativeFlameBillboards";
import { createNativeFlameReplayClock } from "../scene/world/nativeFlameReplayClock";
import type { NativeFlameReplayTime } from "../scene/world/nativeFlameMaterials";
import type { SceneStartupProgress } from "../scene/guardSceneStartup";
import { createNativeSkyPresentation, type NativeSkyPresentation } from "../scene/world/nativeSkyPresentation";
import type { NativeSliceWorldSource } from "./nativeSliceWorldSource";
import type { NativeSliceSettings } from "./createNativeSliceRuntime";
import { failureText } from "./settledTasks";

export type NativeFlameReplayClock = ReturnType<typeof createNativeFlameReplayClock>;

export class NativeSliceFlames {
  presentation: NativeFlamePresentation | undefined;
  failure: string | undefined;
  clock: NativeFlameReplayClock | undefined;

  constructor(private readonly camera: ArcRotateCamera) {}

  dispose(): void {
    this.presentation?.dispose();
    this.presentation = undefined;
  }

  update(time: NativeFlameReplayTime): void {
    if (!this.presentation) return;
    this.presentation.update(time, this.cameraPositionAsBillboardTarget());
    const state = this.presentation.inspect();
    if (state.status === "failed" || state.status === "aborted") throw new Error(state.failure ?? "Native flame preview ended unexpectedly.");
  }

  fail(error: unknown): void {
    this.dispose();
    this.failure = error instanceof Error ? error.message : "Native flame preview update failed.";
  }

  private cameraPositionAsBillboardTarget() {
    this.camera.getViewMatrix(true);
    const position = this.camera.globalPosition;
    return nativeFlameBrowserToNative([position.x, position.y, position.z]);
  }
}

export interface NativeSliceWorld {
  section: NativeSection | null;
  movers: NativeMovers | null;
  navigation: WorldNavigation | undefined;
  origin: Vector3;
  worldFailure: string | undefined;
  flames: NativeSliceFlames;
  sky: NativeSkyPresentation | null;
  skyFailure: string | null;
  release: () => void;
}

export interface NativeSliceWorldOptions {
  requireWorld: boolean;
  onProgress?: (progress: SceneStartupProgress) => void;
  validateLifetime: () => void;
  playerCapsule: () => { radius: number; height: number };
}


async function prepareFlames(scene: Scene, section: NativeSection, settings: NativeSliceSettings, flames: NativeSliceFlames,
  signal: AbortSignal, options: NativeSliceWorldOptions): Promise<void> {
  try {
    flames.clock = createNativeFlameReplayClock({ textureSeconds: settings.flameTextureSeconds ?? 0,
      fadeSeconds: settings.flameFadeSeconds ?? 0, textureRate: settings.flameTextureRate ?? 1, fadeRate: settings.flameFadeRate ?? 1 });
    flames.presentation = await createNativeFlamePresentation(scene, section, signal);
    options.validateLifetime();
    const prepared = flames.presentation.inspect();
    if (prepared.status === "failed" || prepared.status === "aborted") throw new Error(prepared.failure ?? "Native flame preview failed to prepare.");
    if (prepared.status === "not-present") { flames.dispose(); flames.clock = undefined; }
    else flames.update(flames.clock.advance(0, false));
  } catch (error) {
    flames.dispose();
    options.validateLifetime();
    if (options.requireWorld) throw error;
    flames.failure = failureText(error, "Native flame preview could not be verified.");
  }
}

export async function loadNativeSliceWorld(scene: Scene, camera: ArcRotateCamera, settings: NativeSliceSettings,
  worldSource: NativeSliceWorldSource, signal: AbortSignal, options: NativeSliceWorldOptions): Promise<NativeSliceWorld> {
  const releases: (() => void)[] = [];
  const release = () => { for (const releaseBoundary of releases.reverse()) releaseBoundary(); releases.length = 0; };
  const flames = new NativeSliceFlames(camera);
  const worldLifetime = new AbortController(), flameLifetime = new AbortController();
  const abortFlamesBeforeWorld = () => { flameLifetime.abort(); flames.dispose(); worldLifetime.abort(); };
  signal.addEventListener("abort", abortFlamesBeforeWorld, { once: true });
  const worldDisposeObserver = scene.onDisposeObservable.addOnce(abortFlamesBeforeWorld);
  releases.push(() => {
    signal.removeEventListener("abort", abortFlamesBeforeWorld); scene.onDisposeObservable.remove(worldDisposeObserver); abortFlamesBeforeWorld();
  });
  let section: NativeSection | null = null, movers: NativeMovers | null = null, navigation: WorldNavigation | undefined;
  let origin = settings.origin, worldFailure: string | undefined;
  let releaseWorldSource: (() => void) | undefined;
  try {
    try {
      options.onProgress?.({ stage: "assets", detail: "Preparing native terrain and scenery…" });
      const sourced = await worldSource(scene, camera, worldLifetime.signal);
      releaseWorldSource = sourced.release;
      releases.push(() => releaseWorldSource?.());
      section = sourced.section;
      if (!section && options.requireWorld) throw new Error("The native world section is unavailable. Reload to try again.");
      if (section) {
        releases.push(() => section?.dispose());
        options.validateLifetime();
        movers = await loadNativeMovers(scene, section.manifest.terrain.sha256, worldLifetime.signal);
        if (movers) releases.push(() => movers?.dispose());
        options.validateLifetime();
        if (options.requireWorld && section.inspection().materialFailure) throw new Error(`Native terrain materials failed: ${section.inspection().materialFailure}`);
        if (!section.spawnCandidate) throw new Error("The staged native section has no source-derived surface candidate.");
        const surfaceCandidateWithAuthoredOffset = section.spawnCandidate.add(settings.origin);
        navigation = createWorldNavigation({ terrainMeshes: section.terrainMeshes, obstacleMeshes: () => section?.supportMeshes ?? [],
          origin: surfaceCandidateWithAuthoredOffset, dynamicObstacleMeshes: () => movers?.collisionMeshes ?? [],
          capsule: options.playerCapsule() });
        const previewTriangleSupportedSpawn = navigation.spawn({ x: 0, y: 0, z: 0 });
        if (!previewTriangleSupportedSpawn) throw new Error("The staged native surface does not support the requested actor origin.");
        origin = new Vector3(previewTriangleSupportedSpawn.x, previewTriangleSupportedSpawn.y, previewTriangleSupportedSpawn.z);
        if (settings.flamePreviewEnabled !== false) {
          releases.push(() => flames.dispose());
          await prepareFlames(scene, section, settings, flames, flameLifetime.signal, options);
        }
      }
    } catch (error) {
      flameLifetime.abort();
      flames.dispose();
      movers?.dispose(); movers = null;
      section?.dispose(); section = null; navigation = undefined; origin = settings.origin;
      releaseWorldSource?.(); releaseWorldSource = undefined;
      options.validateLifetime();
      if (options.requireWorld) throw error;
      worldFailure = failureText(error, "Native world could not be verified.");
    }
    options.validateLifetime();
    let sky: NativeSkyPresentation | null = null, skyFailure: string | null = null;
    if (section) {
      try {
        options.onProgress?.({ stage: "assets", detail: "Preparing original sky geometry and textures…" });
        sky = await createNativeSkyPresentation(scene, worldLifetime.signal);
        if (sky) releases.push(() => sky?.dispose());
      } catch (error) {
        options.validateLifetime();
        skyFailure = failureText(error, "Original sky preview failed.");
      }
    }
    return { section, movers, navigation, origin, worldFailure, flames, sky, skyFailure, release };
  } catch (error) {
    release();
    throw error;
  }
}

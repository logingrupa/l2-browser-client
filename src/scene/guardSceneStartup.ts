import { Constants } from "@babylonjs/core/Engines/constants";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

export interface SceneStartupOptions {
  onStatus?: (message: string, progress?: SceneStartupProgress) => void;
  timeoutMs?: number;
}

export interface SceneStartupProgress {
  stage: "world" | "assets" | "graphics" | "enter";
  detail: string;
  /** Counts measure this step only; they are never an overall completion guess. */
  measurement?: { completed: number; total: number; label: string };
}

/** Editor 5.5.3 waits indefinitely for scene readiness. Babylon 9.27.1 leaves a
 * failed delayed mesh in LOADING after removing its pending-data entry. Detect
 * that terminal combination through public scene/mesh state; never declare the
 * missing geometry ready. The guarded progress callback also stops the Editor
 * continuation when its polling loop wakes after disposal. */
export async function guardSceneStartup(
  scene: Scene,
  load: (onProgress: (value: number) => void) => Promise<void>,
  options: SceneStartupOptions = {},
): Promise<void> {
  let failure: Error | undefined;
  let finished = false;
  let readingDescription = true;
  let lastStatus = "";
  let lastProgress = "";
  let descriptionFraction: number | undefined;
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  // The loader can throw synchronously from an initial progress callback before
  // Promise.race is attached. Keep that early failure observed as well.
  void failed.catch(() => undefined);
  const fail = (error: Error, disposeScene = true): void => {
    if (finished || failure) return;
    failure = error;
    rejectFailure(error);
    // Disposing aborts the scene's outstanding requests and breaks the Editor's
    // readiness loop. Its later progress callback must still reject, not start
    // scripts or accept a partially loaded scene.
    if (disposeScene && !scene.isDisposed) scene.dispose();
  };
  const report = (message: string, progress: SceneStartupProgress): void => {
    const serialized = JSON.stringify(progress);
    if (message !== lastStatus || serialized !== lastProgress) {
      lastStatus = message; lastProgress = serialized; options.onStatus?.(message, progress);
    }
  };
  const inspect = (): void => {
    if (finished || failure || scene.isDisposed) return;
    const pending = scene.getWaitingItemsCount();
    if (scene.textures.some(texture => texture.loadingError)) {
      fail(new Error("A world texture could not be loaded. Check your connection and reload to try again."));
      return;
    }
    const delayedGeometryPending = scene.meshes.some(mesh => mesh instanceof Mesh && mesh.delayLoadState === Constants.DELAYLOADSTATE_LOADING)
      || scene.geometries.some(geometry => geometry.delayLoadState === Constants.DELAYLOADSTATE_LOADING);
    if (pending === 0 && delayedGeometryPending) {
      fail(new Error("World geometry could not be loaded. Check your connection and reload to try again."));
      return;
    }
    if (readingDescription && scene.textures.length === 0 && scene.meshes.length === 0) {
      report("Loading world data…", {
        stage: "world", detail: descriptionFraction === undefined ? "Waiting for world data…" : "Downloading the world description…",
        ...(descriptionFraction === undefined ? {} : { measurement: { completed: descriptionFraction, total: 1, label: "World data downloaded" } }),
      });
    } else {
      const readyTextures = scene.textures.filter(texture => texture.isReady()).length;
      const delayedMeshes = scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && Boolean(mesh.delayLoadingFile));
      const delayedGeometries = scene.geometries.filter(geometry => geometry.delayLoadingFile);
      const total = scene.textures.length + delayedMeshes.length + delayedGeometries.length;
      const completed = readyTextures + delayedMeshes.filter(mesh => mesh.delayLoadState === Constants.DELAYLOADSTATE_LOADED).length
        + delayedGeometries.filter(geometry => geometry.delayLoadState === Constants.DELAYLOADSTATE_LOADED).length;
      const preparing = completed === total && pending === 0;
      const message = preparing ? "Preparing world graphics…" : scene.textures.length > 0
        ? `Loading world… ${readyTextures}/${scene.textures.length} textures ready · ${pending} resources pending`
        : `Loading world… ${pending} resources pending`;
      report(message, preparing ? { stage: "assets", detail: "Preparing the world’s scene resources…" } : {
        stage: "assets", detail: total > 0 ? `${completed} / ${total} scene items ready · ${pending} resources pending` : `${pending} resources pending`,
        ...(total > 0 ? { measurement: { completed, total, label: "Scene items ready" } } : {}),
      });
    }
  };
  const onProgress = (value: number): void => {
    if (failure) throw failure;
    if (scene.isDisposed) throw new Error("World loading was cancelled.");
    if (Number.isFinite(value) && value >= 0 && value <= 0.5) descriptionFraction = value * 2;
    if (Number.isFinite(value) && value >= 0.75) readingDescription = false;
    inspect();
    if (failure) throw failure;
  };
  const onDataLoaded = scene.onDataLoadedObservable.add(inspect);
  // Babylon sets isDisposed after notifying observers; external disposal must
  // not recursively invoke dispose from inside that notification.
  const onDisposed = scene.onDisposeObservable.add(() => fail(new Error("World loading was cancelled."), false));
  const engine = scene.getEngine();
  const onContextLost = engine.onContextLostObservable.add(() => fail(new Error(
    "The browser lost its graphics connection while loading. Reload to try again.",
  )));
  const polling = setInterval(inspect, 250);
  const timeout = setTimeout(() => fail(new Error(
    "World loading took too long. Check your connection and reload to try again.",
  )), options.timeoutMs ?? 180_000);
  try {
    report("Loading world data…", { stage: "world", detail: "Waiting for world data…" });
    // Call the loader immediately; its caller owns the scoped global Editor
    // loading flags for the complete asynchronous operation.
    const loading = load(onProgress);
    await Promise.race([loading, failed]);
    inspect();
    if (failure) throw failure;
    report("World files loaded…", { stage: "assets", detail: "World files loaded. Preparing characters and controls…" });
  } catch (error) {
    if (!scene.isDisposed) scene.dispose();
    throw error;
  } finally {
    finished = true;
    clearInterval(polling); clearTimeout(timeout);
    scene.onDataLoadedObservable.remove(onDataLoaded);
    scene.onDisposeObservable.remove(onDisposed);
    engine.onContextLostObservable.remove(onContextLost);
  }
}

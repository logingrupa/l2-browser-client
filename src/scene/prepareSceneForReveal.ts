import { Constants } from "@babylonjs/core/Engines/constants";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { SceneStartupProgress } from "./guardSceneStartup";

type Progress = (progress: SceneStartupProgress) => void;
interface Startup { required: Set<string>; tasks: Map<string, Promise<void>>; report?: Progress }
const startups = new WeakMap<Scene, Startup>();
function startup(scene: Scene): Startup {
  let value = startups.get(scene);
  if (!value) { value = { required: new Set(), tasks: new Map() }; startups.set(scene, value); }
  return value;
}

/** The app declares required runtimes before the Editor attaches its scripts. */
export function requireSceneStartup(scene: Scene, name: string): void { startup(scene).required.add(name); }
export function isSceneStartupRequired(scene: Scene, name: string): boolean { return startup(scene).required.has(name); }
export function reportSceneStartup(scene: Scene, progress: SceneStartupProgress): void { startup(scene).report?.(progress); }
export function registerSceneStartup(scene: Scene, name: string, ready: Promise<void>): void {
  startup(scene).tasks.set(name, ready);
  // A script may fail before the first render returns control to the app.
  void ready.catch(() => undefined);
}

/** Editor onStart runs on the first render, not when loadScene resolves. Render
 * concealed to activate scripts, await their actual asynchronous work, then
 * require a frame whose materials were ready both before and after drawing.
 * The host retains canvas dimensions and conceals the HUD until this resolves. */
export async function prepareSceneForReveal(
  scene: Scene,
  startRendering: (onError: (error: unknown) => void) => () => void,
  options: { onProgress?: Progress; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<number> {
  const state = startup(scene);
  if (options.onProgress) state.report = options.onProgress;
  let finished = false, failure: Error | undefined, stopRendering: (() => void) | undefined;
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  void failed.catch(() => undefined);
  const fail = (reason: unknown) => {
    if (finished || failure) return;
    failure = reason instanceof Error ? reason : new Error(String(reason));
    stopRendering?.(); rejectFailure(failure);
  };
  const cancelled = () => fail(new Error("World loading was cancelled."));
  const engine = scene.getEngine();
  const onDispose = scene.onDisposeObservable.add(cancelled);
  const onContextLost = engine.onContextLostObservable.add(() => fail(new Error(
    "The browser lost its graphics connection while loading. Reload to try again.",
  )));
  options.signal?.addEventListener("abort", cancelled, { once: true });
  const timeout = setTimeout(() => fail(new Error("World loading took too long. Check your connection and reload to try again.")), options.timeoutMs ?? 180_000);
  const inspect = () => {
    if (scene.isDisposed) { cancelled(); return false; }
    if (scene.textures.some(texture => texture.loadingError)) {
      fail(new Error("A world or character texture could not be loaded. Reload to try again.")); return false;
    }
    const pendingGeometry = [...scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh), ...scene.geometries]
      .some(item => item.delayLoadState === Constants.DELAYLOADSTATE_LOADING);
    if (pendingGeometry && scene.getWaitingItemsCount() === 0) {
      fail(new Error("World geometry could not be loaded. Reload to try again.")); return false;
    }
    return !pendingGeometry && scene.getWaitingItemsCount() === 0 && scene.textures.every(texture => texture.isReady()) && scene.isReady(true);
  };
  let firstRendered!: () => void;
  const firstFrame = new Promise<void>(resolve => { firstRendered = resolve; });
  const firstObserver = scene.onAfterRenderObservable.addOnce(() => firstRendered());
  let readyBeforeFrame = false, frameRendered!: (frame: number) => void;
  const readyFrame = new Promise<number>(resolve => { frameRendered = resolve; });
  let beforeFrame: ReturnType<typeof scene.onBeforeRenderObservable.add> | null = null;
  let afterFrame: ReturnType<typeof scene.onAfterRenderObservable.add> | null = null;
  try {
    if (options.signal?.aborted || scene.isDisposed) cancelled();
    if (failure) throw failure;
    options.onProgress?.({ stage: "assets", detail: "Starting the world’s asset loaders…" });
    stopRendering = startRendering(fail);
    await Promise.race([firstFrame, failed]);
    // Network and native assembly need no visible render loop. Avoid spending
    // every frame drawing the large partial world while downloads are pending.
    stopRendering();
    for (const name of state.required) {
      if (!state.tasks.has(name)) throw new Error(`The required ${name} scene script did not start. Reload to try again.`);
    }
    await Promise.race([Promise.all(state.tasks.values()), failed]);
    if (failure) throw failure;
    options.onProgress?.({ stage: "graphics", detail: "Preparing terrain, character materials and the first complete frame…" });
    // Register after runtime updates, so authored material overrides and camera
    // setup have run before deciding whether this frame can be the first shown.
    beforeFrame = scene.onBeforeRenderObservable.add(() => { readyBeforeFrame = inspect(); });
    afterFrame = scene.onAfterRenderObservable.add(() => {
      if (readyBeforeFrame && inspect()) frameRendered(scene.getFrameId());
    });
    stopRendering = startRendering(fail);
    const frame = await Promise.race([readyFrame, failed]);
    if (failure) throw failure;
    options.onProgress?.({ stage: "enter", detail: "World and characters ready. Entering…" });
    return frame;
  } catch (error) {
    stopRendering?.();
    if (!scene.isDisposed) scene.dispose();
    throw error;
  } finally {
    finished = true;
    delete state.report;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancelled);
    scene.onDisposeObservable.remove(onDispose); engine.onContextLostObservable.remove(onContextLost);
    scene.onBeforeRenderObservable.remove(beforeFrame);
    scene.onAfterRenderObservable.remove(firstObserver); scene.onAfterRenderObservable.remove(afterFrame);
  }
}

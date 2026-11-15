import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { prepareSceneForReveal, registerSceneStartup, requireSceneStartup } from "../../src/scene/prepareSceneForReveal";

const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
describe("complete scene reveal boundary", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => {
    engine = new NullEngine(); scene = new Scene(engine);
    new ArcRotateCamera("World camera", 0, 1, 4, Vector3.Zero(), scene);
  });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });
  function host() {
    const stop = vi.fn(), start = vi.fn((_onError: (reason: unknown) => void) => stop);
    return { start, stop, frame() { engine.beginFrame(); scene.render(); engine.endFrame(); } };
  }

  it("starts Editor scripts on a concealed frame, waits for runtime and materials, and completes a fully ready frame", async () => {
    const rendering = host();
    let finish!: () => void, revealed = false;
    const runtime = new Promise<void>(resolve => { finish = resolve; });
    requireSceneStartup(scene, "native-world");
    scene.onBeforeRenderObservable.addOnce(() => registerSceneStartup(scene, "native-world", runtime));
    const originalIsReady = scene.isReady.bind(scene);
    let materialsReady = true;
    vi.spyOn(scene, "isReady").mockImplementation(check => materialsReady && originalIsReady(check));
    const reports: string[] = [];
    const ready = prepareSceneForReveal(scene, rendering.start, { onProgress: report => reports.push(report.stage) }).then(frame => { revealed = true; return frame; });
    rendering.frame(); await settle();
    expect(rendering.stop).toHaveBeenCalledTimes(1);
    expect(rendering.start).toHaveBeenCalledTimes(1);
    expect(revealed).toBe(false);
    materialsReady = false; finish(); await settle();
    expect(rendering.start).toHaveBeenCalledTimes(2);
    rendering.frame(); await settle(); expect(revealed).toBe(false);
    materialsReady = true;
    expect(revealed).toBe(false);
    rendering.frame();
    expect(await ready).toBe(scene.getFrameId());
    expect(revealed).toBe(true); expect(reports).toEqual(["assets", "graphics", "enter"]);
    expect(rendering.stop).toHaveBeenCalledTimes(1); // final render loop remains live
    expect(engine.onContextLostObservable.hasObservers()).toBe(false);
  });

  it("does not accept a frame that becomes ready only after it began drawing", async () => {
    const rendering = host();
    let materialsReady = true, revealed = false;
    vi.spyOn(scene, "isReady").mockImplementation(() => materialsReady);
    const ready = prepareSceneForReveal(scene, rendering.start).then(frame => { revealed = true; return frame; });
    rendering.frame(); await settle();
    materialsReady = false;
    scene.onAfterRenderObservable.addOnce(() => { materialsReady = true; });
    rendering.frame(); await settle(); expect(revealed).toBe(false);
    rendering.frame(); await ready; expect(revealed).toBe(true);
  });

  it("rejects a missing required script instead of entering a world with no runtime", async () => {
    requireSceneStartup(scene, "native-world");
    const rendering = host(), ready = prepareSceneForReveal(scene, rendering.start);
    const failure = expect(ready).rejects.toThrow("required native-world scene script did not start");
    rendering.frame(); await failure; expect(scene.isDisposed).toBe(true);
  });

  it("propagates native assembly errors and stops the hidden render loop", async () => {
    const rendering = host();
    let reject!: (error: Error) => void;
    const runtime = new Promise<void>((_resolve, fail) => { reject = fail; });
    registerSceneStartup(scene, "native-world", runtime);
    const ready = prepareSceneForReveal(scene, rendering.start);
    const failure = expect(ready).rejects.toThrow("Initial equipment failed");
    rendering.frame(); await settle(); reject(new Error("Initial equipment failed")); await failure;
    expect(scene.isDisposed).toBe(true); expect(rendering.start).toHaveBeenCalledTimes(1);
  });

  it.each(["abort", "dispose", "context", "timeout"] as const)("settles a pending native runtime on %s and releases startup guards", async reason => {
    vi.useFakeTimers();
    const rendering = host(), controller = new AbortController();
    registerSceneStartup(scene, "native-world", new Promise<void>(() => undefined));
    const ready = prepareSceneForReveal(scene, rendering.start, { signal: controller.signal, timeoutMs: 50 });
    const failure = expect(ready).rejects.toThrow(reason === "context" ? "graphics connection" : reason === "timeout" ? "took too long" : "cancelled");
    rendering.frame(); await settle();
    if (reason === "abort") controller.abort();
    else if (reason === "dispose") scene.dispose();
    else if (reason === "context") engine.onContextLostObservable.notifyObservers(engine);
    else await vi.advanceTimersByTimeAsync(50);
    await failure;
    expect(scene.isDisposed).toBe(true);
    expect(engine.onContextLostObservable.hasObservers()).toBe(false);
    await vi.runOnlyPendingTimersAsync(); // Babylon defers removal of inactive observers.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a late character texture error instead of treating tolerated material readiness as success", async () => {
    const rendering = host(), ready = prepareSceneForReveal(scene, rendering.start);
    const failure = expect(ready).rejects.toThrow("world or character texture could not be loaded");
    rendering.frame(); await settle();
    const texture = new BaseTexture(scene); Object.defineProperty(texture, "loadingError", { value: { message: "HTTP 502" } });
    rendering.frame(); await failure; expect(scene.isDisposed).toBe(true);
  });

  it("reports rendering exceptions through the startup error boundary", async () => {
    const rendering = host(), ready = prepareSceneForReveal(scene, rendering.start);
    const failure = expect(ready).rejects.toThrow("Shader compilation failed");
    rendering.start.mock.calls[0]![0](new Error("Shader compilation failed"));
    await failure; expect(scene.isDisposed).toBe(true); expect(rendering.stop).toHaveBeenCalled();
  });
});

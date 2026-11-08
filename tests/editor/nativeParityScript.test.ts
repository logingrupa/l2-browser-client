import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { applyScriptOnObject } from "babylonjs-editor-tools";
import type { createNativeSliceRuntime } from "../../src/runtime/createNativeSliceRuntime";
import NativeParityScript from "../../src/scripts/nativeParity";
import { nativeSandboxConfiguration } from "../../src/runtime/nativeSandboxConfiguration";
import { authoredNativeWorldSource } from "../../src/editor/authoredNativeWorldSource";

const runtime = vi.hoisted(() => ({ start: vi.fn<typeof createNativeSliceRuntime>(), showError: vi.fn(),
  required: vi.fn(), register: vi.fn(), report: vi.fn() }));
vi.mock("../../src/runtime/createNativeSliceRuntime", () => ({ createNativeSliceRuntime: runtime.start }));
vi.mock("../../src/ui/LoadingScreen", () => ({ showLoadingError: runtime.showError }));
vi.mock("../../src/scene/prepareSceneForReveal", () => ({
  isSceneStartupRequired: runtime.required, registerSceneStartup: runtime.register, reportSceneStartup: runtime.report,
}));

function pendingRuntime() {
  let resolve!: (stop: () => void) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<() => void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }

describe("native Editor script lifetime", () => {
  let engine: NullEngine, scene: Scene, script: NativeParityScript;

  beforeEach(() => {
    runtime.start.mockReset();
    runtime.showError.mockReset(); runtime.required.mockReset().mockReturnValue(false);
    runtime.register.mockReset(); runtime.report.mockReset();
    engine = new NullEngine(); scene = new Scene(engine); script = new NativeParityScript(scene);
    new ArcRotateCamera("World camera", 0, 1, 5, Vector3.Zero(), scene);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    script.onStop(); scene.dispose(); engine.dispose();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("takes every field default from the typed native sandbox configuration", () => {
    const { statusLabel: _statusLabel, source: _source, origin, materialTint, ...scalarSettings } = nativeSandboxConfiguration;
    expect(script).toMatchObject(scalarSettings);
    expect(script.origin.asArray()).toEqual(origin);
    expect(script.materialTint.asArray()).toEqual(materialTint);
  });

  it("starts once through the pinned Editor loader and stops when the scene is disposed", async () => {
    const stop = vi.fn(); runtime.start.mockResolvedValue(stop);
    script = applyScriptOnObject(scene, NativeParityScript, scene) as NativeParityScript;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    await settle();
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(scene.useRightHandedSystem).toBe(true);
    const [, camera, , , options] = runtime.start.mock.calls[0]!;
    expect(camera).toBe(scene.getCameraByName("World camera"));
    expect(options?.worldSource).toBe(authoredNativeWorldSource);
    const signal = runtime.start.mock.calls[0]![3];
    expect(signal.aborted).toBe(false);
    scene.dispose();
    expect(signal.aborted).toBe(true); expect(stop).toHaveBeenCalledTimes(1);
  });

  it("can restart the same instance with a fresh lifetime and updated authored settings", async () => {
    const firstStop = vi.fn(), secondStop = vi.fn();
    runtime.start.mockResolvedValueOnce(firstStop).mockResolvedValueOnce(secondStop);
    script.onStop(); script.onStart(); await settle();
    const firstSignal = runtime.start.mock.calls[0]![3];
    script.onStop(); script.onStop();
    expect(firstSignal.aborted).toBe(true); expect(firstStop).toHaveBeenCalledTimes(1);
    script.leatherShirt = true; script.materialEntityId = "native-musveren";
    script.onStart(); await settle();
    const [, , settings, secondSignal] = runtime.start.mock.calls[1]!;
    expect(secondSignal).not.toBe(firstSignal); expect(secondSignal.aborted).toBe(false);
    expect(settings.leatherShirt).toBe(true); expect(settings.materialEntityId).toBe("native-musveren");
    script.onStop(); expect(secondStop).toHaveBeenCalledTimes(1);
  });

  it("refuses to start an authored scene without its World camera", () => {
    scene.getCameraByName("World camera")!.dispose();
    expect(() => script.onStart()).toThrow("The authored native scene has no World camera.");
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("passes explicit default flame replay settings through the Editor script boundary", async () => {
    runtime.start.mockResolvedValue(vi.fn()); script.onStart(); await settle();
    expect(runtime.start.mock.calls[0]![2]).toMatchObject({ flamePreviewEnabled: true,
      flameTextureSeconds: 0, flameFadeSeconds: 0, flameTextureRate: 1, flameFadeRate: 1 });
  });

  it.each([true, false])("forwards authored flame enable=%s and independent replay settings across restart", async enabled => {
    const firstStop = vi.fn(), secondStop = vi.fn(); runtime.start.mockResolvedValueOnce(firstStop).mockResolvedValueOnce(secondStop);
    script.onStart(); await settle(); const firstSignal = runtime.start.mock.calls[0]![3]; script.onStop();
    script.flamePreviewEnabled = enabled; script.flameTextureSeconds = 12.25; script.flameFadeSeconds = 0.6;
    script.flameTextureRate = 2; script.flameFadeRate = 0;
    script.onStart(); await settle();
    const [, , settings, nextSignal] = runtime.start.mock.calls[1]!;
    expect(settings).toMatchObject({ flamePreviewEnabled: enabled, flameTextureSeconds: 12.25, flameFadeSeconds: 0.6, flameTextureRate: 2, flameFadeRate: 0 });
    expect(firstSignal.aborted).toBe(true); expect(nextSignal.aborted).toBe(false); expect(nextSignal).not.toBe(firstSignal);
    expect(firstStop).toHaveBeenCalledTimes(1); script.onStop(); expect(secondStop).toHaveBeenCalledTimes(1);
  });

  it("releases a runtime whose startup completes after stop", async () => {
    const pending = pendingRuntime(), stop = vi.fn(); runtime.start.mockReturnValue(pending.promise);
    script.onStart(); script.onStop(); pending.resolve(stop); await settle();
    expect(stop).toHaveBeenCalledTimes(1); expect(console.error).not.toHaveBeenCalled();
    script.onStop(); expect(stop).toHaveBeenCalledTimes(1);
  });

  it("cancels a replaced start without allowing its late completion to replace the active cleanup", async () => {
    const first = pendingRuntime(), second = pendingRuntime(), firstStop = vi.fn(), secondStop = vi.fn();
    runtime.start.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    script.onStart(); const firstSignal = runtime.start.mock.calls[0]![3];
    script.onStart(); const secondSignal = runtime.start.mock.calls[1]![3];
    expect(firstSignal.aborted).toBe(true); expect(secondSignal.aborted).toBe(false);
    second.resolve(secondStop); await settle();
    first.resolve(firstStop); await settle();
    expect(firstStop).toHaveBeenCalledTimes(1); expect(secondStop).not.toHaveBeenCalled();
    script.onStop();
    expect(secondStop).toHaveBeenCalledTimes(1); expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondSignal.aborted).toBe(true);
  });

  it("ignores a stopped startup failure while reporting a current startup failure", async () => {
    const first = pendingRuntime(), second = pendingRuntime();
    runtime.start.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    script.onStart(); script.onStop(); script.onStart();
    first.reject(new Error("Previous load failed")); await settle();
    expect(console.error).not.toHaveBeenCalled(); expect(runtime.showError).not.toHaveBeenCalled();
    const currentError = new Error("Current load failed"); second.reject(currentError); await settle();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(currentError);
    expect(runtime.showError).toHaveBeenCalledExactlyOnceWith(currentError);
  });

  it("registers pending native assembly and forwards its real progress to the reveal owner", async () => {
    const pending = pendingRuntime(), stop = vi.fn(); runtime.start.mockReturnValue(pending.promise);
    script.onStart();
    expect(runtime.register).toHaveBeenCalledExactlyOnceWith(scene, "native-world", expect.any(Promise));
    const ready = runtime.register.mock.calls[0]![2] as Promise<void>, completed = vi.fn(); void ready.then(completed);
    const options = runtime.start.mock.calls[0]![4]!;
    expect(options.requireWorld).toBe(false);
    const progress = { stage: "assets", detail: "Assembling native equipment" } as const;
    options.onProgress!(progress); expect(runtime.report).toHaveBeenCalledExactlyOnceWith(scene, progress);
    await settle(); expect(completed).not.toHaveBeenCalled();
    pending.resolve(stop); await ready; expect(completed).toHaveBeenCalledOnce();
    script.onStop(); expect(stop).toHaveBeenCalledOnce();
  });

  it("passes the browser's strict world requirement and leaves its failure UI to the app", async () => {
    runtime.required.mockReturnValue(true);
    const pending = pendingRuntime(); runtime.start.mockReturnValue(pending.promise); script.onStart();
    expect(runtime.required).toHaveBeenCalledWith(scene, "native-world");
    expect(runtime.start.mock.calls[0]![4]!.requireWorld).toBe(true);
    const ready = runtime.register.mock.calls[0]![2] as Promise<void>, failure = new Error("Terrain could not load");
    pending.reject(failure); await expect(ready).rejects.toBe(failure); await settle();
    expect(runtime.showError).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
  });
});

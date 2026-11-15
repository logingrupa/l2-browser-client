import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Observable } from "@babylonjs/core/Misc/observable";

interface Installation { ready: Promise<number>; close(): void; }
const { installCompilerCompatibility } = createRequire(import.meta.url)("../../tools/editor-webgpu-compat/index.cjs") as {
  installCompilerCompatibility(engineClass: typeof WebGPUEngine, engines: EngineProbe[], timeoutMs?: number): Installation;
};
interface EngineProbe {
  isWebGPU: boolean;
  _isDisposed: boolean;
  _options: { glslangOptions: { glslang: unknown }; twgslOptions: { twgsl: unknown } };
  _creationOptions: EngineProbe["_options"];
  _workingGlslangAndTintPromise: Promise<void> | null;
  _glslangAndTintAreFullyLoaded: boolean;
  _compiledEffects: Record<string, ReturnType<typeof effectProbe>>;
  prepareGlslangAndTintAsync(): Promise<void>;
}

/** Use Babylon's real initializer/preparation methods; bypass only construction
 * of GPU resources. This reproduces the installed version's actual TypeError. */
function engineProbe(): EngineProbe {
  const engine = Object.create(WebGPUEngine.prototype) as EngineProbe;
  Object.defineProperty(engine, "isWebGPU", { value: true });
  engine._isDisposed = false;
  engine._options = {
    glslangOptions: { glslang: { compileGLSL: vi.fn(), compileGLSLZeroCopy: vi.fn() } },
    twgslOptions: { twgsl: { convertSpirV2WGSL: vi.fn() } },
  };
  engine._creationOptions = engine._options;
  engine._workingGlslangAndTintPromise = null;
  engine._glslangAndTintAreFullyLoaded = false;
  engine._compiledEffects = {};
  return engine;
}

function effectProbe() {
  const effect = {
    isDisposed: false, _shaderLanguage: 0, _isReady: false, _pipelineContext: {},
    _vertexSourceCode: "retained vertex source", _fragmentSourceCode: "retained fragment source",
    onCompileObservable: new Observable<unknown>(), onErrorObservable: new Observable<unknown>(),
    getCompilationError: () => "Shader compilation failed",
    _prepareEffect: vi.fn(),
  };
  effect._prepareEffect.mockImplementation(() => {
    effect._isReady = true;
    effect.onCompileObservable.notifyObservers(effect);
  });
  return effect;
}

const installations: Installation[] = [];
function install(engines: EngineProbe[], timeout?: number): Installation {
  const installation = installCompilerCompatibility(WebGPUEngine, engines, timeout);
  installations.push(installation);
  return installation;
}
afterEach(() => { installations.splice(0).reverse().forEach(value => value.close()); vi.useRealTimers(); });

describe("Editor 5.5.3 WebGPU compiler compatibility", () => {
  it("accepts Editor raw compiler objects for current and future engines without replacing options", async () => {
    const engine = engineProbe(), options = engine._options, compiler = options.glslangOptions.glslang;
    const original = Reflect.get(WebGPUEngine.prototype, "_initGlslangAsync");
    const installation = install([engine]);
    await expect(installation.ready).resolves.toBe(0);
    expect(engine._glslangAndTintAreFullyLoaded).toBe(true);
    expect(engine._options).toBe(options);
    expect(options.glslangOptions.glslang).toBe(compiler);
    const future = engineProbe();
    await future.prepareGlslangAndTintAsync();
    expect(future._glslangAndTintAreFullyLoaded).toBe(true);
    installation.close();
    expect(Reflect.get(WebGPUEngine.prototype, "_initGlslangAsync")).toBe(original);
  });

  it("recovers the actual cached raw-option failure and retains effect identity and existing callbacks", async () => {
    const engine = engineProbe(), stalled = effectProbe(), ready = effectProbe(), wgsl = effectProbe(), pendingSource = effectProbe();
    ready._isReady = true; wgsl._shaderLanguage = 1; pendingSource._vertexSourceCode = "";
    engine._compiledEffects = { stalled, ready, wgsl, pendingSource };
    const existingObserver = vi.fn();
    stalled.onCompileObservable.add(existingObserver);
    await expect(engine.prepareGlslangAndTintAsync()).rejects.toThrow(/_initGlslangAsync.*then is not a function/);
    const failedPromise = engine._workingGlslangAndTintPromise;
    await expect(install([engine]).ready).resolves.toBe(1);
    expect(engine._workingGlslangAndTintPromise).not.toBe(failedPromise);
    expect(engine._compiledEffects.stalled).toBe(stalled);
    expect(stalled._prepareEffect).toHaveBeenCalledOnce();
    expect(existingObserver).toHaveBeenCalledOnce();
    expect(stalled._vertexSourceCode).toBe("retained vertex source");
    expect(stalled._fragmentSourceCode).toBe("retained fragment source");
    for (const other of [ready, wgsl, pendingSource]) expect(other._prepareEffect).not.toHaveBeenCalled();
  });

  it("retains and reports unrelated preparation failures instead of clearing their cached promise", async () => {
    const engine = engineProbe(), failure = new Error("Compiler download failed");
    const rejected = Promise.reject(failure);
    engine._workingGlslangAndTintPromise = rejected;
    await expect(install([engine]).ready).rejects.toBe(failure);
    expect(engine._workingGlslangAndTintPromise).toBe(rejected);
  });

  it("reports a shader retry failure and removes only its own observers", async () => {
    const engine = engineProbe(), stalled = effectProbe(), existingObserver = vi.fn();
    stalled.onCompileObservable.add(existingObserver);
    stalled._prepareEffect.mockImplementation(() => stalled.onErrorObservable.notifyObservers(stalled));
    engine._compiledEffects = { stalled };
    await expect(engine.prepareGlslangAndTintAsync()).rejects.toThrow(/then is not a function/);
    await expect(install([engine]).ready).rejects.toThrow("GLSL retry failed: Shader compilation failed");
    // Babylon defers removal while an observable is notifying its listeners.
    expect(stalled.onCompileObservable.observers.filter(observer => !observer._willBeUnregistered)).toHaveLength(1);
    expect(stalled.onErrorObservable.hasObservers()).toBe(false);
    expect(existingObserver).not.toHaveBeenCalled();
  });

  it("bounds a stalled retry and preserves shader errors for diagnosis", async () => {
    vi.useFakeTimers();
    const engine = engineProbe(), stalled = effectProbe();
    stalled._prepareEffect.mockImplementation(() => undefined);
    engine._compiledEffects = { stalled };
    await expect(engine.prepareGlslangAndTintAsync()).rejects.toThrow(/then is not a function/);
    const rejection = expect(install([engine], 20).ready).rejects.toThrow("GLSL effect retry timed out");
    await vi.advanceTimersByTimeAsync(21);
    await rejection;
    expect(stalled.onCompileObservable.hasObservers()).toBe(false);
    expect(stalled.onErrorObservable.hasObservers()).toBe(false);
    expect(engine._compiledEffects.stalled).toBe(stalled);
  });

  it("does not clear another preparation failure merely because its message matches", async () => {
    const engine = engineProbe(), failure = new TypeError("this._initGlslangAsync(...).then is not a function");
    engine._options.glslangOptions.glslang = Promise.resolve(engine._options.glslangOptions.glslang);
    const rejected = Promise.reject(failure);
    engine._workingGlslangAndTintPromise = rejected;
    await expect(install([engine]).ready).rejects.toBe(failure);
    expect(engine._workingGlslangAndTintPromise).toBe(rejected);
  });

  it("skips disposed engines without touching their cached preparation", async () => {
    const engine = engineProbe();
    engine._isDisposed = true;
    await expect(install([engine]).ready).resolves.toBe(0);
    expect(engine._workingGlslangAndTintPromise).toBeNull();
  });

  it("refuses a different engine version before changing its initializer", () => {
    class DifferentEngine extends WebGPUEngine { static override get Version(): string { return "10.0.0"; } }
    const original = Reflect.get(DifferentEngine.prototype, "_initGlslangAsync");
    expect(() => installCompilerCompatibility(DifferentEngine, [])).toThrow("requires Babylon 9.27.1");
    expect(Reflect.get(DifferentEngine.prototype, "_initGlslangAsync")).toBe(original);
  });
});

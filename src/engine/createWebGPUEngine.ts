import { WebGPUEngine, type WebGPUEngineOptions } from "@babylonjs/core/Engines/webgpuEngine";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { _CommonDispose } from "@babylonjs/core/Engines/engine.common";
import { Tools } from "@babylonjs/core/Misc/tools";

const compilerRoot = "/vendor/babylon/9.27.1";
const requestedWebGpuDeviceFeatures: readonly GPUFeatureName[] = ["texture-compression-bc"];
type CompilerFactory = (wasmPath: string) => Promise<unknown>;
const compilerGlobals = globalThis as typeof globalThis & { glslang?: CompilerFactory; twgsl?: CompilerFactory };
let compilers: Promise<{ glslang: unknown; twgsl: unknown }> | undefined;

class ReloadOnDeviceLossEngine extends WebGPUEngine {
  protected override _restoreEngineAfterContextLost(): void {}
}

function loadCompilers(): Promise<{ glslang: unknown; twgsl: unknown }> {
  return compilers ??= (async () => {
    for (const engine of EngineStore.Instances) {
      if (!engine.isWebGPU) continue;
      const options = engine.getCreationOptions() as WebGPUEngineOptions;
      if (options.glslangOptions?.glslang && options.twgslOptions?.twgsl) {
        return { glslang: options.glslangOptions.glslang, twgsl: options.twgslOptions.twgsl };
      }
    }
    if (!compilerGlobals.glslang) await Tools.LoadScriptAsync(`${compilerRoot}/glslang.js`);
    if (!compilerGlobals.glslang) throw new Error("WebGPU GLSL compiler could not be loaded.");
    const glslang = await compilerGlobals.glslang(`${compilerRoot}/glslang.wasm`);
    if (!compilerGlobals.twgsl) await Tools.LoadScriptAsync(`${compilerRoot}/twgsl.js`);
    if (!compilerGlobals.twgsl) throw new Error("WebGPU WGSL compiler could not be loaded.");
    const twgsl = await compilerGlobals.twgsl(`${compilerRoot}/twgsl.wasm`);
    return { glslang, twgsl };
  })();
}

async function readyCompilers(): ReturnType<typeof loadCompilers> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([loadCompilers(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("WebGPU shader loading timed out. Reload to try again.")), 30_000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function createWebGPUEngine(canvas: HTMLCanvasElement, options: { reloadOnDeviceLoss?: boolean } = {}): Promise<WebGPUEngine> {
  if (!await WebGPUEngine.IsSupportedAsync) {
    throw new Error("WebGPU is required. Use a browser with WebGPU and hardware acceleration enabled, over HTTPS or localhost.");
  }
  const { glslang, twgsl } = await readyCompilers();
  const Engine = options.reloadOnDeviceLoss ? ReloadOnDeviceLossEngine : WebGPUEngine;
  const engine = new Engine(canvas, {
    antialias: true, stencil: true, powerPreference: "high-performance", useLargeWorldRendering: true,
    deviceDescriptor: { requiredFeatures: [...requestedWebGpuDeviceFeatures] },
    glslangOptions: { glslang: Promise.resolve(glslang) }, twgslOptions: { twgsl },
  });
  try {
    await engine.initAsync();
    await engine.prepareGlslangAndTintAsync();
    canvas.dataset.engine = engine.name;
    return engine;
  } catch (cause) {
    try { engine.dispose(); }
    catch {
      engine._device?.destroy();
      _CommonDispose(engine, canvas);
      AbstractEngine.prototype.dispose.call(engine);
    }
    throw new Error("WebGPU graphics could not be initialized. Check hardware acceleration and reload to try again.", { cause });
  }
}

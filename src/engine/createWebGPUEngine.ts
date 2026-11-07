import { WebGPUEngine, type WebGPUEngineOptions } from "@babylonjs/core/Engines/webgpuEngine";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { _CommonDispose } from "@babylonjs/core/Engines/engine.common";
import { Tools } from "@babylonjs/core/Misc/tools";

const compilerRoot = "/vendor/babylon/9.27.1";
type CompilerFactory = (wasmPath: string) => Promise<unknown>;
const compilerGlobals = globalThis as typeof globalThis & { glslang?: CompilerFactory; twgsl?: CompilerFactory };
let compilers: Promise<{ glslang: unknown; twgsl: unknown }> | undefined;

class ReloadOnDeviceLossEngine extends WebGPUEngine {
  protected override _restoreEngineAfterContextLost(): void {
    // The world aborts loading/rendering and offers Reload on device loss.
    // Babylon 9.27 otherwise schedules an async restore after App has disposed
    // the canvas, producing an unhandled rejection and recreating GPU resources.
  }
}

function loadCompilers(): Promise<{ glslang: unknown; twgsl: unknown }> {
  return compilers ??= (async () => {
    // Editor Play already initializes these objects using its bundled files.
    // Reuse them for the asset inspector without resolving /vendor under file:.
    for (const engine of EngineStore.Instances) {
      if (!engine.isWebGPU) continue;
      const options = engine.getCreationOptions() as WebGPUEngineOptions;
      if (options.glslangOptions?.glslang && options.twgslOptions?.twgsl) {
        return { glslang: options.glslangOptions.glslang, twgsl: options.twgslOptions.twgsl };
      }
    }
    // Browser builds serve the pinned Babylon package's JS/WASM locally,
    // including in private previews.
    // Both classic scripts declare global Module. Initialize each factory
    // before the next script replaces that global, matching Babylon's loader.
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

/** WebGPU is required throughout the client; unsupported devices get the
 * existing startup error panel instead of silently switching renderers. */
export async function createWebGPUEngine(canvas: HTMLCanvasElement, options: { reloadOnDeviceLoss?: boolean } = {}): Promise<WebGPUEngine> {
  if (!await WebGPUEngine.IsSupportedAsync) {
    throw new Error("WebGPU is required. Use a browser with WebGPU and hardware acceleration enabled, over HTTPS or localhost.");
  }
  const { glslang, twgsl } = await readyCompilers();
  const Engine = options.reloadOnDeviceLoss ? ReloadOnDeviceLossEngine : WebGPUEngine;
  const engine = new Engine(canvas, {
    antialias: true, stencil: true, powerPreference: "high-performance", useLargeWorldRendering: true,
    // _initGlslangAsync returns this option directly; Babylon expects a promise.
    glslangOptions: { glslang: Promise.resolve(glslang) }, twgslOptions: { twgsl },
  });
  try {
    await engine.initAsync();
    // Supply initialized compilers before any custom GLSL material is parsed.
    // Babylon 9.27's lazy compiler loader does not propagate download failures.
    await engine.prepareGlslangAndTintAsync();
    canvas.dataset.engine = engine.name;
    return engine;
  } catch (cause) {
    try { engine.dispose(); }
    catch {
      // Babylon 9.27 dispose assumes init reached its timestamp-query setup.
      // A rejected requestDevice must still remove the partial EngineStore entry.
      engine._device?.destroy();
      _CommonDispose(engine, canvas);
      AbstractEngine.prototype.dispose.call(engine);
    }
    throw new Error("WebGPU graphics could not be initialized. Check hardware acceleration and reload to try again.", { cause });
  }
}

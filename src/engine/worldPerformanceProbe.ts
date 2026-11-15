import type { Scene } from "@babylonjs/core/scene";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { Observable } from "@babylonjs/core/Misc/observable";

const MAX_SAMPLES = 40_000;
const NS_PER_MS = 1_000_000;
type Distribution = { count: number; minimum: number | null; median: number | null; p95: number | null; maximum: number | null; mean: number | null };
type GpuBatch = { observedAtMs: number; completedFrames: number; totalMs: number };

function distribution(values: readonly number[]): Distribution {
  if (!values.length) return { count: 0, minimum: null, median: null, p95: null, maximum: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, minimum: sorted[0]!, median: sorted[Math.ceil(sorted.length * .5) - 1]!,
    p95: sorted[Math.ceil(sorted.length * .95) - 1]!, maximum: sorted.at(-1)!, mean: values.reduce((a, b) => a + b, 0) / values.length };
}

function environment() {
  return { visibility: typeof document === "undefined" ? "unavailable" : document.visibilityState,
    focused: typeof document === "undefined" ? null : document.hasFocus() };
}

function identity(engine: WebGPUEngine) {
  // Babylon exposes getInfo(), but not the adapter's fallback bit. This optional
  // read is diagnostic only; the hardware harness also pins requestDevice info.
  const internals = engine as unknown as { _adapterInfo?: { isFallbackAdapter?: boolean }; _adapter?: { isFallbackAdapter?: boolean } };
  return { isWebGPU: engine.isWebGPU, name: engine.name, driver: engine.getInfo(),
    fallback: internals._adapterInfo?.isFallbackAdapter ?? internals._adapter?.isFallbackAdapter ?? null };
}

function inventory(scene: Scene, engine: WebGPUEngine) {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return {
    engine: identity(engine), sceneDisposed: scene.isDisposed,
    canvas: { width: engine.getRenderWidth(), height: engine.getRenderHeight(),
      hardwareScaling: engine.getHardwareScalingLevel(), devicePixelRatio: typeof window === "undefined" ? null : window.devicePixelRatio },
    scene: { meshes: scene.meshes.length, transformNodes: scene.transformNodes.length, geometries: scene.getGeometries().length,
      materials: scene.materials.length, multiMaterials: scene.multiMaterials.length, textureWrappers: scene.textures.length,
      uniqueTextureInternals: new Set(scene.textures.map(texture => texture.getInternalTexture()).filter(Boolean)).size,
      engineTextureInternals: new Set(engine.getLoadedTexturesCache()).size, skeletons: scene.skeletons.length,
      animationGroups: scene.animationGroups.length, lights: scene.lights.length },
    memory: { jsHeap: memory ? { usedBytes: memory.usedJSHeapSize, allocatedBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit } : null,
      gpuResidentBytes: null,
      limitation: "Chromium performance.memory is approximate and can cover shared heaps; wrapper/internal counts are not allocated GPU bytes." },
    environment: environment(),
  };
}

export interface WorldPerformanceResult {
  schemaVersion: 1;
  durationRequestedMs: number;
  elapsedMs: number;
  frames: number;
  actualFps: number;
  metrics: Record<"frameIntervalMs" | "jsFrameMs" | "activeMeshEvaluationMs" | "drawCalls" | "activeIndices" | "triangleEquivalent" | "activeMeshes", Distribution>;
  samples: { frameBeginOffsetsMs: number[]; frameIntervalMs: number[]; jsFrameMs: number[]; activeMeshEvaluationMs: number[];
    drawCalls: number[]; activeIndices: number[]; triangleEquivalent: number[]; activeMeshes: number[] };
  gpu: { source: string; status: "available" | "unavailable"; reason: string | null; completedFrames: number;
    totalMs: number; meanMs: number | null; individualFrameMs: Distribution; batches: GpuBatch[]; multiFrameBatches: number;
    scope: string };
  visibility: { atMs: number; visibility: string; focused: boolean | null }[];
  inventoryBefore: ReturnType<typeof inventory>;
  inventoryAfter: ReturnType<typeof inventory>;
  limits: string[];
}

export type WorldPerformanceProbe = ReturnType<typeof createWorldPerformanceProbe>;

/** Explicitly requested diagnostics only. Construction adds no observers and
 * does not enable GPU queries. This measures the supported scene, not the final
 * crowd/effect acceptance workload or display presentation rate. */
export function createWorldPerformanceProbe(scene: Scene) {
  const engine = scene.getEngine() as WebGPUEngine;
  let disposed = false;
  let running: { cancel(error: Error): void } | null = null;
  return {
    inspect: () => ({ disposed, measuring: running !== null, ...inventory(scene, engine) }),
    measure(durationMs: number): Promise<WorldPerformanceResult> {
      if (disposed || scene.isDisposed || engine.isDisposed) return Promise.reject(new Error("Performance probe or scene is disposed."));
      if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 120_000) return Promise.reject(new Error("Measurement duration must be 1000..120000 ms."));
      if (running) return Promise.reject(new Error("A performance measurement is already running."));
      const gpuIdentity = identity(engine);
      const driver = Object.values(gpuIdentity.driver).join(" ");
      if (!gpuIdentity.isWebGPU || gpuIdentity.name !== "WebGPU" || gpuIdentity.fallback === true ||
          /swiftshader|software|llvmpipe|lavapipe/i.test(driver) || !gpuIdentity.driver.vendor.trim() || /unknown vendor/i.test(gpuIdentity.driver.vendor)) {
        return Promise.reject(new Error("Performance measurement requires an identified hardware WebGPU engine."));
      }
      // Do not reset or dispose somebody else's timestamp collector.
      if (engine.enableGPUTimingMeasurements) return Promise.reject(new Error("GPU timing is already owned by another collector."));
      return new Promise<WorldPerformanceResult>((resolve, reject) => {
        const remove: (() => void)[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        let finished = false, cleaned = false, gpuOwned = false;
        let began: number | null = null, previousBegin: number | null = null, evaluationStart: number | null = null;
        let evaluationMs = 0, drawAtBegin = 0, drawCountAtBegin = 0;
        let lastGpuCount = 0, lastGpuTotal = 0;
        const gpuBatches: GpuBatch[] = [], individualGpuFrames: number[] = [];
        let gpuCounter: { count: number; total: number } | undefined;
        let gpuReason: string | null = "timestamp-query is unavailable on the existing device";
        const samples: WorldPerformanceResult["samples"] = { frameBeginOffsetsMs: [], frameIntervalMs: [], jsFrameMs: [],
          activeMeshEvaluationMs: [], drawCalls: [], activeIndices: [], triangleEquivalent: [], activeMeshes: [] };
        const before = inventory(scene, engine), start = performance.now();
        const visibility: WorldPerformanceResult["visibility"] = [{ atMs: 0, ...environment() }];
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          if (timer !== undefined) clearTimeout(timer);
          for (const undo of remove.reverse()) undo();
          if (gpuOwned && !engine.isDisposed) engine.enableGPUTimingMeasurements = false;
          running = null;
        };
        const fail = (error: Error) => {
          if (finished) return;
          finished = true;
          try { cleanup(); } catch (cause) { reject(new Error("Performance cleanup failed.", { cause })); return; }
          reject(error);
        };
        running = { cancel: fail };
        const observe = <T>(observable: Observable<T>, callback: () => void) => {
          const observer = observable.add(() => { try { callback(); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); } });
          remove.push(() => { observable.remove(observer); });
        };
        const collectGpu = () => {
          if (!gpuCounter) return;
          const count = gpuCounter.count, total = gpuCounter.total;
          if (count === lastGpuCount) return;
          if (count < lastGpuCount || total < lastGpuTotal || !Number.isFinite(total)) throw new Error("GPU timestamp counter changed unexpectedly.");
          // WebGPUPerfCounter finalizes the PREVIOUS frame before incrementing
          // count. Its first count has no completed duration. current can still
          // be partial, so only total/count deltas are admitted here.
          const completedFrames = count - lastGpuCount - (lastGpuCount === 0 ? 1 : 0);
          const totalMs = (total - lastGpuTotal) / NS_PER_MS;
          lastGpuCount = count; lastGpuTotal = total;
          if (completedFrames <= 0) return;
          if (gpuBatches.length >= MAX_SAMPLES) throw new Error("GPU measurement sample limit exceeded.");
          gpuBatches.push({ observedAtMs: performance.now() - start, completedFrames, totalMs });
          if (completedFrames === 1) individualGpuFrames.push(totalMs);
        };
        const finish = () => {
          if (finished) return;
          try {
            collectGpu();
            if (!samples.jsFrameMs.length) throw new Error("No complete engine frames were observed.");
            const elapsedMs = performance.now() - start;
            const completedFrames = gpuBatches.reduce((sum, batch) => sum + batch.completedFrames, 0);
            const totalMs = gpuBatches.reduce((sum, batch) => sum + batch.totalMs, 0);
            const gpuAvailable = completedFrames > 0 && totalMs > 0;
            const result: WorldPerformanceResult = {
              schemaVersion: 1, durationRequestedMs: durationMs, elapsedMs, frames: samples.jsFrameMs.length,
              actualFps: samples.jsFrameMs.length * 1000 / elapsedMs,
              metrics: { frameIntervalMs: distribution(samples.frameIntervalMs), jsFrameMs: distribution(samples.jsFrameMs),
                activeMeshEvaluationMs: distribution(samples.activeMeshEvaluationMs), drawCalls: distribution(samples.drawCalls),
                activeIndices: distribution(samples.activeIndices), triangleEquivalent: distribution(samples.triangleEquivalent), activeMeshes: distribution(samples.activeMeshes) },
              samples,
              gpu: { source: "Babylon WebGPU gpuTimeInFrameForMainPass.counter finalized total/count deltas; ns / 1000000",
                status: gpuAvailable ? "available" : "unavailable", reason: gpuAvailable ? null : gpuReason ?? "No positive completed main-pass timestamps arrived.",
                completedFrames, totalMs, meanMs: gpuAvailable ? totalMs / completedFrames : null,
                individualFrameMs: distribution(gpuAvailable ? individualGpuFrames : []), batches: gpuBatches,
                multiFrameBatches: gpuBatches.filter(batch => batch.completedFrames > 1).length,
                scope: "Main render passes only; excludes additional render targets, compute and presentation. Individual distribution excludes multi-frame arrival batches; final unfinished result is omitted." },
              visibility, inventoryBefore: before, inventoryAfter: inventory(scene, engine),
              limits: [
                "Engine begin/end intervals measure callback pacing; JS bracket includes synchronous render submission, not GPU execution or display presentation.",
                "Instrumentation adds observer and timestamp-query overhead; record profiling/recording separately from this measurement.",
                "Active-mesh evaluation is wall-clock CPU time between scene observables, accumulated across cameras in each engine frame.",
                "Draw counts use Babylon's engine counter delta (or current after reset); active indices include submitted instances. Indices/3 is triangle-equivalent, not unique geometry or clipped/rasterized triangles.",
                "Visibility/focus observations do not prove unthrottled execution, physical display refresh, headless presentation or 120 FPS acceptance.",
                "Hardware identity must also be pinned by the harness; an absent fallback field is unknown, not false.",
                "No memory estimate is provided for GPU allocations; JS heap and resource object counts have distinct scopes.",
              ],
            };
            cleanup(); finished = true; resolve(result);
          } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
        };
        try {
          if (engine.getCaps().timerQuery) {
            engine.enableGPUTimingMeasurements = true;
            gpuOwned = true;
            if (engine.enableGPUTimingMeasurements && engine.gpuTimeInFrameForMainPass) {
              gpuCounter = engine.gpuTimeInFrameForMainPass.counter;
              lastGpuCount = gpuCounter.count; lastGpuTotal = gpuCounter.total; gpuReason = null;
            } else gpuReason = "Babylon could not enable main-pass timestamp queries.";
          }
          observe(engine.onBeginFrameObservable, () => {
            if (samples.frameBeginOffsetsMs.length >= MAX_SAMPLES) throw new Error("Measurement sample limit exceeded.");
            const now = performance.now();
            if (previousBegin !== null) samples.frameIntervalMs.push(now - previousBegin);
            previousBegin = began = now; evaluationMs = 0; evaluationStart = null;
            drawAtBegin = engine._drawCalls.current; drawCountAtBegin = engine._drawCalls.count;
            samples.frameBeginOffsetsMs.push(now - start);
          });
          observe(scene.onBeforeActiveMeshesEvaluationObservable, () => { evaluationStart = performance.now(); });
          observe(scene.onAfterActiveMeshesEvaluationObservable, () => {
            if (evaluationStart !== null) evaluationMs += performance.now() - evaluationStart;
            evaluationStart = null;
          });
          observe(engine.onEndFrameObservable, () => {
            if (began === null) return;
            const end = performance.now();
            samples.jsFrameMs.push(end - began); began = null;
            samples.activeMeshEvaluationMs.push(evaluationMs);
            const calls = engine._drawCalls.current - (engine._drawCalls.count === drawCountAtBegin ? drawAtBegin : 0);
            if (calls < 0) throw new Error("Draw counter reset without advancing its frame count.");
            samples.drawCalls.push(calls);
            const indices = scene.getActiveIndices();
            samples.activeIndices.push(indices); samples.triangleEquivalent.push(indices / 3);
            samples.activeMeshes.push(scene.getActiveMeshes().length);
            collectGpu();
          });
          observe(scene.onDisposeObservable, () => { throw new Error("Scene disposed during performance measurement."); });
          const recordEnvironment = () => {
            if (visibility.length < MAX_SAMPLES) visibility.push({ atMs: performance.now() - start, ...environment() });
          };
          if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", recordEnvironment);
            remove.push(() => document.removeEventListener("visibilitychange", recordEnvironment));
          }
          if (typeof window !== "undefined") {
            window.addEventListener("focus", recordEnvironment); window.addEventListener("blur", recordEnvironment);
            remove.push(() => { window.removeEventListener("focus", recordEnvironment); window.removeEventListener("blur", recordEnvironment); });
          }
          timer = setTimeout(finish, durationMs);
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
    },
    dispose() { if (disposed) return; disposed = true; running?.cancel(new Error("Performance probe disposed during measurement.")); },
  };
}

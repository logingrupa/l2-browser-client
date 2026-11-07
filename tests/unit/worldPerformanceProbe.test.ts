import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@babylonjs/core/scene";
import { createWorldPerformanceProbe } from "../../src/engine/worldPerformanceProbe";

class Signal {
  readonly callbacks = new Set<() => void>();
  add(callback: () => void) { this.callbacks.add(callback); return callback; }
  remove(callback: () => void) { this.callbacks.delete(callback); }
  fire() { for (const callback of [...this.callbacks]) callback(); }
}

describe("explicit hardware world performance probe", () => {
  let now: number;
  let probes: ReturnType<typeof createWorldPerformanceProbe>[];
  beforeEach(() => {
    now = 0; probes = [];
    vi.useFakeTimers(); vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", hasFocus: () => true }));
    vi.stubGlobal("window", Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
  });
  afterEach(() => { for (const probe of probes) probe.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  function fixture(timerSupported = false) {
    let gpuEnabled = false;
    const gpuChanges: boolean[] = [], gpuCounter = { count: 0, total: 0 };
    const engine = {
      isWebGPU: true, name: "WebGPU", isDisposed: false,
      _adapterInfo: { isFallbackAdapter: false },
      driver: { vendor: "nvidia", renderer: "pascal", version: "test hardware boundary" },
      getInfo() { return this.driver; }, getCaps: () => ({ timerQuery: timerSupported }),
      getRenderWidth: () => 1920, getRenderHeight: () => 1080, getHardwareScalingLevel: () => 1,
      getLoadedTexturesCache: () => [sharedTexture, otherTexture],
      onBeginFrameObservable: new Signal(), onEndFrameObservable: new Signal(),
      _drawCalls: { current: 0, count: 0 },
      get enableGPUTimingMeasurements() { return gpuEnabled; },
      set enableGPUTimingMeasurements(value: boolean) { gpuChanges.push(value); gpuEnabled = value; },
      gpuTimeInFrameForMainPass: { counter: gpuCounter },
    };
    const sharedTexture = {}, otherTexture = {};
    const scene = {
      isDisposed: false, getEngine: () => engine, meshes: [{}, {}, {}], transformNodes: [{}], materials: [{}, {}], multiMaterials: [],
      textures: [{ getInternalTexture: () => sharedTexture }, { getInternalTexture: () => sharedTexture }, { getInternalTexture: () => null }],
      getGeometries: () => [{}, {}], skeletons: [], animationGroups: [], lights: [{}],
      onBeforeActiveMeshesEvaluationObservable: new Signal(), onAfterActiveMeshesEvaluationObservable: new Signal(), onDisposeObservable: new Signal(),
      getActiveIndices: () => 900, getActiveMeshes: () => ({ length: 3 }),
    };
    const probe = createWorldPerformanceProbe(scene as unknown as Scene); probes.push(probe);
    const signals = [engine.onBeginFrameObservable, engine.onEndFrameObservable, scene.onBeforeActiveMeshesEvaluationObservable,
      scene.onAfterActiveMeshesEvaluationObservable, scene.onDisposeObservable];
    const observers = () => signals.reduce((sum, signal) => sum + signal.callbacks.size, 0);
    function frame(start: number, js: number, evaluation: number, calls: number, resetCounter = false) {
      now = start; engine.onBeginFrameObservable.fire();
      now = start + .1; scene.onBeforeActiveMeshesEvaluationObservable.fire();
      now += evaluation; scene.onAfterActiveMeshesEvaluationObservable.fire();
      if (resetCounter) { engine._drawCalls.count++; engine._drawCalls.current = 0; }
      engine._drawCalls.current += calls;
      now = start + js; engine.onEndFrameObservable.fire();
    }
    async function finish(duration = 1000) { now = duration; await vi.advanceTimersByTimeAsync(duration); }
    return { engine, scene, probe, gpuCounter, gpuChanges, observers, frame, finish };
  }
  it("has no default observers, timers or GPU queries, and distinguishes wrappers from internal textures", () => {
    const f = fixture(true);
    expect(f.observers()).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(f.gpuChanges).toEqual([]);
    expect(f.probe.inspect()).toMatchObject({ measuring: false, scene: { meshes: 3, geometries: 2, textureWrappers: 3, uniqueTextureInternals: 1, engineTextureInternals: 2 },
      memory: { jsHeap: null, gpuResidentBytes: null } });
    expect(f.observers()).toBe(0); expect(f.gpuChanges).toEqual([]);
  });
  it("measures real intervals, callback CPU brackets, evaluation, submitted counters and nearest-rank percentiles", async () => {
    const f = fixture(), pending = f.probe.measure(1000);
    f.frame(10, 3, .5, 12); f.frame(26, 7, 2, 20); f.frame(60, 1, .25, 8, true);
    await f.finish(); const result = await pending;
    expect(result).toMatchObject({ elapsedMs: 1000, frames: 3, actualFps: 3,
      metrics: { frameIntervalMs: { count: 2, minimum: 16, median: 16, p95: 34, maximum: 34, mean: 25 },
        jsFrameMs: { count: 3, minimum: 1, median: 3, p95: 7, maximum: 7, mean: 11 / 3 },
        activeIndices: { median: 900 }, triangleEquivalent: { median: 300 }, activeMeshes: { median: 3 } } });
    expect(result.samples.drawCalls).toEqual([12, 20, 8]);
    expect(result.samples.activeMeshEvaluationMs).toEqual([.5, 2, .25]);
    expect(f.observers()).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(f.probe.inspect().measuring).toBe(false);
  });
  it("accumulates multiple camera evaluation brackets in one engine frame", async () => {
    const f = fixture(), pending = f.probe.measure(1000);
    now = 10; f.engine.onBeginFrameObservable.fire();
    now = 11; f.scene.onBeforeActiveMeshesEvaluationObservable.fire(); now = 12; f.scene.onAfterActiveMeshesEvaluationObservable.fire();
    now = 13; f.scene.onBeforeActiveMeshesEvaluationObservable.fire(); now = 15; f.scene.onAfterActiveMeshesEvaluationObservable.fire();
    now = 16; f.engine.onEndFrameObservable.fire();
    await f.finish(); expect((await pending).samples.activeMeshEvaluationMs).toEqual([3]);
  });
  it("does not manufacture GPU timing when the existing device lacks timestamp queries", async () => {
    const f = fixture(), pending = f.probe.measure(1000); f.frame(10, 2, 1, 1);
    await f.finish(); const result = await pending;
    expect(result.gpu).toMatchObject({ status: "unavailable", completedFrames: 0, meanMs: null, individualFrameMs: { count: 0, median: null } });
    expect(result.gpu.reason).toContain("unavailable"); expect(f.gpuChanges).toEqual([]);
  });
  it("samples finalized GPU arrivals once, excludes the empty initial count and preserves missed-frame batches", async () => {
    const f = fixture(true), pending = f.probe.measure(1000);
    f.gpuCounter.count = 1; f.frame(10, 2, 1, 1);
    f.gpuCounter.count = 2; f.gpuCounter.total = 2_000_000; f.frame(30, 2, 1, 1);
    f.frame(50, 2, 1, 1); // identical counter is not another GPU sample
    f.gpuCounter.count = 4; f.gpuCounter.total = 9_000_000; f.frame(70, 2, 1, 1);
    await f.finish(); const result = await pending;
    expect(result.gpu).toMatchObject({ status: "available", completedFrames: 3, totalMs: 9, meanMs: 3,
      individualFrameMs: { count: 1, median: 2, p95: 2 }, multiFrameBatches: 1 });
    expect(result.gpu.batches.map(({ completedFrames, totalMs }) => ({ completedFrames, totalMs }))).toEqual([
      { completedFrames: 1, totalMs: 2 }, { completedFrames: 2, totalMs: 7 }]);
    expect(f.gpuChanges).toEqual([true, false]); expect(f.observers()).toBe(0);
  });
  it("does not treat repeated zero GPU results as a zero-millisecond GPU pass", async () => {
    const f = fixture(true), pending = f.probe.measure(1000);
    f.gpuCounter.count = 1; f.frame(10, 2, 1, 1); f.gpuCounter.count = 2; f.frame(30, 2, 1, 1);
    await f.finish(); expect((await pending).gpu).toMatchObject({ status: "unavailable", completedFrames: 1, meanMs: null, individualFrameMs: { median: null } });
  });
  it("rejects an existing timestamp owner without changing its state", async () => {
    const f = fixture(true); f.engine.enableGPUTimingMeasurements = true;
    await expect(f.probe.measure(1000)).rejects.toThrow("already owned");
    expect(f.gpuChanges).toEqual([true]); expect(f.engine.enableGPUTimingMeasurements).toBe(true); expect(f.observers()).toBe(0);
  });
  it.each([0, 999, 120001, NaN, Infinity])("rejects duration %s without allocating observers or timers", async duration => {
    const f = fixture(true); await expect(f.probe.measure(duration)).rejects.toThrow("1000..120000");
    expect(f.observers()).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(f.gpuChanges).toEqual([]);
  });
  it.each(["legacy", "fallback", "software", "unidentified"])("rejects %s rendering", async kind => {
    const f = fixture();
    if (kind === "legacy") f.engine.isWebGPU = false;
    if (kind === "fallback") f.engine._adapterInfo.isFallbackAdapter = true;
    if (kind === "software") f.engine.driver.renderer = "SwiftShader";
    if (kind === "unidentified") f.engine.driver.vendor = "unknown vendor";
    await expect(f.probe.measure(1000)).rejects.toThrow("hardware WebGPU"); expect(f.observers()).toBe(0);
  });
  it("rejects overlapping measurement but leaves the first one intact", async () => {
    const f = fixture(), first = f.probe.measure(1000);
    await expect(f.probe.measure(1000)).rejects.toThrow("already running");
    f.frame(10, 2, 1, 1); await f.finish(); expect((await first).frames).toBe(1); expect(f.observers()).toBe(0);
  });
  it("records focus and visibility changes without treating focus as presentation proof", async () => {
    const f = fixture(), pending = f.probe.measure(1000); f.frame(10, 2, 1, 1);
    now = 50; Object.assign(document, { visibilityState: "hidden" }); document.dispatchEvent(new Event("visibilitychange"));
    now = 60; Object.assign(document, { hasFocus: () => false }); window.dispatchEvent(new Event("blur"));
    await f.finish(); const result = await pending;
    expect(result.visibility).toEqual([{ atMs: 0, visibility: "visible", focused: true }, { atMs: 50, visibility: "hidden", focused: true }, { atMs: 60, visibility: "hidden", focused: false }]);
    expect(result.limits.some(limit => limit.includes("120 FPS"))).toBe(true);
  });
  it.each(["scene", "probe"])("rejects and releases all owned resources on %s disposal", async kind => {
    const f = fixture(true), pending = f.probe.measure(1000), rejected = expect(pending).rejects.toThrow("disposed");
    if (kind === "scene") { f.scene.isDisposed = true; f.scene.onDisposeObservable.fire(); } else f.probe.dispose();
    await rejected;
    expect(f.observers()).toBe(0); expect(f.gpuChanges).toEqual([true, false]); expect(vi.getTimerCount()).toBe(0);
    await expect(f.probe.measure(1000)).rejects.toThrow("disposed"); f.probe.dispose(); expect(f.gpuChanges).toEqual([true, false]);
  });
  it("fails and cleans up a counter reset instead of silently reporting corrupt GPU samples", async () => {
    const f = fixture(true), pending = f.probe.measure(1000), rejected = expect(pending).rejects.toThrow("counter changed");
    f.gpuCounter.count = 2; f.gpuCounter.total = 2_000_000; f.frame(10, 2, 1, 1);
    f.gpuCounter.count = 1; f.frame(30, 2, 1, 1); await rejected;
    expect(f.observers()).toBe(0); expect(f.gpuChanges).toEqual([true, false]); expect(vi.getTimerCount()).toBe(0);
  });
  it("fails a stalled engine instead of claiming zero CPU/GPU cost", async () => {
    const f = fixture(true), pending = f.probe.measure(1000), rejected = expect(pending).rejects.toThrow("No complete engine frames");
    await f.finish(); await rejected; expect(f.observers()).toBe(0); expect(f.gpuChanges).toEqual([true, false]);
  });
  it("rejects invalid draw counters and removes all callbacks", async () => {
    const f = fixture(), pending = f.probe.measure(1000), rejected = expect(pending).rejects.toThrow("Draw counter reset");
    f.engine._drawCalls.current = 20; now = 10; f.engine.onBeginFrameObservable.fire();
    f.engine._drawCalls.current = 2; now = 12; f.engine.onEndFrameObservable.fire(); await rejected;
    expect(f.observers()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds retained data even if engine begin events arrive without matching end events", async () => {
    const f = fixture(), pending = f.probe.measure(1000), rejected = expect(pending).rejects.toThrow("sample limit");
    for (let i = 0; i <= 40_000; i++) { now = i / 100; f.engine.onBeginFrameObservable.fire(); }
    await rejected; expect(f.observers()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});

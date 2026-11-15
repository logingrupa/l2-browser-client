import { baseRuntimeSettings, runtimeBoundaryMocks, useNativeSliceRuntimeHarness } from "../support/nativeSliceRuntimeHarness";
import { registerFlamePresentationWorldCases, sourceSectionTestWorld } from "../support/nativeSliceRuntimeWorldCases";
import { describe, expect, it, vi } from "vitest";

describe("native slice runtime flame presentation", () => {
  const harness = useNativeSliceRuntimeHarness();
  const { stops, startRuntime, mockSourceSectionWithRealTerrain, presentationFixture } = harness;

  registerFlamePresentationWorldCases(harness, sourceSectionTestWorld(harness));

  it("keeps a valid world and the previous replay time after rejected seeks", async () => {
    mockSourceSectionWithRealTerrain(); const { owner } = presentationFixture();
    stops.push(await startRuntime({ ...baseRuntimeSettings, flameTextureSeconds: 5, flameFadeSeconds: 8 }, new AbortController().signal));
    const previous = window.__nativeSlice!.snapshot().flameReplay, calls = owner.update.mock.calls.length;
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: -1, fadeSeconds: 0 })).toThrow("finite and nonnegative");
    expect(owner.update).toHaveBeenCalledTimes(calls); expect(window.__nativeSlice!.snapshot().flameReplay).toEqual(previous);
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: 1e100, fadeSeconds: 30 })).toThrow("signed-int truncation");
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: 12, fadeSeconds: 1e100 })).toThrow("finite binary32");
    expect(owner.update).toHaveBeenCalledTimes(calls); expect(window.__nativeSlice!.snapshot().flameReplay).toEqual(previous); expect(owner.dispose).not.toHaveBeenCalled();
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 6, fadeSeconds: 9 });
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, flameFailure: null });
  });

  it("reports an actual seek update failure immediately without waiting for another frame", async () => {
    mockSourceSectionWithRealTerrain(); const { owner, inspection } = presentationFixture();
    const elements: (EventTarget & { id?: string; hidden?: boolean; textContent?: string })[] = [];
    vi.stubGlobal("document", Object.assign(new EventTarget(), { createElement: () => { const element = Object.assign(new EventTarget(), { dataset: {} }); elements.push(element); return element; } }));
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    owner.update.mockImplementationOnce(() => { inspection.status = "failed"; inspection.failure = "Shader update failed"; });
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: 12, fadeSeconds: 30 })).toThrow("Shader update failed");
    expect(owner.dispose).toHaveBeenCalledOnce();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeFlames: null, flameFailure: "Shader update failed", worldFailure: null, nativeTerrain: "source-section-loaded" });
    expect(elements.find(element => element.id === "native-flame-status")).toMatchObject({ hidden: false, textContent: "Shader update failed World and saved materials retained." });
    const calls = owner.update.mock.calls.length; harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene); expect(owner.update).toHaveBeenCalledTimes(calls);
  });

  it("releases a not-present presentation and omits its replay diagnostics", async () => {
    mockSourceSectionWithRealTerrain();
    const owner = { update: vi.fn(), inspect: () => ({ status: "not-present", failure: null }), dispose: vi.fn() };
    runtimeBoundaryMocks.flames.mockResolvedValueOnce(owner);
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(owner.update).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", nativeFlames: null, flameReplay: null, flameFailure: null });
    stop(); expect(owner.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports invalid replay settings without losing a valid world or preparing flame assets", async () => {
    mockSourceSectionWithRealTerrain();
    stops.push(await startRuntime({ ...baseRuntimeSettings, flameFadeRate: -1 }, new AbortController().signal));
    expect(runtimeBoundaryMocks.flames).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameReplay: null });
    expect(window.__nativeSlice!.snapshot().flameFailure).toContain("fadeRate must be finite and nonnegative");
  });
});

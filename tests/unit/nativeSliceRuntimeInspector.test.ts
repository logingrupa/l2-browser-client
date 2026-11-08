import { baseRuntimeSettings, runtimeBoundaryMocks, useNativeSliceRuntimeHarness } from "../support/nativeSliceRuntimeHarness";
import { registerPackageInspectionWorldCase, sourceSectionTestWorld } from "../support/nativeSliceRuntimeWorldCases";
import { describe, expect, it, vi } from "vitest";
import type { Scene } from "@babylonjs/core/scene";
import type { AssetImportOptions } from "../../src/ui/AssetImportPanel";
import type { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { isSceneSuspended, setSceneSuspended } from "../../src/engine/renderSuspension";

describe("native slice runtime package inspector suspension", () => {
  const harness = useNativeSliceRuntimeHarness();
  const { stops, startRuntime } = harness;

  registerPackageInspectionWorldCase(harness, sourceSectionTestWorld(harness));

  it.each([false, true])("retains explicit pause=%s and audio settings through repeated inspector notifications", async paused => {
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    const ui = runtimeBoundaryMocks.uis[0]!, audio = runtimeBoundaryMocks.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    const options = runtimeBoundaryMocks.assetImport.mock.calls[0]![2] as AssetImportOptions;
    ui.adapter.dispatch({ type: "set-paused", isPaused: paused });
    audio.setMuted(true); audio.setVolume(.35);
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    const dispatch = vi.spyOn(ui.adapter, "dispatch");
    options.onOpenChange!(true); options.onOpenChange!(true);
    expect(ui.adapter.isPaused).toBe(paused); expect(isSceneSuspended(harness.scene)).toBe(true);
    expect(audio.inspection()).toMatchObject({ paused: true, muted: true, volume: .35 });
    options.onOpenChange!(false); options.onOpenChange!(false);
    expect(ui.adapter.isPaused).toBe(paused); expect(isSceneSuspended(harness.scene)).toBe(false);
    expect(audio.inspection()).toMatchObject({ paused, muted: true, volume: .35 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("restores the user's current pause choice if it changes while the inspector is open", async () => {
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    const ui = runtimeBoundaryMocks.uis[0]!, audio = runtimeBoundaryMocks.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    const options = runtimeBoundaryMocks.assetImport.mock.calls[0]![2] as AssetImportOptions;
    for (const paused of [true, false]) {
      options.onOpenChange!(true);
      ui.adapter.dispatch({ type: "set-paused", isPaused: paused });
      expect(audio.inspection().paused).toBe(true);
      options.onOpenChange!(false);
      expect(ui.adapter.isPaused).toBe(paused); expect(audio.inspection().paused).toBe(paused);
      expect(isSceneSuspended(harness.scene)).toBe(false);
    }
  });

  it("preserves an existing scene suspension when the inspector closes", async () => {
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    const options = runtimeBoundaryMocks.assetImport.mock.calls[0]![2] as AssetImportOptions;
    const ui = runtimeBoundaryMocks.uis[0]!, registry = runtimeBoundaryMocks.registries[0]!, audio = runtimeBoundaryMocks.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    setSceneSuspended(harness.scene, true);
    options.onOpenChange!(true); options.onOpenChange!(false);
    expect(isSceneSuspended(harness.scene)).toBe(true); expect(ui.adapter.isPaused).toBe(false);
    expect(audio.inspection().paused).toBe(true);
    const previous = registry.update.mock.calls.length;
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(registry.update).toHaveBeenCalledTimes(previous);
    setSceneSuspended(harness.scene, false);
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(registry.update).toHaveBeenLastCalledWith(.1); expect(audio.inspection().paused).toBe(false);
  });

  it.each(["stop", "abort", "scene"] as const)("restores inspector suspension on %s without depending on a close notification", async lifetime => {
    const controller = new AbortController(), stop = await startRuntime(baseRuntimeSettings, controller.signal); stops.push(stop);
    const options = runtimeBoundaryMocks.assetImport.mock.calls[0]![2] as AssetImportOptions;
    const audio = runtimeBoundaryMocks.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    options.onOpenChange!(true);
    expect(isSceneSuspended(harness.scene)).toBe(true);
    if (lifetime === "abort") controller.abort(); else if (lifetime === "scene") harness.scene.dispose(); else stop();
    stop();
    expect(runtimeBoundaryMocks.detachAssetImport).toHaveBeenCalledTimes(1);
    expect(isSceneSuspended(harness.scene)).toBe(false); expect(audio.inspection().state).toBe("disposed");
    expect(runtimeBoundaryMocks.registries[0]!.dispose).toHaveBeenCalledTimes(1); expect(runtimeBoundaryMocks.uis[0]!.dispose).toHaveBeenCalledTimes(1);
    const lateInFlightInspectorNotifications = () => { options.onOpenChange!(true); options.onOpenChange!(false); };
    lateInFlightInspectorNotifications();
    expect(isSceneSuspended(harness.scene)).toBe(false);
  });

  it("retains earlier suspension when panel disposal emits its own close notification", async () => {
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    const options = runtimeBoundaryMocks.assetImport.mock.calls[0]![2] as AssetImportOptions;
    setSceneSuspended(harness.scene, true); options.onOpenChange!(true);
    runtimeBoundaryMocks.detachAssetImport.mockImplementationOnce(() => options.onOpenChange!(false));
    stop(); stop();
    expect(isSceneSuspended(harness.scene)).toBe(true); expect(runtimeBoundaryMocks.detachAssetImport).toHaveBeenCalledTimes(1);
    options.onOpenChange!(true); options.onOpenChange!(false);
    expect(isSceneSuspended(harness.scene)).toBe(true);
  });

  it("does not clear another suspension when an unopened inspector is disposed", async () => {
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    setSceneSuspended(harness.scene, true); stop();
    expect(isSceneSuspended(harness.scene)).toBe(true); expect(runtimeBoundaryMocks.detachAssetImport).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("restores prior suspension=%s after asset-panel attachment fails", async prior => {
    setSceneSuspended(harness.scene, prior);
    runtimeBoundaryMocks.assetImport.mockImplementationOnce((_scene: Scene, _canvas: HTMLCanvasElement, options: AssetImportOptions) => {
      options.onOpenChange!(true); throw new Error("Asset inspector attachment failed");
    });
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal)).rejects.toThrow("Asset inspector attachment failed");
    expect(isSceneSuspended(harness.scene)).toBe(prior); expect(runtimeBoundaryMocks.detachAssetImport).not.toHaveBeenCalled();
    expect(runtimeBoundaryMocks.registries[0]!.dispose).toHaveBeenCalledTimes(1); expect(runtimeBoundaryMocks.uis[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(runtimeBoundaryMocks.detachCamera).toHaveBeenCalledTimes(1); expect(runtimeBoundaryMocks.detachTargeting).toHaveBeenCalledTimes(1);
    expect(window.__nativeSlice).toBeUndefined();
  });
});

import { expect, it, vi } from "vitest";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { NativeSection } from "../../src/scene/world/loadNativeSection";
import type { AssetImportOptions } from "../../src/ui/AssetImportPanel";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { isSceneSuspended } from "../../src/engine/renderSuspension";
import { baseRuntimeSettings, runtimeBoundaryMocks, type NativeSliceRuntimeHarness } from "./nativeSliceRuntimeHarness";

export interface PreparedNativeSliceWorld {
  readonly worldRootScalingZ: () => number | undefined;
  expectRestoredAfterRuntimeRelease(): void;
}

export interface NativeSliceTestWorld {
  readonly name: "source" | "authored";
  readonly sectionLoadCount: number;
  readonly worldRootScalingZWhileRunning: number | undefined;
  prepare(): PreparedNativeSliceWorld;
}

export function sourceSectionTestWorld(harness: NativeSliceRuntimeHarness): NativeSliceTestWorld {
  return {
    name: "source",
    sectionLoadCount: 1,
    worldRootScalingZWhileRunning: undefined,
    prepare() {
      const source = harness.mockSourceSectionWithRealTerrain();
      return {
        worldRootScalingZ: () => undefined,
        expectRestoredAfterRuntimeRelease() { expect(source.ground.isDisposed()).toBe(true); expect(source.authored.isEnabled()).toBe(true); },
      };
    },
  };
}

export function registerFlamePresentationWorldCases(harness: NativeSliceRuntimeHarness, world: NativeSliceTestWorld) {
  const { stops, startRuntime, presentationFixture } = harness;
  const settings = baseRuntimeSettings;

  it(`feeds independent uncapped flame clocks while actors retain their capped step in the ${world.name} world`, async () => {
    world.prepare();
    const { owner, inspection } = presentationFixture(), controller = new AbortController();
    const replay = { ...settings, flameTextureSeconds: 2.25, flameFadeSeconds: 8.5, flameTextureRate: 3, flameFadeRate: 0.25 };
    const stop = await startRuntime(replay, controller.signal); stops.push(stop);
    expect(runtimeBoundaryMocks.flames).toHaveBeenCalledExactlyOnceWith(harness.scene, expect.objectContaining({ spawnCandidate: expect.any(Vector3) }), expect.any(AbortSignal));
    expect((runtimeBoundaryMocks.flames.mock.calls[0]![2] as AbortSignal).aborted).toBe(false);
    expect(runtimeBoundaryMocks.section).toHaveBeenCalledTimes(world.sectionLoadCount);
    expect(owner.update.mock.calls[0]![0]).toEqual({ textureSeconds: 2.25, fadeSeconds: 8.5 });
    const ui = runtimeBoundaryMocks.uis[0]!, registry = runtimeBoundaryMocks.registries[0]!;
    vi.mocked(harness.engine.getDeltaTime).mockReturnValue(2500); harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(registry.update).toHaveBeenLastCalledWith(0.1);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 9.75, fadeSeconds: 9.125 });
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeFlames: inspection, flameFailure: null, flameReplay: {
      textureSeconds: 9.75, fadeSeconds: 9.125, textureRate: 3, fadeRate: 0.25, nativeSynchronization: "unverified",
    } });
    const oldTarget = owner.update.mock.lastCall![1], camera = harness.scene.getCameraByName("World camera") as ArcRotateCamera;
    ui.adapter.dispatch({ type: "set-paused", isPaused: true }); camera.alpha += 0.3;
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(registry.update).toHaveBeenLastCalledWith(0);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 9.75, fadeSeconds: 9.125 });
    expect(owner.update.mock.lastCall![1]).not.toEqual(oldTarget);
    expect(owner.update.mock.lastCall![1]).toEqual([camera.globalPosition.x * 100, camera.globalPosition.z * 100, camera.globalPosition.y * 100]);
    window.__nativeSlice!.setFlameReplay!({ textureSeconds: 11, fadeSeconds: 0.6 });
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 11, fadeSeconds: 0.6 });
    ui.adapter.dispatch({ type: "set-paused", isPaused: false }); vi.mocked(harness.engine.getDeltaTime).mockReturnValue(200);
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 11.6, fadeSeconds: 0.65 });
    expect(registry.update).toHaveBeenLastCalledWith(0.1);
  });

  it(`passes disabled preview intent through without creating a presentation in the ${world.name} world`, async () => {
    world.prepare();
    stops.push(await startRuntime({ ...settings, flamePreviewEnabled: false, flameTextureRate: NaN }, new AbortController().signal));
    expect(runtimeBoundaryMocks.flames).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameReplay: null, flameFailure: null });
  });

  it(`contains initial flame-update failures within the valid ${world.name} world`, async () => {
    world.prepare();
    const { owner } = presentationFixture(); owner.update.mockImplementationOnce(() => { throw new Error("Flame initial update failed"); });
    const stop = await startRuntime(settings, new AbortController().signal); stops.push(stop);
    const section = runtimeBoundaryMocks.flames.mock.calls[0]![1] as NativeSection;
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).not.toHaveBeenCalled(); expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameFailure: "Flame initial update failed" });
    expect(runtimeBoundaryMocks.uis[0]!.showStatus).toHaveBeenLastCalledWith("Flame initial update failed World and saved materials retained.");
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene); expect(runtimeBoundaryMocks.registries[0]!.update).toHaveBeenLastCalledWith(0.1);
    expect(owner.update).toHaveBeenCalledTimes(1); stop(); expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).toHaveBeenCalledTimes(1);
  });

  it(`retains the ${world.name} world after a presentation-local aborted load`, async () => {
    world.prepare();
    runtimeBoundaryMocks.flames.mockRejectedValueOnce(new DOMException("Flame asset load aborted", "AbortError"));
    stops.push(await startRuntime(settings, new AbortController().signal));
    const section = runtimeBoundaryMocks.flames.mock.calls[0]![1] as NativeSection;
    expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameFailure: "Flame asset load aborted" });
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene); expect(runtimeBoundaryMocks.registries[0]!.update).toHaveBeenLastCalledWith(0.1);
  });

  it(`stops failed flame frames without disposing the valid ${world.name} world or actor loop`, async () => {
    world.prepare();
    const { owner } = presentationFixture();
    const stop = await startRuntime(settings, new AbortController().signal); stops.push(stop);
    const section = runtimeBoundaryMocks.flames.mock.calls[0]![1] as NativeSection;
    owner.update.mockImplementationOnce(() => { throw new Error("Flame frame failed"); });
    expect(() => harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene)).not.toThrow();
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameFailure: "Flame frame failed" });
    expect(runtimeBoundaryMocks.uis[0]!.showStatus).toHaveBeenLastCalledWith("Flame frame failed World and saved materials retained.");
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene); expect(owner.update).toHaveBeenCalledTimes(2);
    expect(runtimeBoundaryMocks.registries[0]!.update).toHaveBeenCalledTimes(3); expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    stop(); expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["preparation", "failed"], ["preparation", "aborted"], ["frame", "failed"], ["frame", "aborted"],
  ] as const)(`retains the ${world.name} world when presentation %s reports %s without throwing`, async (phase, status) => {
    world.prepare();
    const { owner, inspection } = presentationFixture();
    const fail = () => { inspection.status = status; inspection.failure = `Presentation ${status} during ${phase}`; };
    if (phase === "preparation") fail();
    const stop = await startRuntime(settings, new AbortController().signal); stops.push(stop);
    if (phase === "frame") { fail(); harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene); }
    const section = runtimeBoundaryMocks.flames.mock.calls[0]![1] as NativeSection;
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).not.toHaveBeenCalled();
    expect(owner.update).toHaveBeenCalledTimes(phase === "preparation" ? 0 : 2);
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ worldFailure: null, nativeTerrain: "source-section-loaded", nativeFlames: null, flameFailure: inspection.failure });
    const calls = owner.update.mock.calls.length; harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(owner.update).toHaveBeenCalledTimes(calls); expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    expect(runtimeBoundaryMocks.registries[0]!.update).toHaveBeenLastCalledWith(0.1);
    stop(); expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["stop", "abort", "startup-failure"] as const)(`releases flame presentation before the ${world.name} section on %s`, async end => {
    const prepared = world.prepare();
    const order: string[] = [], { owner } = presentationFixture(order), controller = new AbortController();
    const atRelease: { groundDisposed: boolean; worldRootScalingZ: number | undefined }[] = [];
    owner.dispose.mockImplementation(() => {
      order.push("flames");
      atRelease.push({ groundDisposed: (runtimeBoundaryMocks.flames.mock.calls[0]![1] as NativeSection).terrainMeshes[0]!.isDisposed(), worldRootScalingZ: prepared.worldRootScalingZ() });
    });
    if (end === "startup-failure") {
      runtimeBoundaryMocks.targeting.mockImplementationOnce(() => { throw new Error("Failure after presentation attachment"); });
      await expect(startRuntime(settings, controller.signal)).rejects.toThrow("Failure after presentation attachment");
    } else {
      const stop = await startRuntime(settings, controller.signal); stops.push(stop);
      if (end === "abort") controller.abort(); else stop(); stop();
    }
    expect(order).toEqual(["flames", "section"]); expect(owner.dispose).toHaveBeenCalledTimes(1);
    expect(atRelease).toEqual([{ groundDisposed: false, worldRootScalingZ: world.worldRootScalingZWhileRunning }]);
    prepared.expectRestoredAfterRuntimeRelease();
    expect(window.__nativeSlice).toBeUndefined();
  });

  it(`releases a late flame owner before the ${world.name} section when startup is cancelled`, async () => {
    const prepared = world.prepare();
    const controller = new AbortController(), order: string[] = [], owner = { update: vi.fn(), inspect: () => null, dispose: vi.fn(() => { order.push("flames"); }) };
    let release!: () => void, begin!: () => void, presentationSignal!: AbortSignal; const started = new Promise<void>(resolve => { begin = resolve; });
    const atPresentationAbort: { groundDisposed: boolean; worldRootScalingZ: number | undefined }[] = [];
    runtimeBoundaryMocks.flames.mockImplementationOnce((_scene: Scene, section: NativeSection, received: AbortSignal) => {
      presentationSignal = received; expect(received.aborted).toBe(false); const original = section.dispose.bind(section);
      received.addEventListener("abort", () => atPresentationAbort.push({ groundDisposed: section.terrainMeshes[0]!.isDisposed(), worldRootScalingZ: prepared.worldRootScalingZ() }), { once: true });
      vi.spyOn(section, "dispose").mockImplementation(() => { order.push("section"); original(); });
      return new Promise(resolve => { release = () => resolve(owner); begin(); });
    });
    const pending = startRuntime(settings, controller.signal); await started; controller.abort(); expect(presentationSignal.aborted).toBe(true); release();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(atPresentationAbort).toEqual([{ groundDisposed: false, worldRootScalingZ: world.worldRootScalingZWhileRunning }]);
    expect(order).toEqual(["flames", "section"]); expect(owner.update).not.toHaveBeenCalled(); expect(runtimeBoundaryMocks.uis).toEqual([]);
    prepared.expectRestoredAfterRuntimeRelease();
  });
}

export function registerPackageInspectionWorldCase(harness: NativeSliceRuntimeHarness, world: NativeSliceTestWorld) {
  it(`opens package inspection from ${world.name} world controls without advancing or changing the world`, async () => {
    world.prepare();
    const { owner } = harness.presentationFixture();
    const stopVoices = vi.spyOn(WorldAudioMixer.prototype, "stopAll");
    const scene = harness.scene;
    harness.stops.push(await harness.startRuntime(baseRuntimeSettings, new AbortController().signal));
    expect(runtimeBoundaryMocks.assetImport).toHaveBeenCalledWith(scene, harness.engine.getRenderingCanvas(), expect.objectContaining({
      host: expect.anything(), onOpenChange: expect.any(Function),
    }));
    const options = runtimeBoundaryMocks.assetImport.mock.calls[0]![2] as AssetImportOptions;
    const ui = runtimeBoundaryMocks.uis[0]!, registry = runtimeBoundaryMocks.registries[0]!;
    const audio = runtimeBoundaryMocks.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    const meshes = [...scene.meshes], materials = [...scene.materials], nodes = [...scene.transformNodes];
    ui.adapter.dispatch({ type: "move-local", position: { x: 213, y: -30, z: 794 } });
    const entities = structuredClone(ui.adapter.getInitialState());
    const registryCalls = registry.update.mock.calls.length, flameCalls = owner.update.mock.calls.length, uiCalls = ui.update.mock.calls.length;
    options.onOpenChange!(true);
    expect(isSceneSuspended(scene)).toBe(true); expect(ui.adapter.isPaused).toBe(false);
    expect(audio.inspection().paused).toBe(true); expect(stopVoices).toHaveBeenCalled();
    const requestSceneFrameWhileSuspendedLikeEditorPlay = () => scene.onBeforeRenderObservable.notifyObservers(scene);
    requestSceneFrameWhileSuspendedLikeEditorPlay();
    expect(registry.update).toHaveBeenCalledTimes(registryCalls);
    expect(owner.update).toHaveBeenCalledTimes(flameCalls); expect(ui.update).toHaveBeenCalledTimes(uiCalls);
    expect(ui.adapter.getInitialState()).toEqual(entities);
    expect(scene.meshes).toEqual(meshes); expect(scene.materials).toEqual(materials); expect(scene.transformNodes).toEqual(nodes);
    options.onOpenChange!(false);
    expect(isSceneSuspended(scene)).toBe(false); expect(audio.inspection().paused).toBe(false);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(registry.update).toHaveBeenLastCalledWith(.1);
    expect(owner.update).toHaveBeenCalledTimes(flameCalls + 1); expect(ui.update).toHaveBeenCalledTimes(uiCalls + 1);
  });
}

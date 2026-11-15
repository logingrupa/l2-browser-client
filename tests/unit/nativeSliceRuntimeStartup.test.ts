import { baseRuntimeSettings, runtimeBoundaryMocks, useNativeSliceRuntimeHarness } from "../support/nativeSliceRuntimeHarness";
import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";

describe("native slice runtime startup", () => {
  const harness = useNativeSliceRuntimeHarness();
  const { stops, startRuntime, mockSourceSectionWithRealTerrain, presentationFixture } = harness;

  it("keeps the required world playable when optional effect metadata fails", async () => {
    mockSourceSectionWithRealTerrain(); runtimeBoundaryMocks.effectBundle.mockRejectedValueOnce(new Error("Effect manifest hash differs"));
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal, { requireWorld: true }));
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ effectComponents: null,
      effectComponentFailure: "Effect manifest hash differs", worldFailure: null, nativeTerrain: "source-section-loaded" });
    expect(runtimeBoundaryMocks.registries[0]!.dispose).not.toHaveBeenCalled();
  });

  it("disposes the optional component owner before releasing character anchors", async () => {
    runtimeBoundaryMocks.effectBundle.mockResolvedValueOnce({ manifestSha256: "a".repeat(64), manifest: { components: [], actors: [] } });
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    const diagnostics = window.__nativeSlice!;
    expect(diagnostics.snapshot().effectComponents).toMatchObject({ status: "off", playback: null });
    runtimeBoundaryMocks.registries[0]!.dispose.mockImplementationOnce(() => {
      expect(diagnostics.snapshot().effectComponents).toMatchObject({ status: "disposed", playback: null });
    });
    stop(); expect(runtimeBoundaryMocks.registries[0]!.dispose).toHaveBeenCalledOnce();
  });

  it("advances the visual clock, pauses it, leaves positions to move records and releases each boundary exactly once", async () => {
    const before = harness.scene.onBeforeRenderObservable.observers.length;
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    const ui = runtimeBoundaryMocks.uis[0]!, registry = runtimeBoundaryMocks.registries[0]!;
    expect(ui.adapter.getInitialState()[0]).toMatchObject({ position: { x: 2, y: 3, z: 4 }, equipment: { upper: 22 } });
    ui.adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(ui.adapter.getInitialState()[0]!.position.x).toBe(2);
    expect(registry.update).toHaveBeenLastCalledWith(.1);
    ui.adapter.dispatch({ type: "set-paused", isPaused: true }); harness.scene.onBeforeRenderObservable.notifyObservers(harness.scene);
    expect(registry.update).toHaveBeenCalledTimes(3); expect(registry.update).toHaveBeenLastCalledWith(0);
    expect(ui.adapter.getInitialState()[0]!.position.x).toBe(2); expect(ui.update).toHaveBeenCalledTimes(2);
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ nativeAttackReference: "unverified", phase2Networking: false });
    stop(); stop();
    expect(runtimeBoundaryMocks.detachCamera).toHaveBeenCalledTimes(1); expect(runtimeBoundaryMocks.detachTargeting).toHaveBeenCalledTimes(1);
    expect(registry.dispose).toHaveBeenCalledTimes(1); expect(ui.dispose).toHaveBeenCalledTimes(1);
    expect(ui.adapter.getInitialState()).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
    await vi.waitFor(() => expect(harness.scene.onBeforeRenderObservable.observers.length).toBe(before));
  });

  it("keeps runtime startup pending until native assemblies are complete, then positions them before attaching controls", async () => {
    let release!: () => void;
    runtimeBoundaryMocks.assembly.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const progress = vi.fn(), completed = vi.fn();
    const pending = startRuntime(baseRuntimeSettings, new AbortController().signal, { onProgress: progress }).then(stop => {
      stops.push(stop); completed(); return stop;
    });
    await vi.waitFor(() => expect(runtimeBoundaryMocks.assembly).toHaveBeenCalledOnce());
    const registry = runtimeBoundaryMocks.registries[0]!;
    expect(completed).not.toHaveBeenCalled(); expect(registry.update).not.toHaveBeenCalled();
    expect(runtimeBoundaryMocks.camera).not.toHaveBeenCalled(); expect(runtimeBoundaryMocks.targeting).not.toHaveBeenCalled();
    expect(window.__nativeSlice).toBeUndefined();
    expect(progress).toHaveBeenCalledWith({ stage: "assets", detail: "Assembling native characters, skinning and equipped parts…" });
    runtimeBoundaryMocks.camera.mockImplementationOnce(() => {
      expect(registry.update).toHaveBeenCalledExactlyOnceWith(0); return runtimeBoundaryMocks.detachCamera;
    });
    release(); await pending;
    expect(completed).toHaveBeenCalledOnce(); expect(runtimeBoundaryMocks.camera).toHaveBeenCalledOnce();
    expect(window.__nativeSlice).toBeDefined();
  });

  it("rejects a native assembly failure and releases the unpublished world, UI and adapter", async () => {
    const source = mockSourceSectionWithRealTerrain(); runtimeBoundaryMocks.assembly.mockRejectedValueOnce(new Error("Native equipment failed"));
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow("Native equipment failed");
    expect(runtimeBoundaryMocks.registries[0]!.dispose).toHaveBeenCalledOnce(); expect(runtimeBoundaryMocks.uis[0]!.dispose).toHaveBeenCalledOnce();
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState()).toEqual([]); expect(source.ground.isDisposed()).toBe(true);
    expect(source.authored.isEnabled()).toBe(true); expect(runtimeBoundaryMocks.camera).not.toHaveBeenCalled();
    expect(runtimeBoundaryMocks.targeting).not.toHaveBeenCalled(); expect(window.__nativeSlice).toBeUndefined();
  });

  it.each([true, false])("rejects native catalog errors with requireWorld=%s instead of creating dummy entities", async requireWorld => {
    runtimeBoundaryMocks.load.mockRejectedValueOnce(new Error("Native catalog download failed"));
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal, { requireWorld }))
      .rejects.toThrow("Native catalog download failed");
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]); expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled();
    expect(harness.scene.meshes).toHaveLength(0); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rejects an incomplete native catalog before allocating runtime actors", async () => {
    runtimeBoundaryMocks.load.mockResolvedValueOnce({ models: new Map(), npcProfiles: new Map() });
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal)).rejects.toThrow("selected native character, Musveren or equipment");
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]); expect(runtimeBoundaryMocks.section).not.toHaveBeenCalled();
  });

  it.each(["missing", "failed"] as const)("rejects a %s world on the required browser route", async failure => {
    if (failure === "failed") runtimeBoundaryMocks.section.mockRejectedValueOnce(new Error("World source hash differs"));
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow(failure === "missing" ? "native world section is unavailable" : "World source hash differs");
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rejects missing native terrain materials instead of revealing neutral ground", async () => {
    const source = mockSourceSectionWithRealTerrain("Terrain layer texture failed");
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow("Native terrain materials failed: Terrain layer texture failed");
    expect(source.ground.isDisposed()).toBe(true); expect(source.authored.isEnabled()).toBe(true);
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]);
  });

  it.each(["prepare", "failed-state", "initial-update"] as const)("rejects flame %s failures on the required browser route", async failure => {
    const source = mockSourceSectionWithRealTerrain();
    if (failure === "prepare") runtimeBoundaryMocks.flames.mockRejectedValueOnce(new Error("Flame preparation failed"));
    else {
      const { owner, inspection } = presentationFixture();
      if (failure === "failed-state") { inspection.status = "failed"; inspection.failure = "Flame preparation failed"; }
      else owner.update.mockImplementationOnce(() => { throw new Error("Flame preparation failed"); });
    }
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow("Flame preparation failed");
    expect(source.ground.isDisposed()).toBe(true); expect(source.authored.isEnabled()).toBe(true);
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
  });

  it("loads source terrain into the main runtime, places actors at the surface candidate and restores the camera on cleanup", async () => {
    const codeBuiltMesh = MeshBuilder.CreateBox("Code-built presentation mesh", {}, harness.scene);
    const originalTarget = harness.camera.target.clone(), originalRadius = harness.camera.radius;
    let ground: ReturnType<typeof MeshBuilder.CreateGround>;
    const dispose = vi.fn(() => ground.dispose());
    runtimeBoundaryMocks.section.mockImplementationOnce(async () => {
      ground = MeshBuilder.CreateGround("Source terrain", { width: 20, height: 20 }, harness.scene);
      ground.position.set(210, -30, 790);
      return { manifest: { terrain: { sha256: "a".repeat(64) }, unsupportedRuntimeMaterials: [] }, terrainMeshes: [ground], spawnCandidate: new Vector3(210, -30, 790),
        minimum: new Vector3(200, -30, 780), maximum: new Vector3(220, -30, 800),
        manifestSha256: "a".repeat(64), dispose,
        inspection: () => ({ modelCount: 1, placementCount: 1, terrainTriangles: 2, collisionVerified: false }) };
    });
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    expect(codeBuiltMesh.isEnabled()).toBe(true);
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState()[0]!.position).toEqual({ x: 212, y: -27, z: 794 });
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState()[1]!.position).toEqual({ x: 213.4, y: -27, z: 794 });
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", world: {
      sourceSpawn: [21200, 79400, -2700], nativeLocationMatch: "unverified", collisionVerified: false,
    } });
    expect(runtimeBoundaryMocks.targeting.mock.calls[0]?.[3]).toBeDefined();
    expect(harness.camera.target.x).toBeCloseTo(212.6); expect(harness.camera.radius).toBe(originalRadius);
    expect(harness.camera.alpha).toBe(0); expect(harness.camera.beta).toBe(1);
    const adapter = runtimeBoundaryMocks.uis[0]!.adapter;
    adapter.dispatch({ type: "move-local", position: { x: 1000, y: -30, z: 1000 } });
    expect(adapter.getInitialState()[0]!.position).toEqual({ x: 212, y: -27, z: 794 });
    stop(); expect(dispose).toHaveBeenCalledTimes(1);
    expect(codeBuiltMesh.isEnabled()).toBe(true);
    expect(harness.camera.target).toEqual(originalTarget); expect(harness.camera.radius).toBe(originalRadius);
  });

  it("retains the authored inspection area when the staged world is rejected", async () => {
    const authored = MeshBuilder.CreateBox("Authored inspection floor", {}, harness.scene);
    runtimeBoundaryMocks.section.mockRejectedValueOnce(new Error("World source hash differs"));
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    expect(authored.isEnabled()).toBe(true);
    expect(runtimeBoundaryMocks.uis[0]!.adapter.getInitialState()[0]!.position).toEqual({ x: 2, y: 3, z: 4 });
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ nativeTerrain: "not-loaded-in-actor-scene", world: null });
  });
});

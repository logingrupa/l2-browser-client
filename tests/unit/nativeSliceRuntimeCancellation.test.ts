import { baseRuntimeSettings, emptyNativeCatalog, runtimeBoundaryMocks, useNativeSliceRuntimeHarness } from "../support/nativeSliceRuntimeHarness";
import { describe, expect, it, vi } from "vitest";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";

describe("native slice runtime cancellation and rollback", () => {
  const harness = useNativeSliceRuntimeHarness();
  const { stops, startRuntime } = harness;

  it("rejects late optional metadata after cancellation without reattaching UI or effects", async () => {
    const controller = new AbortController(); let release!: () => void, started!: () => void;
    const pendingMetadata = new Promise<void>(resolve => { started = resolve; });
    runtimeBoundaryMocks.effectBundle.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ manifestSha256: "a".repeat(64), manifest: { components: [], actors: [] } }); started();
    }));
    const pending = startRuntime(baseRuntimeSettings, controller.signal); await pendingMetadata;
    controller.abort(); release();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(runtimeBoundaryMocks.registries[0]!.dispose).toHaveBeenCalledOnce();
    expect(runtimeBoundaryMocks.camera).not.toHaveBeenCalled(); expect(window.__nativeSlice).toBeUndefined();
  });

  it.each(["abort", "scene"] as const)("immediately disposes pending actor assembly boundaries on %s cancellation", async lifetime => {
    let release!: () => void;
    runtimeBoundaryMocks.assembly.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController(), pending = startRuntime(baseRuntimeSettings, controller.signal);
    await vi.waitFor(() => expect(runtimeBoundaryMocks.assembly).toHaveBeenCalledOnce());
    const registry = runtimeBoundaryMocks.registries[0]!, ui = runtimeBoundaryMocks.uis[0]!;
    if (lifetime === "abort") controller.abort(); else harness.scene.dispose();
    expect(registry.dispose).toHaveBeenCalledOnce(); expect(ui.dispose).toHaveBeenCalledOnce();
    expect(ui.adapter.getInitialState()).toEqual([]); expect(runtimeBoundaryMocks.camera).not.toHaveBeenCalled();
    release();
    if (lifetime === "abort") await expect(pending).rejects.toHaveProperty("name", "AbortError");
    else await expect(pending).rejects.toThrow("scene was disposed during startup");
    expect(registry.dispose).toHaveBeenCalledOnce(); expect(ui.dispose).toHaveBeenCalledOnce();
    expect(window.__nativeSlice).toBeUndefined();
  });

  it("allocates no UI or registry when catalog completion loses a cancellation race", async () => {
    const aborted = new AbortController(); let resolve!: (value: { models: Map<string, unknown>; npcProfiles: Map<string, unknown> }) => void;
    runtimeBoundaryMocks.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const result = startRuntime(baseRuntimeSettings, aborted.signal);
    aborted.abort(); resolve({ models: new Map(), npcProfiles: new Map() });
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]); expect(runtimeBoundaryMocks.camera).not.toHaveBeenCalled();
  });

  it("rejects with the abort and allocates no UI or registry when cancellation lands while the catalog index loads NPC profiles", async () => {
    const pendingManifestSha256 = "b".repeat(64);
    runtimeBoundaryMocks.readCatalog.mockResolvedValueOnce({ ...emptyNativeCatalog, npcProfiles: [{ id: "native-npc-profiles",
      manifest: `/l2/npc-profiles/${pendingManifestSha256}/manifest.json`, manifestSha256: pendingManifestSha256, manifestBytes: 1 }] });
    let markProfileFetchStarted!: () => void;
    const profileFetchStarted = new Promise<void>(resolve => { markProfileFetchStarted = resolve; });
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      markProfileFetchStarted();
    })));
    const controller = new AbortController(), pending = startRuntime(baseRuntimeSettings, controller.signal);
    await profileFetchStarted;
    controller.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]); expect(runtimeBoundaryMocks.camera).not.toHaveBeenCalled();
  });

  it("fails before asset requests when the passed camera has been disposed", async () => {
    harness.camera.dispose();
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal)).rejects.toThrow("The native slice camera was disposed.");
    expect(runtimeBoundaryMocks.load).not.toHaveBeenCalled(); expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]);
  });

  it("does not attach to a scene disposed while catalog data is pending", async () => {
    let resolve!: (value: { models: Map<string, unknown>; npcProfiles: Map<string, unknown> }) => void;
    runtimeBoundaryMocks.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const result = startRuntime(baseRuntimeSettings, new AbortController().signal);
    harness.scene.dispose(); resolve({ models: new Map(), npcProfiles: new Map() });
    await expect(result).rejects.toThrow("scene was disposed during startup");
    expect(runtimeBoundaryMocks.uis).toEqual([]); expect(runtimeBoundaryMocks.registries).toEqual([]); expect(runtimeBoundaryMocks.camera).not.toHaveBeenCalled();
  });

  it.each(["abort", "scene"] as const)("releases a running runtime when its %s lifetime ends", async lifetime => {
    const controller = new AbortController(), stop = await startRuntime(baseRuntimeSettings, controller.signal); stops.push(stop);
    const ui = runtimeBoundaryMocks.uis[0]!, registry = runtimeBoundaryMocks.registries[0]!;
    if (lifetime === "abort") controller.abort(); else harness.scene.dispose();
    stop();
    expect(registry.dispose).toHaveBeenCalledTimes(1); expect(ui.dispose).toHaveBeenCalledTimes(1);
    expect(runtimeBoundaryMocks.detachCamera).toHaveBeenCalledTimes(1); expect(runtimeBoundaryMocks.detachTargeting).toHaveBeenCalledTimes(1);
    expect(ui.adapter.getInitialState()).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rolls back UI, adapter and registry when attaching the authored camera fails", async () => {
    runtimeBoundaryMocks.camera.mockImplementationOnce(() => { throw new Error("Camera attachment failed"); });
    const before = harness.scene.onBeforeRenderObservable.observers.length;
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal)).rejects.toThrow("Camera attachment failed");
    for (const registry of runtimeBoundaryMocks.registries) expect(registry.dispose).toHaveBeenCalledTimes(1);
    for (const ui of runtimeBoundaryMocks.uis) { expect(ui.dispose).toHaveBeenCalledTimes(1); expect(ui.adapter.getInitialState()).toEqual([]); }
    expect(harness.scene.onBeforeRenderObservable.observers.length).toBe(before);
    expect(window.__nativeSlice).toBeUndefined();
  });

  it("rolls back the camera too when a later targeting attachment fails", async () => {
    runtimeBoundaryMocks.targeting.mockImplementationOnce(() => { throw new Error("Targeting attachment failed"); });
    await expect(startRuntime(baseRuntimeSettings, new AbortController().signal)).rejects.toThrow("Targeting attachment failed");
    expect(runtimeBoundaryMocks.detachCamera).toHaveBeenCalledTimes(1);
    for (const registry of runtimeBoundaryMocks.registries) expect(registry.dispose).toHaveBeenCalledTimes(1);
    for (const ui of runtimeBoundaryMocks.uis) { expect(ui.dispose).toHaveBeenCalledTimes(1); expect(ui.adapter.getInitialState()).toEqual([]); }
    expect(window.__nativeSlice).toBeUndefined();
  });

  it("does not erase another runtime's diagnostics when the older owner stops", async () => {
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    const replacement = { snapshot: () => ({ entities: [], skinMeshes: [], nativeAttackReference: "unverified", nativeNpcProfile: null, nativeTerrain: "other scene", phase2Networking: false, worldFailure: null }), dispatch: vi.fn(), performance: vi.fn() };
    window.__nativeSlice = replacement;
    stop(); expect(window.__nativeSlice).toBe(replacement);
  });

  it("shares explicitly requested performance diagnostics and disposes them with the runtime", async () => {
    Object.assign(document, { visibilityState: "visible", hasFocus: () => true });
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    const diagnostics = window.__nativeSlice!;
    const before = harness.engine.onBeginFrameObservable.observers.length;
    const [first, second] = await Promise.all([diagnostics.performance(), diagnostics.performance()]);
    expect(first).toBe(second);
    expect(harness.engine.onBeginFrameObservable.observers.length).toBe(before);
    expect(first.inspect()).toMatchObject({ disposed: false, measuring: false });
    stop();
    expect(first.inspect()).toMatchObject({ disposed: true, measuring: false });
    await expect(diagnostics.performance()).rejects.toThrow("disposed");
  });

  it("does not create delayed diagnostics after the owning runtime stops", async () => {
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal); stops.push(stop);
    const pending = window.__nativeSlice!.performance();
    stop();
    await expect(pending).rejects.toThrow("disposed while loading diagnostics");
  });

  it("disposes a native section completing after runtime cancellation without hiding authored meshes", async () => {
    const authored = MeshBuilder.CreateBox("Authored inspection floor", {}, harness.scene), controller = new AbortController(), dispose = vi.fn();
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    runtimeBoundaryMocks.section.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ dispose }); started(); }));
    const pending = startRuntime(baseRuntimeSettings, controller.signal); await ready;
    controller.abort(); release();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(dispose).toHaveBeenCalledTimes(1); expect(authored.isEnabled()).toBe(true);
    expect(runtimeBoundaryMocks.uis).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { NativeSection, NativeSectionManifest } from "../../src/scene/world/loadNativeSection";
import { createNativeSliceRuntime, type NativeSliceSettings } from "../../src/runtime/createNativeSliceRuntime";
import { evaluateNativeFlameFade, selectNativeFlameFrame, type NativeFlameReplayTime } from "../../src/scene/world/nativeFlameMaterials";
import type { AssetImportOptions } from "../../src/ui/AssetImportPanel";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { isSceneSuspended, setSceneSuspended } from "../../src/engine/renderSuspension";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";

vi.mock("../../src/scene/world/loadNativeMovers", () => ({ loadNativeMovers: vi.fn(async () => null) }));

const boundaries = vi.hoisted(() => ({
  load: vi.fn(), assembly: vi.fn<() => Promise<void>>(), section: vi.fn(), flames: vi.fn(), camera: vi.fn(), targeting: vi.fn(), detachCamera: vi.fn(), detachTargeting: vi.fn(),
  assetImport: vi.fn(), detachAssetImport: vi.fn(), audioControls: vi.fn(), factory: vi.fn(), effectBundle: vi.fn(),
  uis: [] as { adapter: NativeSliceAdapter; dispose: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; showStatus: ReturnType<typeof vi.fn> }[],
  registries: [] as { dispose: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }[],
}));
vi.mock("../../src/assets/native/loadNativeCatalog", () => ({ loadNativeActorCatalog: boundaries.load }));
vi.mock("../../src/effects/nativeEffectComponents", () => ({ loadNativeEffectComponents: boundaries.effectBundle }));
vi.mock("../../src/ui/nativeEffectComponentControls", () => ({ attachNativeEffectComponentControls: () => ({ dispose() {} }) }));
vi.mock("../../src/ui/nativeEffectInitControls", () => ({ attachNativeEffectInitControls: () => ({ dispose() {} }) }));
vi.mock("../../src/scene/world/nativeFlamePresentation", () => ({ createNativeFlamePresentation: boundaries.flames }));
vi.mock("../../src/scene/world/nativeSkyPresentation", () => ({ createNativeSkyPresentation: async () => null }));
vi.mock("../../src/audio/worldAudioControls", () => ({ attachWorldAudioControls: boundaries.audioControls }));
vi.mock("../../src/audio/nativeFootstepControls", () => ({ attachNativeFootstepControls: () => ({ dispose() {}, refresh() {}, describe: () => [] }) }));
vi.mock("../../src/audio/nativeCombatAudioControls", () => ({ attachNativeCombatAudioControls: () => ({ update() {}, dispose() {}, describe: () => [], cards: () => [] }) }));
vi.mock("../../src/ui/nativePowerStrikeControls", () => ({ attachNativePowerStrikeControls: () => ({ dispose() {} }) }));
vi.mock("../../src/ui/nativeLocomotionControls", () => ({ attachNativeLocomotionControls: () => ({ dispose() {} }) }));
vi.mock("../../src/ui/AssetImportPanel", () => ({ attachAssetImport: boundaries.assetImport }));
vi.mock("../../src/scene/world/loadNativeSection", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/scene/world/loadNativeSection")>(), loadNativeSection: boundaries.section,
}));
vi.mock("../../src/camera/WorldCamera", () => ({ attachWorldCamera: boundaries.camera }));
vi.mock("../../src/entities/attachTargeting", () => ({ attachTargeting: boundaries.targeting }));
vi.mock("../../src/assets/native/NativeCharacterVisual", () => ({ nativeCharacterFactory: boundaries.factory }));
vi.mock("../../src/ui/WorldInterface", () => ({ WorldInterface: class {
  readonly labels = {}; readonly dispose = vi.fn(); readonly update = vi.fn(); readonly showStatus = vi.fn();
  // HUD hooks: sound cue, gait toggle and status clearing (WorldInterface).
  readonly clearStatus = vi.fn(); readonly watchSound = vi.fn(() => () => {}); readonly bindGait = vi.fn(() => () => {});
  readonly root = { querySelector: () => ({ append() {}, remove() {}, after() {}, setAttribute() {}, addEventListener() {}, textContent: "" }) };
  // Developer sheet boundary: groups host plain DOM; hover-cards are inert here.
  readonly sheet = (() => {
    const node = () => Object.assign(new EventTarget(), { dataset: {}, disabled: false, hidden: false, textContent: "",
      append() {}, remove() {}, after() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
    const group = () => ({ element: node(), button: node, note: node, readout: () => ({ element: node(), output: node(), refresh() {} }) });
    return { section: () => ({ group }), describe: () => () => {}, inspect: () => ({ open: false }) };
  })();
  constructor(readonly adapter: NativeSliceAdapter) { boundaries.uis.push(this); }
} }));
vi.mock("../../src/entities/EntityRegistry", () => ({ EntityRegistry: class {
  readonly dispose = vi.fn(); readonly update = vi.fn(); readonly snapshot = () => [];
  readonly whenReady = boundaries.assembly;
  constructor() { boundaries.registries.push(this); }
} }));

/** UI and camera attachment are controlled boundaries here. The actual scene,
 * observer lifetime and synthetic adapter run normally; rendering is covered
 * by the browser tests and native visual's real-loader integration suite. */
describe("native slice runtime lifetime", () => {
  let engine: NullEngine, scene: Scene, stops: (() => void)[];
  const settings: NativeSliceSettings = { origin: new Vector3(2, 3, 4), leatherShirt: true,
    fighterIdle: "Wait", fighterRun: "Run", fighterAttack: "Attack", fighterDeath: "Death" };
  beforeEach(() => {
    boundaries.uis.length = 0; boundaries.registries.length = 0;
    boundaries.load.mockReset(); boundaries.section.mockReset(); boundaries.flames.mockReset(); boundaries.camera.mockReset(); boundaries.targeting.mockReset();
    boundaries.assembly.mockReset().mockResolvedValue(undefined);
    boundaries.effectBundle.mockReset().mockResolvedValue(null);
    boundaries.detachCamera.mockReset(); boundaries.detachTargeting.mockReset();
    boundaries.detachAssetImport.mockReset(); boundaries.assetImport.mockReset().mockReturnValue(boundaries.detachAssetImport);
    boundaries.audioControls.mockReset().mockReturnValue({ update() {}, dispose() {}, describe: () => [], cards: () => [], setWorldAudio() {} });
    boundaries.factory.mockReset().mockReturnValue(() => undefined);
    boundaries.load.mockResolvedValue({ models: new Map([["human-male-fighter:0", {}], ["musveren:0", { manifest: { source: { object: "Native.Musveren" } } }], ["fighter-equipment:0", {}]]),
      npcProfiles: new Map([["npc:21622", { id: "npc:21622", npcId: 21622, mesh: "Native.Musveren", collisionHeight: 36, sourceUnitsPerMetre: 100, drawScale: 1.2, drawScale3D: [1, 1, 1] }]]) });
    boundaries.section.mockResolvedValue(null);
    boundaries.flames.mockImplementation(async () => ({ validateReplayTime: vi.fn(), update: vi.fn(), inspect: () => ({ status: "not-present", failure: null }), dispose: vi.fn() }));
    boundaries.camera.mockReturnValue(boundaries.detachCamera); boundaries.targeting.mockReturnValue(boundaries.detachTargeting);
    engine = new NullEngine(); scene = new Scene(engine); stops = [];
    new ArcRotateCamera("World camera", 0, 1, 5, Vector3.Zero(), scene);
    vi.spyOn(engine, "getRenderingCanvas").mockReturnValue(new EventTarget() as HTMLCanvasElement);
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { createElement: () => Object.assign(new EventTarget(), { dataset: {} }) }));
  });
  afterEach(() => { for (const stop of stops) stop(); scene.dispose(); engine.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("keeps the required world playable when optional effect metadata fails", async () => {
    sourceWorld(); boundaries.effectBundle.mockRejectedValueOnce(new Error("Effect manifest hash differs"));
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal, { requireWorld: true }));
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ effectComponents: null,
      effectComponentFailure: "Effect manifest hash differs", worldFailure: null, nativeTerrain: "source-section-loaded" });
    expect(boundaries.registries[0]!.dispose).not.toHaveBeenCalled();
  });

  it("disposes the optional component owner before releasing character anchors", async () => {
    boundaries.effectBundle.mockResolvedValueOnce({ manifestSha256: "a".repeat(64), manifest: { components: [], actors: [] } });
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const diagnostics = window.__nativeSlice!;
    expect(diagnostics.snapshot().effectComponents).toMatchObject({ status: "off", loaded: null });
    boundaries.registries[0]!.dispose.mockImplementationOnce(() => {
      expect(diagnostics.snapshot().effectComponents).toMatchObject({ status: "disposed", loaded: null });
    });
    stop(); expect(boundaries.registries[0]!.dispose).toHaveBeenCalledOnce();
  });

  it("rejects late optional metadata after cancellation without reattaching UI or effects", async () => {
    const controller = new AbortController(); let release!: () => void, started!: () => void;
    const pendingMetadata = new Promise<void>(resolve => { started = resolve; });
    boundaries.effectBundle.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ manifestSha256: "a".repeat(64), manifest: { components: [], actors: [] } }); started();
    }));
    const pending = createNativeSliceRuntime(scene, settings, controller.signal); await pendingMetadata;
    controller.abort(); release();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(boundaries.registries[0]!.dispose).toHaveBeenCalledOnce();
    expect(boundaries.camera).not.toHaveBeenCalled(); expect(window.__nativeSlice).toBeUndefined();
  });

  /** Real saved-world adapter/navigation, with only UI/actor loading mocked. */
  function authoredWorld(rootZ: -1 | 1 = -1) {
    scene.useRightHandedSystem = true;
    const hash = "a".repeat(64), sourceMatrix = [...Matrix.Translation(214, -29, 795).asArray()];
    const manifest: NativeSectionManifest = {
      schemaVersion: 1, kind: "native-map-section-runtime", support: "section-products-ready-for-runtime-validation", errors: [], gaps: [],
      resourceRoots: { terrain: "../map-section", models: "../map-section-models" },
      terrain: { file: "terrain.glb", sha256: hash, bytes: 100, materialStatus: "authored" },
      models: [{ id: "interlude:Fixture.Tree", sourceObject: "Fixture.Tree", model: { file: `${hash}/model.glb`, sha256: hash, bytes: 100 },
        archive: { file: `${hash}/asset.l2asset`, sha256: hash, bytes: 100 } }],
      placements: [{ id: "source-tree", modelId: "interlude:Fixture.Tree", sourceMesh: "Fixture.Tree", matrix: sourceMatrix, materialOverrides: [] }],
      surfaceSpawnCandidate: { sourcePosition: [21000, 79000, -3000], gltfGroundPosition: [210, -30, 790], nativeSpawnVerified: false, collisionVerified: false },
    };
    const root = new TransformNode("Saved world", scene); root.scaling.z = rootZ;
    root.metadata = { nativeWorldRoot: { schemaVersion: 1, manifestSha256: hash, manifest } };
    const ground = MeshBuilder.CreateGround("Saved native terrain", { width: 20, height: 20 }, scene);
    ground.parent = root; ground.position.set(210, -30, 790); ground.metadata = { worldTerrain: true, worldSupportsWalking: true };
    const placement = new TransformNode("Saved source placement", scene); placement.parent = root;
    placement.metadata = { nativePlacement: structuredClone(manifest.placements[0]) }; placement.setPreTransformMatrix(Matrix.FromArray(sourceMatrix));
    placement.position.x = .5;
    const tree = MeshBuilder.CreateBox("Saved tree", {}, scene); tree.parent = placement;
    const material = new StandardMaterial("Authored material", scene); ground.material = material; tree.material = material;
    const hidden = MeshBuilder.CreateBox("Authored hidden helper", {}, scene); hidden.setEnabled(false);
    const camera = scene.getCameraByName("World camera") as ArcRotateCamera;
    camera.alpha = .72; camera.beta = 1.2; camera.radius = 7;
    camera.setTarget(new Vector3(214, -25, 789 * rootZ), false, false, true);
    const cameraBefore = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone(),
      minZ: camera.minZ, maxZ: camera.maxZ, upperRadiusLimit: camera.upperRadiusLimit };
    return { root, ground, tree, hidden, placement, material, camera, cameraBefore, manifest };
  }

  function expectAuthoredCamera(camera: ArcRotateCamera, expected: ReturnType<typeof authoredWorld>["cameraBefore"]) {
    expect(camera.alpha).toBe(expected.alpha); expect(camera.beta).toBe(expected.beta); expect(camera.radius).toBe(expected.radius);
    expect(camera.target).toEqual(expected.target); expect(camera.minZ).toBe(expected.minZ); expect(camera.maxZ).toBe(expected.maxZ);
    expect(camera.upperRadiusLimit).toBe(expected.upperRadiusLimit);
  }

  /** Real terrain support with a controlled section/presentation boundary. */
  function sourceWorld(materialFailure?: string) {
    const authored = MeshBuilder.CreateBox("Retained inspection floor", {}, scene);
    let ground!: ReturnType<typeof MeshBuilder.CreateGround>;
    let lifetime: AbortSignal;
    const dispose = () => { lifetime.removeEventListener("abort", dispose); ground.dispose(); };
    boundaries.section.mockImplementationOnce(async (_scene: Scene, signal: AbortSignal) => {
      lifetime = signal;
      ground = MeshBuilder.CreateGround("Source terrain", { width: 20, height: 20 }, scene); ground.position.set(210, -30, 790);
      // Match the real section's earlier subscription: runtime must release its
      // dependent presentation before allowing this signal to dispose geometry.
      signal.addEventListener("abort", dispose, { once: true });
      return { manifest: { terrain: { sha256: "a".repeat(64) }, unsupportedRuntimeMaterials: [] }, terrainMeshes: [ground], spawnCandidate: new Vector3(210, -30, 790),
        minimum: new Vector3(200, -30, 780), maximum: new Vector3(220, -30, 800), manifestSha256: "a".repeat(64), dispose,
        setTerrainPreview: vi.fn(), inspection: () => ({ modelCount: 1, placementCount: 1, terrainTriangles: 2, collisionVerified: false,
          ...materialFailure ? { materialFailure } : {} }) };
    });
    return { authored, get ground() { return ground; }, dispose };
  }

  function presentationFixture(order: string[] = []) {
    const inspection = { status: "ready" as "ready" | "failed" | "aborted", failure: null as string | null, bindings: 24 };
    const owner = { validateReplayTime: vi.fn((time: NativeFlameReplayTime) => {
      selectNativeFlameFrame(time.textureSeconds, { maxFrameRate: 30, totalFrameNum: 16 });
      evaluateNativeFlameFade(time.fadeSeconds, { object: "FX_E_T.Flameset.FadeColor0", colorFadeType: 1, fadePeriod: Math.fround(.4), fadePhase: 1,
        color1: { bgraHex: "151b3100", rgbaBytes: [49, 27, 21, 0] }, color2: { bgraHex: "2e437c00", rgbaBytes: [124, 67, 46, 0] } });
    }), update: vi.fn(), inspect: vi.fn(() => inspection), dispose: vi.fn(() => { order.push("flames"); }) };
    boundaries.flames.mockImplementationOnce(async (_scene: Scene, section: NativeSection) => {
      const release = section.dispose.bind(section);
      vi.spyOn(section, "dispose").mockImplementation(() => { order.push("section"); release(); });
      return owner;
    });
    return { owner, inspection };
  }

  it.each(["source", "authored"] as const)("feeds independent uncapped flame clocks while actors retain their capped step in the %s world", async path => {
    if (path === "source") sourceWorld(); else authoredWorld();
    const { owner, inspection } = presentationFixture(), controller = new AbortController();
    const replay = { ...settings, flameTextureSeconds: 2.25, flameFadeSeconds: 8.5, flameTextureRate: 3, flameFadeRate: 0.25 };
    const stop = await createNativeSliceRuntime(scene, replay, controller.signal); stops.push(stop);
    expect(boundaries.flames).toHaveBeenCalledExactlyOnceWith(scene, expect.objectContaining({ spawnCandidate: expect.any(Vector3) }), expect.any(AbortSignal));
    expect((boundaries.flames.mock.calls[0]![2] as AbortSignal).aborted).toBe(false);
    expect(boundaries.section).toHaveBeenCalledTimes(path === "source" ? 1 : 0);
    expect(owner.update.mock.calls[0]![0]).toEqual({ textureSeconds: 2.25, fadeSeconds: 8.5 });
    const ui = boundaries.uis[0]!, registry = boundaries.registries[0]!, adapterAdvance = vi.spyOn(ui.adapter, "advance");
    vi.mocked(engine.getDeltaTime).mockReturnValue(2500); scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(adapterAdvance).toHaveBeenLastCalledWith(0.1); expect(registry.update).toHaveBeenLastCalledWith(0.1);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 9.75, fadeSeconds: 9.125 });
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeFlames: inspection, flameFailure: null, flameReplay: {
      textureSeconds: 9.75, fadeSeconds: 9.125, textureRate: 3, fadeRate: 0.25, nativeSynchronization: "unverified",
    } });
    const oldTarget = owner.update.mock.lastCall![1], camera = scene.getCameraByName("World camera") as ArcRotateCamera;
    ui.adapter.dispatch({ type: "set-paused", isPaused: true }); camera.alpha += 0.3;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(adapterAdvance).toHaveBeenCalledTimes(1); expect(registry.update).toHaveBeenLastCalledWith(0);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 9.75, fadeSeconds: 9.125 });
    expect(owner.update.mock.lastCall![1]).not.toEqual(oldTarget);
    expect(owner.update.mock.lastCall![1]).toEqual([camera.globalPosition.x * 100, camera.globalPosition.z * 100, camera.globalPosition.y * 100]);
    window.__nativeSlice!.setFlameReplay!({ textureSeconds: 11, fadeSeconds: 0.6 });
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 11, fadeSeconds: 0.6 });
    ui.adapter.dispatch({ type: "set-paused", isPaused: false }); vi.mocked(engine.getDeltaTime).mockReturnValue(200);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 11.6, fadeSeconds: 0.65 });
    expect(adapterAdvance).toHaveBeenLastCalledWith(0.1); expect(registry.update).toHaveBeenLastCalledWith(0.1);
  });

  it("keeps a valid world and the previous replay time after rejected seeks", async () => {
    sourceWorld(); const { owner } = presentationFixture();
    stops.push(await createNativeSliceRuntime(scene, { ...settings, flameTextureSeconds: 5, flameFadeSeconds: 8 }, new AbortController().signal));
    const previous = window.__nativeSlice!.snapshot().flameReplay, calls = owner.update.mock.calls.length;
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: -1, fadeSeconds: 0 })).toThrow("finite and nonnegative");
    expect(owner.update).toHaveBeenCalledTimes(calls); expect(window.__nativeSlice!.snapshot().flameReplay).toEqual(previous);
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: 1e100, fadeSeconds: 30 })).toThrow("signed-int truncation");
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: 12, fadeSeconds: 1e100 })).toThrow("finite binary32");
    expect(owner.update).toHaveBeenCalledTimes(calls); expect(window.__nativeSlice!.snapshot().flameReplay).toEqual(previous); expect(owner.dispose).not.toHaveBeenCalled();
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(owner.update.mock.lastCall![0]).toEqual({ textureSeconds: 6, fadeSeconds: 9 });
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, flameFailure: null });
  });

  it("reports an actual seek update failure immediately without waiting for another frame", async () => {
    sourceWorld(); const { owner, inspection } = presentationFixture();
    const elements: (EventTarget & { id?: string; hidden?: boolean; textContent?: string })[] = [];
    vi.stubGlobal("document", Object.assign(new EventTarget(), { createElement: () => { const element = Object.assign(new EventTarget(), { dataset: {} }); elements.push(element); return element; } }));
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    owner.update.mockImplementationOnce(() => { inspection.status = "failed"; inspection.failure = "Shader update failed"; });
    expect(() => window.__nativeSlice!.setFlameReplay!({ textureSeconds: 12, fadeSeconds: 30 })).toThrow("Shader update failed");
    expect(owner.dispose).toHaveBeenCalledOnce();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeFlames: null, flameFailure: "Shader update failed", worldFailure: null, nativeTerrain: "source-section-loaded" });
    expect(elements.find(element => element.id === "native-flame-status")).toMatchObject({ hidden: false, textContent: "Shader update failed World and saved materials retained." });
    const calls = owner.update.mock.calls.length; scene.onBeforeRenderObservable.notifyObservers(scene); expect(owner.update).toHaveBeenCalledTimes(calls);
  });

  it.each(["source", "authored"] as const)("passes disabled preview intent through without creating a presentation in the %s world", async path => {
    if (path === "source") sourceWorld(); else authoredWorld();
    stops.push(await createNativeSliceRuntime(scene, { ...settings, flamePreviewEnabled: false, flameTextureRate: NaN }, new AbortController().signal));
    expect(boundaries.flames).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameReplay: null, flameFailure: null });
  });

  it("releases a not-present presentation and omits its replay diagnostics", async () => {
    sourceWorld();
    const owner = { update: vi.fn(), inspect: () => ({ status: "not-present", failure: null }), dispose: vi.fn() };
    boundaries.flames.mockResolvedValueOnce(owner);
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(owner.update).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", nativeFlames: null, flameReplay: null, flameFailure: null });
    stop(); expect(owner.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports invalid replay settings without losing a valid world or preparing flame assets", async () => {
    sourceWorld();
    stops.push(await createNativeSliceRuntime(scene, { ...settings, flameFadeRate: -1 }, new AbortController().signal));
    expect(boundaries.flames).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameReplay: null });
    expect(window.__nativeSlice!.snapshot().flameFailure).toContain("fadeRate must be finite and nonnegative");
  });

  it.each(["source", "authored"] as const)("contains initial flame-update failures within the valid %s world", async path => {
    if (path === "source") sourceWorld(); else authoredWorld();
    const { owner } = presentationFixture(); owner.update.mockImplementationOnce(() => { throw new Error("Flame initial update failed"); });
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const section = boundaries.flames.mock.calls[0]![1] as NativeSection;
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).not.toHaveBeenCalled(); expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameFailure: "Flame initial update failed" });
    expect(boundaries.uis[0]!.showStatus).toHaveBeenLastCalledWith("Flame initial update failed World and saved materials retained.");
    scene.onBeforeRenderObservable.notifyObservers(scene); expect(boundaries.registries[0]!.update).toHaveBeenLastCalledWith(0.1);
    expect(owner.update).toHaveBeenCalledTimes(1); stop(); expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["source", "authored"] as const)("retains the %s world after a presentation-local aborted load", async path => {
    if (path === "source") sourceWorld(); else authoredWorld();
    boundaries.flames.mockRejectedValueOnce(new DOMException("Flame asset load aborted", "AbortError"));
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    const section = boundaries.flames.mock.calls[0]![1] as NativeSection;
    expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameFailure: "Flame asset load aborted" });
    scene.onBeforeRenderObservable.notifyObservers(scene); expect(boundaries.registries[0]!.update).toHaveBeenLastCalledWith(0.1);
  });

  it.each(["source", "authored"] as const)("stops failed flame frames without disposing the valid %s world or actor loop", async path => {
    if (path === "source") sourceWorld(); else authoredWorld();
    const { owner } = presentationFixture();
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const section = boundaries.flames.mock.calls[0]![1] as NativeSection;
    owner.update.mockImplementationOnce(() => { throw new Error("Flame frame failed"); });
    expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).not.toHaveBeenCalled();
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", worldFailure: null, nativeFlames: null, flameFailure: "Flame frame failed" });
    expect(boundaries.uis[0]!.showStatus).toHaveBeenLastCalledWith("Flame frame failed World and saved materials retained.");
    scene.onBeforeRenderObservable.notifyObservers(scene); expect(owner.update).toHaveBeenCalledTimes(2);
    expect(boundaries.registries[0]!.update).toHaveBeenCalledTimes(3); expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    stop(); expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["source", "preparation", "failed"], ["source", "preparation", "aborted"], ["source", "frame", "failed"], ["source", "frame", "aborted"],
    ["authored", "preparation", "failed"], ["authored", "preparation", "aborted"], ["authored", "frame", "failed"], ["authored", "frame", "aborted"],
  ] as const)("retains the %s world when presentation %s reports %s without throwing", async (path, phase, status) => {
    if (path === "source") sourceWorld(); else authoredWorld();
    const { owner, inspection } = presentationFixture();
    const fail = () => { inspection.status = status; inspection.failure = `Presentation ${status} during ${phase}`; };
    if (phase === "preparation") fail();
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    if (phase === "frame") { fail(); scene.onBeforeRenderObservable.notifyObservers(scene); }
    const section = boundaries.flames.mock.calls[0]![1] as NativeSection;
    expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).not.toHaveBeenCalled();
    expect(owner.update).toHaveBeenCalledTimes(phase === "preparation" ? 0 : 2);
    expect(window.__nativeSlice!.snapshot()).toMatchObject({ worldFailure: null, nativeTerrain: "source-section-loaded", nativeFlames: null, flameFailure: inspection.failure });
    const calls = owner.update.mock.calls.length; scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(owner.update).toHaveBeenCalledTimes(calls); expect(section.terrainMeshes[0]!.isDisposed()).toBe(false);
    expect(boundaries.registries[0]!.update).toHaveBeenLastCalledWith(0.1);
    stop(); expect(owner.dispose).toHaveBeenCalledTimes(1); expect(section.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["source", "stop"], ["source", "abort"], ["source", "startup-failure"],
    ["authored", "stop"], ["authored", "abort"], ["authored", "startup-failure"],
  ] as const)("releases flame presentation before the %s section on %s", async (path, end) => {
    const authored = path === "authored" ? authoredWorld() : undefined, source = path === "source" ? sourceWorld() : undefined;
    const order: string[] = [], { owner } = presentationFixture(order), controller = new AbortController();
    const atRelease: { groundDisposed: boolean; authoredZ: number | undefined }[] = [];
    owner.dispose.mockImplementation(() => {
      order.push("flames");
      atRelease.push({ groundDisposed: (boundaries.flames.mock.calls[0]![1] as NativeSection).terrainMeshes[0]!.isDisposed(), authoredZ: authored?.root.scaling.z });
    });
    if (end === "startup-failure") {
      boundaries.targeting.mockImplementationOnce(() => { throw new Error("Failure after presentation attachment"); });
      await expect(createNativeSliceRuntime(scene, settings, controller.signal)).rejects.toThrow("Failure after presentation attachment");
    } else {
      const stop = await createNativeSliceRuntime(scene, settings, controller.signal); stops.push(stop);
      if (end === "abort") controller.abort(); else stop(); stop();
    }
    expect(order).toEqual(["flames", "section"]); expect(owner.dispose).toHaveBeenCalledTimes(1);
    expect(atRelease).toEqual([{ groundDisposed: false, authoredZ: authored ? 1 : undefined }]);
    if (authored) { expect(authored.root.scaling.z).toBe(-1); expect(authored.ground.isDisposed()).toBe(false); expect(authored.ground.material).toBe(authored.material); }
    if (source) { expect(source.ground.isDisposed()).toBe(true); expect(source.authored.isEnabled()).toBe(true); }
    expect(window.__nativeSlice).toBeUndefined();
  });

  it.each(["source", "authored"] as const)("releases a late flame owner before the %s section when startup is cancelled", async path => {
    const authored = path === "authored" ? authoredWorld() : undefined, source = path === "source" ? sourceWorld() : undefined;
    const controller = new AbortController(), order: string[] = [], owner = { update: vi.fn(), inspect: () => null, dispose: vi.fn(() => { order.push("flames"); }) };
    let release!: () => void, begin!: () => void, presentationSignal!: AbortSignal; const started = new Promise<void>(resolve => { begin = resolve; });
    const atPresentationAbort: { groundDisposed: boolean; authoredZ: number | undefined }[] = [];
    boundaries.flames.mockImplementationOnce((_scene: Scene, section: NativeSection, received: AbortSignal) => {
      presentationSignal = received; expect(received.aborted).toBe(false); const original = section.dispose.bind(section);
      received.addEventListener("abort", () => atPresentationAbort.push({ groundDisposed: section.terrainMeshes[0]!.isDisposed(), authoredZ: authored?.root.scaling.z }), { once: true });
      vi.spyOn(section, "dispose").mockImplementation(() => { order.push("section"); original(); });
      return new Promise(resolve => { release = () => resolve(owner); begin(); });
    });
    const pending = createNativeSliceRuntime(scene, settings, controller.signal); await started; controller.abort(); expect(presentationSignal.aborted).toBe(true); release();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(atPresentationAbort).toEqual([{ groundDisposed: false, authoredZ: authored ? 1 : undefined }]);
    expect(order).toEqual(["flames", "section"]); expect(owner.update).not.toHaveBeenCalled(); expect(boundaries.uis).toEqual([]);
    if (authored) { expect(authored.root.scaling.z).toBe(-1); expect(authored.ground.isDisposed()).toBe(false); }
    if (source) { expect(source.ground.isDisposed()).toBe(true); expect(source.authored.isEnabled()).toBe(true); }
  });

  it("advances the adapter and visual clock together, pauses both, and releases each boundary exactly once", async () => {
    const before = scene.onBeforeRenderObservable.observers.length;
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const ui = boundaries.uis[0]!, registry = boundaries.registries[0]!;
    expect(ui.adapter.getInitialState()[0]).toMatchObject({ position: { x: 2, y: 3, z: 4 }, equipment: { upper: 22 } });
    ui.adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    scene.onBeforeRenderObservable.notifyObservers(scene);
    // aCis walk speed 80 UU/s ÷ 100 for the first 0.4 s of a run: 0.1 s → 0.08 m.
    expect(ui.adapter.getInitialState()[0]!.position.x).toBeCloseTo(2.08);
    expect(registry.update).toHaveBeenLastCalledWith(.1);
    ui.adapter.dispatch({ type: "set-paused", isPaused: true }); scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(registry.update).toHaveBeenCalledTimes(3); expect(registry.update).toHaveBeenLastCalledWith(0);
    expect(ui.adapter.getInitialState()[0]!.position.x).toBeCloseTo(2.08); expect(ui.update).toHaveBeenCalledTimes(2);
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ nativeAttackReference: "unverified", phase2Networking: false });
    stop(); stop();
    expect(boundaries.detachCamera).toHaveBeenCalledTimes(1); expect(boundaries.detachTargeting).toHaveBeenCalledTimes(1);
    expect(registry.dispose).toHaveBeenCalledTimes(1); expect(ui.dispose).toHaveBeenCalledTimes(1);
    expect(ui.adapter.getInitialState()).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
    await vi.waitFor(() => expect(scene.onBeforeRenderObservable.observers.length).toBe(before));
  });

  it.each(["source", "authored"] as const)("opens package inspection from %s world controls without advancing or changing the world", async route => {
    if (route === "source") sourceWorld(); else authoredWorld();
    const { owner } = presentationFixture();
    const stopVoices = vi.spyOn(WorldAudioMixer.prototype, "stopAll");
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    expect(boundaries.assetImport).toHaveBeenCalledWith(scene, engine.getRenderingCanvas(), expect.objectContaining({
      host: expect.anything(), onOpenChange: expect.any(Function),
    }));
    const options = boundaries.assetImport.mock.calls[0]![2] as AssetImportOptions;
    const ui = boundaries.uis[0]!, registry = boundaries.registries[0]!, adapterAdvance = vi.spyOn(ui.adapter, "advance");
    const audio = boundaries.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    const meshes = [...scene.meshes], materials = [...scene.materials], nodes = [...scene.transformNodes];
    ui.adapter.dispatch({ type: "move-local", position: { x: 213, y: -30, z: 794 } });
    const entities = structuredClone(ui.adapter.getInitialState());
    const registryCalls = registry.update.mock.calls.length, flameCalls = owner.update.mock.calls.length, uiCalls = ui.update.mock.calls.length;
    options.onOpenChange!(true);
    expect(isSceneSuspended(scene)).toBe(true); expect(ui.adapter.isPaused).toBe(false);
    expect(audio.inspection().paused).toBe(true); expect(stopVoices).toHaveBeenCalled();
    // EngineHost skips scene.render while suspended. The observer guard also
    // covers callers such as Editor Play that may still request a scene frame.
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(adapterAdvance).not.toHaveBeenCalled(); expect(registry.update).toHaveBeenCalledTimes(registryCalls);
    expect(owner.update).toHaveBeenCalledTimes(flameCalls); expect(ui.update).toHaveBeenCalledTimes(uiCalls);
    expect(ui.adapter.getInitialState()).toEqual(entities);
    expect(scene.meshes).toEqual(meshes); expect(scene.materials).toEqual(materials); expect(scene.transformNodes).toEqual(nodes);
    options.onOpenChange!(false);
    expect(isSceneSuspended(scene)).toBe(false); expect(audio.inspection().paused).toBe(false);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(adapterAdvance).toHaveBeenCalledExactlyOnceWith(.1); expect(registry.update).toHaveBeenLastCalledWith(.1);
    expect(owner.update).toHaveBeenCalledTimes(flameCalls + 1); expect(ui.update).toHaveBeenCalledTimes(uiCalls + 1);
  });

  it.each([false, true])("retains explicit pause=%s and audio settings through repeated inspector notifications", async paused => {
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    const ui = boundaries.uis[0]!, audio = boundaries.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    const options = boundaries.assetImport.mock.calls[0]![2] as AssetImportOptions;
    ui.adapter.dispatch({ type: "set-paused", isPaused: paused });
    audio.setMuted(true); audio.setVolume(.35);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const dispatch = vi.spyOn(ui.adapter, "dispatch");
    options.onOpenChange!(true); options.onOpenChange!(true);
    expect(ui.adapter.isPaused).toBe(paused); expect(isSceneSuspended(scene)).toBe(true);
    expect(audio.inspection()).toMatchObject({ paused: true, muted: true, volume: .35 });
    options.onOpenChange!(false); options.onOpenChange!(false);
    expect(ui.adapter.isPaused).toBe(paused); expect(isSceneSuspended(scene)).toBe(false);
    expect(audio.inspection()).toMatchObject({ paused, muted: true, volume: .35 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("restores the user's current pause choice if it changes while the inspector is open", async () => {
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    const ui = boundaries.uis[0]!, audio = boundaries.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    const options = boundaries.assetImport.mock.calls[0]![2] as AssetImportOptions;
    for (const paused of [true, false]) {
      options.onOpenChange!(true);
      ui.adapter.dispatch({ type: "set-paused", isPaused: paused });
      expect(audio.inspection().paused).toBe(true);
      options.onOpenChange!(false);
      expect(ui.adapter.isPaused).toBe(paused); expect(audio.inspection().paused).toBe(paused);
      expect(isSceneSuspended(scene)).toBe(false);
    }
  });

  it("preserves an existing scene suspension when the inspector closes", async () => {
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    const options = boundaries.assetImport.mock.calls[0]![2] as AssetImportOptions;
    const ui = boundaries.uis[0]!, registry = boundaries.registries[0]!, audio = boundaries.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    setSceneSuspended(scene, true);
    options.onOpenChange!(true); options.onOpenChange!(false);
    expect(isSceneSuspended(scene)).toBe(true); expect(ui.adapter.isPaused).toBe(false);
    expect(audio.inspection().paused).toBe(true);
    const previous = registry.update.mock.calls.length;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(registry.update).toHaveBeenCalledTimes(previous);
    setSceneSuspended(scene, false);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(registry.update).toHaveBeenLastCalledWith(.1); expect(audio.inspection().paused).toBe(false);
  });

  it.each(["stop", "abort", "scene"] as const)("restores inspector suspension on %s without depending on a close notification", async lifetime => {
    const controller = new AbortController(), stop = await createNativeSliceRuntime(scene, settings, controller.signal); stops.push(stop);
    const options = boundaries.assetImport.mock.calls[0]![2] as AssetImportOptions;
    const audio = boundaries.audioControls.mock.calls[0]![1] as WorldAudioMixer;
    options.onOpenChange!(true);
    expect(isSceneSuspended(scene)).toBe(true);
    if (lifetime === "abort") controller.abort(); else if (lifetime === "scene") scene.dispose(); else stop();
    stop();
    expect(boundaries.detachAssetImport).toHaveBeenCalledTimes(1);
    expect(isSceneSuspended(scene)).toBe(false); expect(audio.inspection().state).toBe("disposed");
    expect(boundaries.registries[0]!.dispose).toHaveBeenCalledTimes(1); expect(boundaries.uis[0]!.dispose).toHaveBeenCalledTimes(1);
    // Detached/in-flight UI work cannot re-suspend a released runtime.
    options.onOpenChange!(true); options.onOpenChange!(false);
    expect(isSceneSuspended(scene)).toBe(false);
  });

  it("retains earlier suspension when panel disposal emits its own close notification", async () => {
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const options = boundaries.assetImport.mock.calls[0]![2] as AssetImportOptions;
    setSceneSuspended(scene, true); options.onOpenChange!(true);
    boundaries.detachAssetImport.mockImplementationOnce(() => options.onOpenChange!(false));
    stop(); stop();
    expect(isSceneSuspended(scene)).toBe(true); expect(boundaries.detachAssetImport).toHaveBeenCalledTimes(1);
    options.onOpenChange!(true); options.onOpenChange!(false);
    expect(isSceneSuspended(scene)).toBe(true);
  });

  it("does not clear another suspension when an unopened inspector is disposed", async () => {
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    setSceneSuspended(scene, true); stop();
    expect(isSceneSuspended(scene)).toBe(true); expect(boundaries.detachAssetImport).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("restores prior suspension=%s after asset-panel attachment fails", async prior => {
    setSceneSuspended(scene, prior);
    boundaries.assetImport.mockImplementationOnce((_scene: Scene, _canvas: HTMLCanvasElement, options: AssetImportOptions) => {
      options.onOpenChange!(true); throw new Error("Asset inspector attachment failed");
    });
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal)).rejects.toThrow("Asset inspector attachment failed");
    expect(isSceneSuspended(scene)).toBe(prior); expect(boundaries.detachAssetImport).not.toHaveBeenCalled();
    expect(boundaries.registries[0]!.dispose).toHaveBeenCalledTimes(1); expect(boundaries.uis[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(boundaries.detachCamera).toHaveBeenCalledTimes(1); expect(boundaries.detachTargeting).toHaveBeenCalledTimes(1);
    expect(window.__nativeSlice).toBeUndefined();
  });

  it("keeps runtime startup pending until native assemblies are complete, then positions them before attaching controls", async () => {
    let release!: () => void;
    boundaries.assembly.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const progress = vi.fn(), completed = vi.fn();
    const pending = createNativeSliceRuntime(scene, settings, new AbortController().signal, { onProgress: progress }).then(stop => {
      stops.push(stop); completed(); return stop;
    });
    await vi.waitFor(() => expect(boundaries.assembly).toHaveBeenCalledOnce());
    const registry = boundaries.registries[0]!;
    expect(completed).not.toHaveBeenCalled(); expect(registry.update).not.toHaveBeenCalled();
    expect(boundaries.camera).not.toHaveBeenCalled(); expect(boundaries.targeting).not.toHaveBeenCalled();
    expect(window.__nativeSlice).toBeUndefined();
    expect(progress).toHaveBeenCalledWith({ stage: "assets", detail: "Assembling native characters, skinning and equipped parts…" });
    boundaries.camera.mockImplementationOnce(() => {
      expect(registry.update).toHaveBeenCalledExactlyOnceWith(0); return boundaries.detachCamera;
    });
    release(); await pending;
    expect(completed).toHaveBeenCalledOnce(); expect(boundaries.camera).toHaveBeenCalledOnce();
    expect(window.__nativeSlice).toBeDefined();
  });

  it("rejects a native assembly failure and releases the unpublished world, UI and adapter", async () => {
    const source = sourceWorld(); boundaries.assembly.mockRejectedValueOnce(new Error("Native equipment failed"));
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow("Native equipment failed");
    expect(boundaries.registries[0]!.dispose).toHaveBeenCalledOnce(); expect(boundaries.uis[0]!.dispose).toHaveBeenCalledOnce();
    expect(boundaries.uis[0]!.adapter.getInitialState()).toEqual([]); expect(source.ground.isDisposed()).toBe(true);
    expect(source.authored.isEnabled()).toBe(true); expect(boundaries.camera).not.toHaveBeenCalled();
    expect(boundaries.targeting).not.toHaveBeenCalled(); expect(window.__nativeSlice).toBeUndefined();
  });

  it.each(["abort", "scene"] as const)("immediately disposes pending actor assembly boundaries on %s cancellation", async lifetime => {
    let release!: () => void;
    boundaries.assembly.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController(), pending = createNativeSliceRuntime(scene, settings, controller.signal);
    await vi.waitFor(() => expect(boundaries.assembly).toHaveBeenCalledOnce());
    const registry = boundaries.registries[0]!, ui = boundaries.uis[0]!;
    if (lifetime === "abort") controller.abort(); else scene.dispose();
    // Cleanup must not depend on a stalled model or equipment promise resolving.
    expect(registry.dispose).toHaveBeenCalledOnce(); expect(ui.dispose).toHaveBeenCalledOnce();
    expect(ui.adapter.getInitialState()).toEqual([]); expect(boundaries.camera).not.toHaveBeenCalled();
    release();
    if (lifetime === "abort") await expect(pending).rejects.toHaveProperty("name", "AbortError");
    else await expect(pending).rejects.toThrow("scene was disposed during startup");
    expect(registry.dispose).toHaveBeenCalledOnce(); expect(ui.dispose).toHaveBeenCalledOnce();
    expect(window.__nativeSlice).toBeUndefined();
  });

  it.each([true, false])("rejects native catalog errors with requireWorld=%s instead of creating dummy entities", async requireWorld => {
    boundaries.load.mockRejectedValueOnce(new Error("Native catalog download failed"));
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal, { requireWorld }))
      .rejects.toThrow("Native catalog download failed");
    expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]); expect(boundaries.section).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rejects an incomplete native catalog before allocating runtime actors", async () => {
    boundaries.load.mockResolvedValueOnce({ models: new Map(), npcProfiles: new Map() });
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal)).rejects.toThrow("selected native character, Musveren or equipment");
    expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]); expect(boundaries.section).not.toHaveBeenCalled();
  });

  it("preserves saved male clip overrides and default player identity", async () => {
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    expect(boundaries.load.mock.calls[0]![1]).toBe("human-male-fighter");
    const profiles = boundaries.factory.mock.calls[0]![0];
    expect(profiles.get("native-human-fighter").clips).toEqual({ idle: "Wait", run: "Run", attack: "Attack", death: "Death" });
    expect(boundaries.uis[0]!.adapter.getInitialState().find(entity => entity.id === "local-player"))
      .toMatchObject({ appearanceId: "native-human-fighter", displayName: "Human male fighter" });
  });

  it.each(["query", "authored"])("uses the selected female profile through %s without male clip/equipment substitution", async selection => {
    const female = { ...defaultNativePlayerProfile, id: "human-female-fighter", name: "Human female fighter", catalogId: "human-female-fighter:0",
      collisionRadius: 8, collisionHeight: 23.5, clips: { idle: "Wait_Hand_FFighter", run: "Run_Hand_FFighter", attack: "Atk01_Hand_FFighter", death: "Death_FFighter" },
      upperItems: [{ ...defaultNativePlayerProfile.upperItems[0]!, catalogId: "female-fighter-equipment:0" }] };
    const catalog = await boundaries.load(); boundaries.load.mockClear();
    const body = {}, equipment = {};
    boundaries.load.mockResolvedValueOnce({ ...catalog, playerProfile: female,
      playerProfiles: new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile], [female.id, female]]),
      models: new Map([[female.catalogId, body], [female.upperItems[0]!.catalogId, equipment], ["musveren:0", catalog.models.get("musveren:0")]]) });
    Object.assign(window, { location: { search: selection === "query" ? "?world=interlude&authored=1&character=human-female-fighter" : "?world=interlude" } });
    stops.push(await createNativeSliceRuntime(scene, { ...settings, playerProfileId: selection === "authored" ? female.id : defaultNativePlayerProfile.id }, new AbortController().signal));
    expect(boundaries.load.mock.calls[0]![1]).toBe(female.id);
    const profiles = boundaries.factory.mock.calls[0]![0], actor = profiles.get(`native-player:${female.id}`);
    expect(actor.clips).toEqual(female.clips); expect(actor.asset).toBe(body); expect(actor.upperItems.get(22)).toBe(equipment);
    expect(profiles.has("native-human-fighter")).toBe(false);
    expect(window.__nativeSlice!.snapshot().playerProfile).toEqual(female);
    expect(boundaries.uis[0]!.adapter.getInitialState().find(entity => entity.id === "local-player"))
      .toMatchObject({ appearanceId: `native-player:${female.id}`, displayName: female.name });
  });

  it.each(["missing", "failed"] as const)("rejects a %s world on the required browser route", async failure => {
    if (failure === "failed") boundaries.section.mockRejectedValueOnce(new Error("World source hash differs"));
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow(failure === "missing" ? "native world section is unavailable" : "World source hash differs");
    expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rejects missing native terrain materials instead of revealing neutral ground", async () => {
    const source = sourceWorld("Terrain layer texture failed");
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow("Native terrain materials failed: Terrain layer texture failed");
    expect(source.ground.isDisposed()).toBe(true); expect(source.authored.isEnabled()).toBe(true);
    expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]);
  });

  it.each(["prepare", "failed-state", "initial-update"] as const)("rejects flame %s failures on the required browser route", async failure => {
    const source = sourceWorld();
    if (failure === "prepare") boundaries.flames.mockRejectedValueOnce(new Error("Flame preparation failed"));
    else {
      const { owner, inspection } = presentationFixture();
      if (failure === "failed-state") { inspection.status = "failed"; inspection.failure = "Flame preparation failed"; }
      else owner.update.mockImplementationOnce(() => { throw new Error("Flame preparation failed"); });
    }
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow("Flame preparation failed");
    expect(source.ground.isDisposed()).toBe(true); expect(source.authored.isEnabled()).toBe(true);
    expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
  });

  it("allocates no UI or registry when catalog completion loses a cancellation race", async () => {
    const aborted = new AbortController(); let resolve!: (value: { models: Map<string, unknown>; npcProfiles: Map<string, unknown> }) => void;
    boundaries.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const result = createNativeSliceRuntime(scene, settings, aborted.signal);
    aborted.abort(); resolve({ models: new Map(), npcProfiles: new Map() });
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]); expect(boundaries.camera).not.toHaveBeenCalled();
  });

  it("fails before asset requests when the authored camera has been removed", async () => {
    scene.getCameraByName("World camera")!.dispose();
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal)).rejects.toThrow("Authored orbit camera is missing");
    expect(boundaries.load).not.toHaveBeenCalled(); expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]);
  });

  it("does not attach to a scene disposed while catalog data is pending", async () => {
    let resolve!: (value: { models: Map<string, unknown>; npcProfiles: Map<string, unknown> }) => void;
    boundaries.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const result = createNativeSliceRuntime(scene, settings, new AbortController().signal);
    scene.dispose(); resolve({ models: new Map(), npcProfiles: new Map() });
    await expect(result).rejects.toThrow("scene was disposed during startup");
    expect(boundaries.uis).toEqual([]); expect(boundaries.registries).toEqual([]); expect(boundaries.camera).not.toHaveBeenCalled();
  });

  it.each(["abort", "scene"] as const)("releases a running runtime when its %s lifetime ends", async lifetime => {
    const controller = new AbortController(), stop = await createNativeSliceRuntime(scene, settings, controller.signal); stops.push(stop);
    const ui = boundaries.uis[0]!, registry = boundaries.registries[0]!;
    if (lifetime === "abort") controller.abort(); else scene.dispose();
    stop();
    expect(registry.dispose).toHaveBeenCalledTimes(1); expect(ui.dispose).toHaveBeenCalledTimes(1);
    expect(boundaries.detachCamera).toHaveBeenCalledTimes(1); expect(boundaries.detachTargeting).toHaveBeenCalledTimes(1);
    expect(ui.adapter.getInitialState()).toEqual([]); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rolls back UI, adapter and registry when attaching the authored camera fails", async () => {
    boundaries.camera.mockImplementationOnce(() => { throw new Error("Camera attachment failed"); });
    const before = scene.onBeforeRenderObservable.observers.length;
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal)).rejects.toThrow("Camera attachment failed");
    for (const registry of boundaries.registries) expect(registry.dispose).toHaveBeenCalledTimes(1);
    for (const ui of boundaries.uis) { expect(ui.dispose).toHaveBeenCalledTimes(1); expect(ui.adapter.getInitialState()).toEqual([]); }
    expect(scene.onBeforeRenderObservable.observers.length).toBe(before);
    expect(window.__nativeSlice).toBeUndefined();
  });

  it("rolls back the camera too when a later targeting attachment fails", async () => {
    boundaries.targeting.mockImplementationOnce(() => { throw new Error("Targeting attachment failed"); });
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal)).rejects.toThrow("Targeting attachment failed");
    expect(boundaries.detachCamera).toHaveBeenCalledTimes(1);
    for (const registry of boundaries.registries) expect(registry.dispose).toHaveBeenCalledTimes(1);
    for (const ui of boundaries.uis) { expect(ui.dispose).toHaveBeenCalledTimes(1); expect(ui.adapter.getInitialState()).toEqual([]); }
    expect(window.__nativeSlice).toBeUndefined();
  });

  it("does not erase another runtime's diagnostics when the older owner stops", async () => {
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const replacement = { snapshot: () => ({ entities: [], skinMeshes: [], nativeAttackReference: "unverified", nativeNpcProfile: null, nativeTerrain: "other scene", phase2Networking: false, worldFailure: null }), dispatch: vi.fn(), performance: vi.fn() };
    window.__nativeSlice = replacement;
    stop(); expect(window.__nativeSlice).toBe(replacement);
  });

  it("shares explicitly requested performance diagnostics and disposes them with the runtime", async () => {
    Object.assign(document, { visibilityState: "visible", hasFocus: () => true });
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const diagnostics = window.__nativeSlice!;
    const before = engine.onBeginFrameObservable.observers.length;
    const [first, second] = await Promise.all([diagnostics.performance(), diagnostics.performance()]);
    expect(first).toBe(second);
    expect(engine.onBeginFrameObservable.observers.length).toBe(before);
    expect(first.inspect()).toMatchObject({ disposed: false, measuring: false });
    stop();
    expect(first.inspect()).toMatchObject({ disposed: true, measuring: false });
    await expect(diagnostics.performance()).rejects.toThrow("disposed");
  });

  it("does not create delayed diagnostics after the owning runtime stops", async () => {
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    const pending = window.__nativeSlice!.performance();
    stop();
    await expect(pending).rejects.toThrow("disposed while loading diagnostics");
  });

  it("loads source terrain into the main runtime, grounds actors and restores the authored scene on cleanup", async () => {
    const authored = MeshBuilder.CreateBox("Authored inspection floor", {}, scene);
    const hidden = MeshBuilder.CreateBox("Authored hidden mesh", {}, scene); hidden.setEnabled(false);
    const camera = scene.getCameraByName("World camera") as ArcRotateCamera;
    const originalTarget = camera.target.clone(), originalRadius = camera.radius;
    let ground: ReturnType<typeof MeshBuilder.CreateGround>;
    const dispose = vi.fn(() => ground.dispose());
    boundaries.section.mockImplementationOnce(async () => {
      ground = MeshBuilder.CreateGround("Source terrain", { width: 20, height: 20 }, scene);
      ground.position.set(210, -30, 790);
      return { manifest: { terrain: { sha256: "a".repeat(64) }, unsupportedRuntimeMaterials: [] }, terrainMeshes: [ground], spawnCandidate: new Vector3(210, -30, 790),
        minimum: new Vector3(200, -30, 780), maximum: new Vector3(220, -30, 800),
        manifestSha256: "a".repeat(64), dispose,
        inspection: () => ({ modelCount: 1, placementCount: 1, terrainTriangles: 2, collisionVerified: false }) };
    });
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    expect(authored.isEnabled()).toBe(false); expect(hidden.isEnabled()).toBe(false);
    expect(boundaries.uis[0]!.adapter.getInitialState()[0]!.position).toEqual({ x: 212, y: -30, z: 794 });
    expect(boundaries.uis[0]!.adapter.getInitialState()[1]!.position).toEqual({ x: 213.4, y: -30, z: 794 });
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ nativeTerrain: "source-section-loaded", world: {
      sourceSpawn: [21200, 79400, -3000], nativeLocationMatch: "unverified", collisionVerified: false,
    } });
    expect(boundaries.targeting.mock.calls[0]?.[3]).toBeDefined();
    expect(camera.target.x).toBeCloseTo(212.6); expect(camera.radius).toBe(originalRadius);
    expect(camera.alpha).toBe(0); expect(camera.beta).toBe(1);
    const adapter = boundaries.uis[0]!.adapter;
    adapter.dispatch({ type: "move-local", position: { x: 1000, y: -30, z: 1000 } }); adapter.advance(1);
    expect(adapter.getInitialState()[0]!.position).toEqual({ x: 212, y: -30, z: 794 });
    stop(); expect(dispose).toHaveBeenCalledTimes(1);
    expect(authored.isEnabled()).toBe(true); expect(hidden.isEnabled()).toBe(false);
    expect(camera.target).toEqual(originalTarget); expect(camera.radius).toBe(originalRadius);
  });

  it("retains the authored inspection area when the staged world is rejected", async () => {
    const authored = MeshBuilder.CreateBox("Authored inspection floor", {}, scene);
    boundaries.section.mockRejectedValueOnce(new Error("World source hash differs"));
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    expect(authored.isEnabled()).toBe(true);
    expect(boundaries.uis[0]!.adapter.getInitialState()[0]!.position).toEqual({ x: 2, y: 3, z: 4 });
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ nativeTerrain: "not-loaded-in-actor-scene", world: null });
  });

  it("disposes a native section completing after runtime cancellation without hiding authored meshes", async () => {
    const authored = MeshBuilder.CreateBox("Authored inspection floor", {}, scene), controller = new AbortController(), dispose = vi.fn();
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    boundaries.section.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ dispose }); started(); }));
    const pending = createNativeSliceRuntime(scene, settings, controller.signal); await ready;
    controller.abort(); release();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(dispose).toHaveBeenCalledTimes(1); expect(authored.isEnabled()).toBe(true);
    expect(boundaries.uis).toEqual([]);
  });

  it("uses saved native world geometry without another import, preserves edited objects and restores the LH camera on stop", async () => {
    const value = authoredWorld(), { root, ground, tree, hidden, material, camera, cameraBefore } = value;
    const savedMeshes = [...scene.meshes], transforms = [...scene.transformNodes], materials = [...scene.materials];
    const materialDispose = vi.spyOn(material, "dispose"), groundDispose = vi.spyOn(ground, "dispose");
    const metadataBefore = JSON.stringify(root.metadata);
    boundaries.camera.mockImplementationOnce(() => {
      expect(camera.alpha).toBe(-cameraBefore.alpha);
      expect(camera.target.asArray()).toEqual([cameraBefore.target.x, cameraBefore.target.y, -cameraBefore.target.z]);
      return boundaries.detachCamera;
    });
    const stop = await createNativeSliceRuntime(scene, settings, new AbortController().signal); stops.push(stop);
    expect(boundaries.section).not.toHaveBeenCalled(); expect(scene.meshes).toEqual(savedMeshes); expect(scene.transformNodes).toEqual(transforms);
    expect(scene.materials).toEqual(materials); expect(root.scaling.z).toBe(1);
    expect(ground.isEnabled()).toBe(true); expect(tree.isEnabled()).toBe(true); expect(hidden.isEnabled()).toBe(false);
    expect(ground.material).toBe(material); expect(tree.material).toBe(material); expect(value.placement.position.x).toBe(.5);
    expect(boundaries.uis[0]!.adapter.getInitialState()[0]!.position).toEqual({ x: 212, y: -30, z: 794 });
    expect(camera.alpha).toBe(-cameraBefore.alpha); expect(camera.beta).toBe(cameraBefore.beta); expect(camera.radius).toBe(cameraBefore.radius);
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ worldFailure: null, world: { authored: true, placementCount: 1,
      placementTransformEdits: ["source-tree"], terrainMaterial: "editor-authored-source-materials" } });
    stop(); stop();
    expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore);
    expect(groundDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
    expect(scene.meshes).toEqual(savedMeshes); expect(scene.materials).toEqual(materials); expect(JSON.stringify(root.metadata)).toBe(metadataBefore);
  });

  it("restores saved world and camera immediately when authored terrain cannot support the requested spawn", async () => {
    const { root, ground, material, camera, cameraBefore } = authoredWorld();
    const stop = await createNativeSliceRuntime(scene, { ...settings, origin: new Vector3(100, 3, 4) }, new AbortController().signal); stops.push(stop);
    expect(boundaries.section).not.toHaveBeenCalled();
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ world: null, worldFailure: "The staged native surface does not support the requested actor origin." });
    expect(root.scaling.z).toBe(-1); expect(ground.isEnabled()).toBe(true); expect(ground.material).toBe(material);
    expectAuthoredCamera(camera, cameraBefore);
    camera.alpha = .33; camera.setTarget(new Vector3(9, 8, 7), false, false, true);
    stop();
    // Failure rollback already released the temporary coordinate adapter. Later
    // camera edits in the retained inspection scene must not be restored again.
    expect(camera.alpha).toBe(.33); expect(camera.target.asArray()).toEqual([9, 8, 7]);
    expect(ground.isDisposed()).toBe(false);
  });

  it.each(["stop", "abort"] as const)("does not reflect an authored RH camera when the world root is already identity, and restores it on %s", async lifetime => {
    const { root, ground, tree, camera, cameraBefore } = authoredWorld(1), controller = new AbortController();
    const orientations = [ground.sideOrientation, tree.sideOrientation];
    boundaries.camera.mockImplementationOnce(() => {
      expectAuthoredCamera(camera, cameraBefore);
      return boundaries.detachCamera;
    });
    const stop = await createNativeSliceRuntime(scene, settings, controller.signal); stops.push(stop);
    expect(boundaries.section).not.toHaveBeenCalled(); expect(root.scaling.z).toBe(1);
    expect([ground.sideOrientation, tree.sideOrientation]).toEqual(orientations);
    expect(camera.alpha).toBe(cameraBefore.alpha); expect(camera.beta).toBe(cameraBefore.beta); expect(camera.radius).toBe(cameraBefore.radius);
    expect(camera.target.asArray()).toEqual([212.6, -29.65, 794]);
    expect(window.__nativeSlice?.snapshot()).toMatchObject({ worldFailure: null, world: { authored: true, placementCount: 1 } });
    if (lifetime === "abort") controller.abort(); else stop();
    stop();
    expectAuthoredCamera(camera, cameraBefore); expect(root.scaling.z).toBe(1);
    expect([ground.sideOrientation, tree.sideOrientation]).toEqual(orientations);
    expect(ground.isDisposed()).toBe(false); expect(tree.isDisposed()).toBe(false);
    expect(boundaries.detachCamera).toHaveBeenCalledTimes(1); expect(boundaries.detachTargeting).toHaveBeenCalledTimes(1);
  });

  it("restores an attached saved world on cancellation and releases runtime boundaries without disposing authored objects", async () => {
    const { root, ground, material, camera, cameraBefore } = authoredWorld(), controller = new AbortController();
    const stop = await createNativeSliceRuntime(scene, settings, controller.signal); stops.push(stop);
    const terrainDispose = vi.spyOn(ground, "dispose"), materialDispose = vi.spyOn(material, "dispose");
    controller.abort(); stop();
    expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore); expect(ground.isEnabled()).toBe(true);
    expect(terrainDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
    expect(boundaries.registries[0]!.dispose).toHaveBeenCalledTimes(1); expect(boundaries.uis[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(boundaries.section).not.toHaveBeenCalled(); expect(window.__nativeSlice).toBeUndefined();
  });

  it("rolls back reflected authored coordinates when a later runtime attachment fails", async () => {
    const { root, ground, material, camera, cameraBefore } = authoredWorld();
    boundaries.targeting.mockImplementationOnce(() => { throw Error("Targeting fixture failure"); });
    await expect(createNativeSliceRuntime(scene, settings, new AbortController().signal)).rejects.toThrow("Targeting fixture failure");
    expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore); expect(ground.material).toBe(material);
    expect(ground.isEnabled()).toBe(true); expect(ground.isDisposed()).toBe(false); expect(boundaries.section).not.toHaveBeenCalled();
  });

  it("does not replace a malformed saved world with a newly imported source world", async () => {
    const { root, ground, camera, cameraBefore } = authoredWorld(); root.metadata.nativeWorldRoot.manifestSha256 = "invalid";
    stops.push(await createNativeSliceRuntime(scene, settings, new AbortController().signal));
    expect(boundaries.section).not.toHaveBeenCalled(); expect(root.scaling.z).toBe(-1); expectAuthoredCamera(camera, cameraBefore);
    expect(ground.isEnabled()).toBe(true); expect(window.__nativeSlice?.snapshot()?.worldFailure).toContain("invalid schema or manifest identity");
  });
});

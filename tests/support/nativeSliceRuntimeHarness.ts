import { afterEach, beforeEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { NativeSection } from "../../src/scene/world/loadNativeSection";
import { createNativeSliceRuntime, type NativeSliceRuntimeOptions, type NativeSliceSettings } from "../../src/runtime/createNativeSliceRuntime";
import { catalogNativeSliceWorldSource, type NativeSliceWorldSource } from "../../src/runtime/nativeSliceWorldSource";
import { evaluateNativeFlameFade, selectNativeFlameFrame, type NativeFlameReplayTime } from "../../src/scene/world/nativeFlameMaterials";
import type { VariableInfo } from "../../src/ui/devSheet/types";

vi.mock("../../src/scene/world/loadNativeMovers", () => ({ loadNativeMovers: vi.fn(async () => null) }));

const runtimeBoundaryMocks = vi.hoisted(() => ({
  load: vi.fn(), assembly: vi.fn<() => Promise<void>>(), section: vi.fn(), flames: vi.fn(), camera: vi.fn(), targeting: vi.fn(), detachCamera: vi.fn(), detachTargeting: vi.fn(),
  assetImport: vi.fn(), detachAssetImport: vi.fn(), audioControls: vi.fn(), factory: vi.fn(), effectBundle: vi.fn(), readCatalog: vi.fn(),
  sandboxWindowLayer: vi.fn(), releaseSandboxWindowLayer: vi.fn(),
  uis: [] as { adapter: NativeSliceAdapter; dispose: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; showStatus: ReturnType<typeof vi.fn> }[],
  registries: [] as { dispose: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }[],
  sheetGroups: new Map<string, { variables?: () => VariableInfo[] }>(),
}));
vi.mock("../../src/assets/native/loadNativeCatalog", () => ({ loadNativeActorCatalog: runtimeBoundaryMocks.load }));
vi.mock("../../src/effects/nativeEffectComponents", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/effects/nativeEffectComponents")>(), loadNativeEffectComponents: runtimeBoundaryMocks.effectBundle,
}));
vi.mock("../../src/ui/nativeEffectComponentControls", () => ({ attachNativeEffectComponentControls: () => ({ dispose() {} }) }));
vi.mock("../../src/ui/nativeEffectInitControls", () => ({ attachNativeEffectInitControls: () => ({ dispose() {} }) }));
vi.mock("../../src/scene/world/nativeFlamePresentation", () => ({ createNativeFlamePresentation: runtimeBoundaryMocks.flames }));
vi.mock("../../src/scene/world/nativeSkyPresentation", () => ({ createNativeSkyPresentation: async () => null }));
vi.mock("../../src/runtime/mountSandboxWindowLayer", () => ({ mountSandboxWindowLayer: runtimeBoundaryMocks.sandboxWindowLayer }));
vi.mock("../../src/audio/worldAudioControls", () => ({ attachWorldAudioControls: runtimeBoundaryMocks.audioControls }));
vi.mock("../../src/audio/nativeFootstepControls", () => ({ attachNativeFootstepControls: () => ({ dispose() {}, refresh() {}, describe: () => [] }) }));
vi.mock("../../src/audio/nativeCombatAudioControls", () => ({ attachNativeCombatAudioControls: () => ({ update() {}, dispose() {}, describe: () => [], cards: () => [] }) }));
vi.mock("../../src/ui/nativePowerStrikeControls", () => ({ attachNativePowerStrikeControls: () => ({ dispose() {} }) }));
vi.mock("../../src/ui/nativeLocomotionControls", () => ({ attachNativeLocomotionControls: () => ({ dispose() {} }) }));
vi.mock("../../src/ui/nativeAnimationAliasTable", () => ({ attachNativeAnimationAliasTable: () => ({ refresh() {}, dispose() {} }) }));
vi.mock("../../src/ui/AssetImportPanel", () => ({ attachAssetImport: runtimeBoundaryMocks.assetImport }));
vi.mock("../../src/scene/world/loadNativeSection", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/scene/world/loadNativeSection")>(), loadNativeSection: runtimeBoundaryMocks.section,
}));
vi.mock("../../src/assets/native/readNativeCatalog", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/assets/native/readNativeCatalog")>(),
  readNativeCatalog: runtimeBoundaryMocks.readCatalog,
}));
vi.mock("../../src/camera/WorldCamera", () => ({ attachWorldCamera: runtimeBoundaryMocks.camera }));
vi.mock("../../src/entities/attachTargeting", () => ({ attachTargeting: runtimeBoundaryMocks.targeting }));
vi.mock("../../src/assets/native/NativeCharacterVisual", () => ({ nativeCharacterFactory: runtimeBoundaryMocks.factory }));
vi.mock("../../src/ui/WorldInterface", () => ({ WorldInterface: class {
  readonly labels = {}; readonly dispose = vi.fn(); readonly update = vi.fn(); readonly showStatus = vi.fn();
  readonly clearStatus = vi.fn(); readonly watchSound = vi.fn(() => () => {}); readonly bindGait = vi.fn(() => () => {});
  readonly root = { querySelector: () => ({ append() {}, remove() {}, after() {}, setAttribute() {}, addEventListener() {}, textContent: "" }) };
  readonly sheet = (() => {
    const plainDomNode = () => Object.assign(new EventTarget(), { dataset: {}, children: [], disabled: false, hidden: false, textContent: "",
      append() {}, remove() {}, after() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
    const group = (id: string, _title: string, options: { variables?: () => VariableInfo[] } = {}) => {
      runtimeBoundaryMocks.sheetGroups.set(id, options);
      return { element: plainDomNode(), button: plainDomNode, note: plainDomNode, idEntry: () => ({ element: plainDomNode(), setMessage() {} }),
        readout: () => ({ element: plainDomNode(), output: plainDomNode(), refresh() {} }),
        choice: () => ({ element: plainDomNode(), value: "", set() {}, setOptions() {}, setDisabled() {} }) };
    };
    const inertHoverCardDescribe = () => () => {};
    return { section: () => ({ group }), describe: inertHoverCardDescribe, inspect: () => ({ open: false }) };
  })();
  constructor(readonly adapter: NativeSliceAdapter) { runtimeBoundaryMocks.uis.push(this); }
} }));
vi.mock("../../src/entities/EntityRegistry", () => ({ EntityRegistry: class {
  readonly dispose = vi.fn(); readonly update = vi.fn(); readonly snapshot = () => [];
  readonly whenReady = runtimeBoundaryMocks.assembly;
  constructor() { runtimeBoundaryMocks.registries.push(this); }
} }));

export { runtimeBoundaryMocks };

export const emptyNativeCatalog = { schemaVersion: 1, models: [], textures: [], sections: [], movers: [], npcProfiles: [], playerProfiles: [],
  animationAudio: [], combatAudio: [], worldAudio: [], effectComponents: [], tables: [], windows: [], tiles: [], servedCatalogSha256: "c".repeat(64),
  laneCatalogSha256: null };

export const baseRuntimeSettings: NativeSliceSettings = { origin: new Vector3(2, 3, 4), leatherShirt: true };

export interface SourceSectionFixture {
  readonly authored: ReturnType<typeof MeshBuilder.CreateBox>;
  readonly ground: ReturnType<typeof MeshBuilder.CreateGround>;
  dispose(): void;
}

export interface FlameInspectionFixture { status: "ready" | "failed" | "aborted"; failure: string | null; bindings: number }

export interface NativeSliceRuntimeHarness {
  readonly engine: NullEngine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly stops: (() => void)[];
  useWorldSource(worldSource: NativeSliceWorldSource): void;
  startRuntime(runtimeSettings: NativeSliceSettings, signal: AbortSignal, options?: NativeSliceRuntimeOptions): Promise<() => void>;
  mockSourceSectionWithRealTerrain(materialFailure?: string): SourceSectionFixture;
  presentationFixture(order?: string[]): { owner: ReturnType<typeof createFlameOwner>; inspection: FlameInspectionFixture };
}

function createFlameOwner(inspection: FlameInspectionFixture, order: string[]) {
  return { validateReplayTime: vi.fn((time: NativeFlameReplayTime) => {
    selectNativeFlameFrame(time.textureSeconds, { maxFrameRate: 30, totalFrameNum: 16 });
    evaluateNativeFlameFade(time.fadeSeconds, { object: "FX_E_T.Flameset.FadeColor0", colorFadeType: 1, fadePeriod: Math.fround(.4), fadePhase: 1,
      color1: { bgraHex: "151b3100", rgbaBytes: [49, 27, 21, 0] }, color2: { bgraHex: "2e437c00", rgbaBytes: [124, 67, 46, 0] } });
  }), update: vi.fn(), inspect: vi.fn(() => inspection), dispose: vi.fn(() => { order.push("flames"); }) };
}

function resetRuntimeBoundaryMocks() {
  const mocks = runtimeBoundaryMocks;
  mocks.uis.length = 0; mocks.registries.length = 0; mocks.sheetGroups.clear();
  mocks.load.mockReset(); mocks.section.mockReset(); mocks.flames.mockReset(); mocks.camera.mockReset(); mocks.targeting.mockReset();
  mocks.assembly.mockReset().mockResolvedValue(undefined);
  mocks.effectBundle.mockReset().mockResolvedValue(null);
  mocks.readCatalog.mockReset().mockResolvedValue(emptyNativeCatalog);
  mocks.detachCamera.mockReset(); mocks.detachTargeting.mockReset();
  mocks.detachAssetImport.mockReset(); mocks.assetImport.mockReset().mockReturnValue(mocks.detachAssetImport);
  mocks.audioControls.mockReset().mockReturnValue({ update() {}, dispose() {}, describe: () => [], cards: () => [], setWorldAudio() {} });
  mocks.factory.mockReset().mockReturnValue(() => undefined);
  mocks.releaseSandboxWindowLayer.mockReset();
  mocks.sandboxWindowLayer.mockReset().mockReturnValue({ layer: { open: vi.fn(), refresh() {}, close() {}, openWindowIds: () => [], dispose() {} },
    release: mocks.releaseSandboxWindowLayer });
  mocks.load.mockResolvedValue({ models: new Map([["human-male-fighter:0", {}], ["musveren:0", { manifest: { source: { object: "Native.Musveren" } } }], ["fighter-equipment:0", {}]]),
    npcProfiles: new Map([["npc:21622", { id: "npc:21622", npcId: 21622, mesh: "Native.Musveren", collisionHeight: 36, sourceUnitsPerMetre: 100, drawScale: 1.2, drawScale3D: [1, 1, 1] }]]) });
  mocks.section.mockResolvedValue(null);
  mocks.flames.mockImplementation(async () => ({ validateReplayTime: vi.fn(), update: vi.fn(), inspect: () => ({ status: "not-present", failure: null }), dispose: vi.fn() }));
  mocks.camera.mockReturnValue(mocks.detachCamera); mocks.targeting.mockReturnValue(mocks.detachTargeting);
}

export function useNativeSliceRuntimeHarness(): NativeSliceRuntimeHarness {
  let engine!: NullEngine, scene!: Scene, camera!: ArcRotateCamera;
  let worldSource: NativeSliceWorldSource = catalogNativeSliceWorldSource;
  const stops: (() => void)[] = [];
  beforeEach(() => {
    resetRuntimeBoundaryMocks();
    engine = new NullEngine(); scene = new Scene(engine); stops.length = 0;
    camera = new ArcRotateCamera("World camera", 0, 1, 5, Vector3.Zero(), scene);
    worldSource = catalogNativeSliceWorldSource;
    vi.spyOn(engine, "getRenderingCanvas").mockReturnValue(new EventTarget() as HTMLCanvasElement);
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { createElement: () => Object.assign(new EventTarget(), { dataset: {} }) }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/l2/coverage.json") return new Response("missing", { status: 404 });
      throw new Error(`Unexpected request ${url}`);
    }));
  });
  afterEach(() => { for (const stop of stops) stop(); scene.dispose(); engine.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function mockSourceSectionWithRealTerrain(materialFailure?: string): SourceSectionFixture {
    const authored = MeshBuilder.CreateBox("Retained inspection floor", {}, scene);
    let ground!: ReturnType<typeof MeshBuilder.CreateGround>;
    let lifetime: AbortSignal;
    const disposeGround = () => { lifetime.removeEventListener("abort", disposeGround); ground.dispose(); };
    const subscribeGroundDisposalBeforeRuntimeLikeRealSection = (signal: AbortSignal) => signal.addEventListener("abort", disposeGround, { once: true });
    runtimeBoundaryMocks.section.mockImplementationOnce(async (_scene: Scene, signal: AbortSignal) => {
      lifetime = signal;
      ground = MeshBuilder.CreateGround("Source terrain", { width: 20, height: 20 }, scene); ground.position.set(210, -30, 790);
      subscribeGroundDisposalBeforeRuntimeLikeRealSection(signal);
      return { manifest: { terrain: { sha256: "a".repeat(64) }, unsupportedRuntimeMaterials: [] }, terrainMeshes: [ground], spawnCandidate: new Vector3(210, -30, 790),
        minimum: new Vector3(200, -30, 780), maximum: new Vector3(220, -30, 800), manifestSha256: "a".repeat(64), dispose: disposeGround,
        setTerrainPreview: vi.fn(), inspection: () => ({ modelCount: 1, placementCount: 1, terrainTriangles: 2, collisionVerified: false,
          ...materialFailure ? { materialFailure } : {} }) };
    });
    return { authored, get ground() { return ground; }, dispose: disposeGround };
  }

  function presentationFixture(order: string[] = []) {
    const inspection: FlameInspectionFixture = { status: "ready", failure: null, bindings: 24 };
    const owner = createFlameOwner(inspection, order);
    runtimeBoundaryMocks.flames.mockImplementationOnce(async (_scene: Scene, section: NativeSection) => {
      const release = section.dispose.bind(section);
      vi.spyOn(section, "dispose").mockImplementation(() => { order.push("section"); release(); });
      return owner;
    });
    return { owner, inspection };
  }

  return {
    get engine() { return engine; },
    get scene() { return scene; },
    get camera() { return camera; },
    stops,
    useWorldSource(selectedWorldSource) { worldSource = selectedWorldSource; },
    startRuntime: (runtimeSettings, signal, options = {}) => createNativeSliceRuntime(scene, camera, runtimeSettings, signal, { worldSource, ...options }),
    mockSourceSectionWithRealTerrain,
    presentationFixture,
  };
}

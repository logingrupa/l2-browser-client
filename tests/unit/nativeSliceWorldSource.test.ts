import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { NativeSection } from "../../src/scene/world/loadNativeSection";
import { createNativeSliceRuntime, type NativeSliceSettings } from "../../src/runtime/createNativeSliceRuntime";
import { catalogNativeSliceWorldSource, type NativeSliceWorldSource } from "../../src/runtime/nativeSliceWorldSource";

const boundaries = vi.hoisted(() => ({ section: vi.fn(), catalog: vi.fn() }));
vi.mock("../../src/scene/world/loadNativeSection", () => ({ loadNativeSection: boundaries.section }));
vi.mock("../../src/assets/native/loadNativeCatalog", () => ({ loadNativeActorCatalog: boundaries.catalog }));
vi.mock("../../src/assets/native/readNativeCatalog", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/assets/native/readNativeCatalog")>(),
  readNativeCatalog: async () => ({ schemaVersion: 1, models: [], textures: [], sections: [], movers: [], npcProfiles: [], playerProfiles: [],
    animationAudio: [], combatAudio: [], worldAudio: [], effectComponents: [] }),
}));

const settings: NativeSliceSettings = { origin: new Vector3(0, 0, 0), leatherShirt: false,
  fighterIdle: "Wait", fighterRun: "Run", fighterAttack: "Attack", fighterDeath: "Death" };

describe("native slice world source", () => {
  let engine: NullEngine, scene: Scene, camera: ArcRotateCamera;
  beforeEach(() => {
    boundaries.section.mockReset();
    boundaries.catalog.mockReset().mockResolvedValue({
      models: new Map([["human-male-fighter:0", {}], ["musveren:0", { manifest: { source: { object: "Native.Musveren" } } }], ["fighter-equipment:0", {}]]),
      npcProfiles: new Map([["npc:21622", { id: "npc:21622", npcId: 21622, mesh: "Native.Musveren", collisionHeight: 36, sourceUnitsPerMetre: 100, drawScale: 1.2, drawScale3D: [1, 1, 1] }]]),
    });
    engine = new NullEngine(); scene = new Scene(engine);
    camera = new ArcRotateCamera("World camera", 0, 1, 5, Vector3.Zero(), scene);
    vi.spyOn(engine, "getRenderingCanvas").mockReturnValue(new EventTarget() as HTMLCanvasElement);
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("loads the catalog section with the scene and signal and returns it", async () => {
    const section = { manifestSha256: "a".repeat(64) } as unknown as NativeSection, signal = new AbortController().signal;
    boundaries.section.mockResolvedValueOnce(section);
    const world = await catalogNativeSliceWorldSource(scene, camera, signal);
    expect(boundaries.section).toHaveBeenCalledExactlyOnceWith(scene, signal);
    expect(world.section).toBe(section);
    expect(() => world.release()).not.toThrow();
  });

  it("uses the catalog source when the runtime is given no world source", async () => {
    boundaries.section.mockResolvedValueOnce(null);
    await expect(createNativeSliceRuntime(scene, camera, settings, new AbortController().signal, { requireWorld: true }))
      .rejects.toThrow("The native world section is unavailable");
    expect(boundaries.section).toHaveBeenCalledOnce();
    expect(boundaries.section.mock.calls[0]![0]).toBe(scene);
  });

  it("calls a supplied source with the passed camera and reports a missing section on the required route", async () => {
    const release = vi.fn();
    const suppliedSource = vi.fn<NativeSliceWorldSource>(async () => ({ section: null, release }));
    await expect(createNativeSliceRuntime(scene, camera, settings, new AbortController().signal, { requireWorld: true, worldSource: suppliedSource }))
      .rejects.toThrow("The native world section is unavailable");
    expect(suppliedSource).toHaveBeenCalledOnce();
    const [sourceScene, sourceCamera, sourceSignal] = suppliedSource.mock.calls[0]!;
    expect(sourceScene).toBe(scene); expect(sourceCamera).toBe(camera); expect(sourceSignal).toBeInstanceOf(AbortSignal);
    expect(release).toHaveBeenCalledOnce();
    expect(boundaries.section).not.toHaveBeenCalled();
    expect(window.__nativeSlice).toBeUndefined();
  });
});

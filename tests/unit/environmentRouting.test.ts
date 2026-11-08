import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { createNativeSliceRuntime } from "../../src/runtime/createNativeSliceRuntime";
import { loadEnvironment } from "../../src/scene/loadEnvironment";
import { isSceneStartupRequired } from "../../src/scene/prepareSceneForReveal";
import { nativeSandboxPresentation } from "../../src/scene/presentationConfiguration";

const boundary = vi.hoisted(() => ({
  startRuntime: vi.fn<typeof createNativeSliceRuntime>(),
  loadEditorScene: vi.fn(),
  importedWorld: vi.fn(),
}));
vi.mock("../../src/runtime/createNativeSliceRuntime", () => ({ createNativeSliceRuntime: boundary.startRuntime }));
vi.mock("babylonjs-editor-tools", () => ({ loadScene: boundary.loadEditorScene }));
vi.mock("../../src/scripts", () => ({ scriptsMap: {} }));
vi.mock("../../src/scene/world/loadImportedWorld", () => ({ loadImportedWorld: boundary.importedWorld }));

describe("native route without an Editor scene", () => {
  let engine: NullEngine;
  beforeEach(() => {
    engine = new NullEngine();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search: "?world=interlude" } }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { title: "Initial title" }));
    boundary.startRuntime.mockReset();
    boundary.loadEditorScene.mockReset();
    boundary.importedWorld.mockReset();
  });
  afterEach(() => {
    engine.dispose();
    vi.unstubAllGlobals();
  });

  it("builds the scene in code from the saved values and starts the runtime through the readiness barrier", async () => {
    const stopRuntime = vi.fn();
    boundary.startRuntime.mockResolvedValue(stopRuntime);
    const scene = await loadEnvironment(engine);
    const camera = scene.activeCamera;
    expect(camera).toBeInstanceOf(ArcRotateCamera);
    expect(camera?.name).toBe("World camera");
    expect((camera as ArcRotateCamera).alpha).toBe(nativeSandboxPresentation.camera.alpha);
    expect(scene.lights.map(light => [light.name, light.intensity])).toEqual([["Sky light", 0.65], ["Sunlight", 0.65]]);
    expect(scene.clearColor.asArray()).toEqual([0.49, 0.59, 0.56, 1]);
    expect(scene.fogMode).toBe(0);
    expect([scene.fogStart, scene.fogEnd]).toEqual([32, 85]);
    expect(scene.useRightHandedSystem).toBe(true);
    expect(document.title).toBe("Native asset slice · L2 Browser Client");
    expect(isSceneStartupRequired(scene, "native-world")).toBe(true);
    expect(boundary.startRuntime).toHaveBeenCalledTimes(1);
    const [runtimeScene, settings, signal, options] = boundary.startRuntime.mock.calls[0]!;
    expect(runtimeScene).toBe(scene);
    expect(settings.fighterIdle).toBe("Wait_1HS_MFighter");
    expect(settings.leatherShirt).toBe(true);
    expect(settings.materialTint?.asArray()).toEqual([0.45, 1, 0.6]);
    expect(options?.requireWorld).toBe(true);
    expect(boundary.loadEditorScene).not.toHaveBeenCalled();
    expect(boundary.importedWorld).not.toHaveBeenCalled();
    await Promise.resolve();
    scene.dispose();
    expect(signal.aborted).toBe(true);
    expect(stopRuntime).toHaveBeenCalledTimes(1);
  });

  it("stops a runtime that finishes starting after the scene was disposed", async () => {
    let finishStartup!: (stop: () => void) => void;
    boundary.startRuntime.mockReturnValue(new Promise(resolve => { finishStartup = resolve; }));
    const scene = await loadEnvironment(engine);
    scene.dispose();
    const lateStop = vi.fn();
    finishStartup(lateStop);
    await Promise.resolve(); await Promise.resolve();
    expect(lateStop).toHaveBeenCalledTimes(1);
  });
});

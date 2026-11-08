import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { createNativeSliceRuntime } from "../../src/runtime/createNativeSliceRuntime";
import { loadEnvironment } from "../../src/scene/loadEnvironment";
import { isSceneStartupRequired } from "../../src/scene/prepareSceneForReveal";
import { nativeSandboxPresentation, referenceWorldPresentation } from "../../src/scene/presentationConfiguration";
import { catalogNativeSliceWorldSource } from "../../src/runtime/nativeSliceWorldSource";
import type { createWorldRuntime } from "../../src/runtime/createWorldRuntime";

const boundary = vi.hoisted(() => ({
  startRuntime: vi.fn<typeof createNativeSliceRuntime>(),
  startWorldRuntime: vi.fn<typeof createWorldRuntime>(),
  importedWorld: vi.fn(),
}));
vi.mock("../../src/runtime/createNativeSliceRuntime", () => ({ createNativeSliceRuntime: boundary.startRuntime }));
vi.mock("../../src/runtime/createWorldRuntime", () => ({ createWorldRuntime: boundary.startWorldRuntime }));
vi.mock("../../src/scene/world/loadImportedWorld", () => ({ loadImportedWorld: boundary.importedWorld }));

describe("environment routing", () => {
  let engine: NullEngine;
  beforeEach(() => {
    engine = new NullEngine();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search: "?world=interlude" } }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { title: "Initial title" }));
    boundary.startRuntime.mockReset();
    boundary.startWorldRuntime.mockReset();
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
    const [runtimeScene, runtimeCamera, settings, signal, options] = boundary.startRuntime.mock.calls[0]!;
    expect(runtimeScene).toBe(scene);
    expect(runtimeCamera).toBe(camera);
    expect(options?.worldSource).toBe(catalogNativeSliceWorldSource);
    expect(settings).not.toHaveProperty("fighterIdle");
    expect(settings.leatherShirt).toBe(true);
    expect(settings.materialTint?.asArray()).toEqual([0.45, 1, 0.6]);
    expect(options?.requireWorld).toBe(true);
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

  it("treats any authored value other than 1 as the code-built native route", async () => {
    window.location.search = "?world=interlude&authored=0";
    boundary.startRuntime.mockResolvedValue(vi.fn());
    const scene = await loadEnvironment(engine);
    expect(scene.activeCamera?.name).toBe("World camera");
    expect(boundary.startRuntime).toHaveBeenCalledTimes(1);
  });

  it.each(["", "?world=courtyard", "?authored=1"])("builds the reference scene in code with no staged world for search %j", async search => {
    window.location.search = search;
    boundary.importedWorld.mockResolvedValue(null);
    const stopWorldRuntime = vi.fn();
    boundary.startWorldRuntime.mockReturnValue(stopWorldRuntime);
    const scene = await loadEnvironment(engine);
    const camera = scene.activeCamera as ArcRotateCamera;
    expect(camera).toBeInstanceOf(ArcRotateCamera);
    expect([camera.alpha, camera.beta, camera.radius, camera.maxZ]).toEqual([referenceWorldPresentation.camera.alpha,
      referenceWorldPresentation.camera.beta, referenceWorldPresentation.camera.radius, referenceWorldPresentation.camera.maxZ]);
    expect(scene.clearColor.asArray()).toEqual([...referenceWorldPresentation.clearColor]);
    expect(scene.useRightHandedSystem).toBe(true);
    expect(document.title).toBe("Initial title");
    expect(boundary.importedWorld).toHaveBeenCalledExactlyOnceWith(scene);
    expect(boundary.startWorldRuntime).toHaveBeenCalledExactlyOnceWith(scene, camera);
    expect(boundary.startRuntime).not.toHaveBeenCalled();
    expect(isSceneStartupRequired(scene, "native-world")).toBe(false);
    scene.dispose();
    expect(stopWorldRuntime).toHaveBeenCalledTimes(1);
  });

  it("applies the Talking Island camera overrides when the reference world is staged", async () => {
    window.location.search = "";
    const spawnPoint = new Vector3(10, 2, -4);
    const disposeWorld = vi.fn();
    boundary.importedWorld.mockResolvedValue({ spawnPoint, dispose: disposeWorld });
    boundary.startWorldRuntime.mockReturnValue(vi.fn());
    const scene = await loadEnvironment(engine);
    const camera = scene.activeCamera as ArcRotateCamera;
    expect(camera.alpha).toBe(-Math.PI / 2.5);
    expect([camera.beta, camera.radius, camera.lowerRadiusLimit, camera.upperRadiusLimit, camera.minZ, camera.maxZ]).toEqual([1.1, 8, 1, 50, 0.05, 4000]);
    expect(camera.target.asArray()).toEqual([10, 2.5, -4]);
    expect(scene.clearColor.asArray()).toEqual([0.58, 0.71, 0.8, 1]);
    expect(scene.useRightHandedSystem).toBe(true);
    expect(document.title).toBe("Talking Island · L2 Browser Client");
    expect(boundary.startWorldRuntime).toHaveBeenCalledExactlyOnceWith(scene, camera);
    scene.dispose();
    expect(disposeWorld).toHaveBeenCalledTimes(1);
  });

  it("disposes the reference scene when the world runtime fails to start", async () => {
    window.location.search = "";
    boundary.importedWorld.mockResolvedValue(null);
    const failure = new Error("The world needs a rendering canvas.");
    boundary.startWorldRuntime.mockImplementation(() => { throw failure; });
    await expect(loadEnvironment(engine)).rejects.toBe(failure);
    expect(engine.scenes).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { createNativeSliceRuntime } from "../../src/runtime/createNativeSliceRuntime";
import { loadEnvironment } from "../../src/scene/loadEnvironment";
import { isSceneStartupRequired } from "../../src/scene/prepareSceneForReveal";

const boundary = vi.hoisted(() => ({
  startRuntime: vi.fn<typeof createNativeSliceRuntime>(),
  loadEditorScene: vi.fn(),
}));
vi.mock("../../src/runtime/createNativeSliceRuntime", () => ({ createNativeSliceRuntime: boundary.startRuntime }));
vi.mock("babylonjs-editor-tools", () => ({ loadScene: boundary.loadEditorScene }));
vi.mock("../../src/scripts", () => ({ scriptsMap: {} }));

describe("authored environment routing", () => {
  let engine: NullEngine;
  beforeEach(() => {
    engine = new NullEngine();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search: "?world=interlude&authored=1" } }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { title: "Initial title" }));
    boundary.startRuntime.mockReset();
    boundary.loadEditorScene.mockReset();
  });
  afterEach(() => {
    engine.dispose();
    vi.unstubAllGlobals();
  });

  it("loads the authored native world through the Editor loader only under authored=1", async () => {
    boundary.loadEditorScene.mockImplementation(async (_root: string, _file: string, loadedScene: Scene) => {
      new ArcRotateCamera("World camera", 1.8, 1.15, 4.25, Vector3.Zero(), loadedScene);
    });
    const scene = await loadEnvironment(engine);
    expect(isSceneStartupRequired(scene, "native-world")).toBe(true);
    expect(boundary.loadEditorScene).toHaveBeenCalledExactlyOnceWith("/scene/", "native-world.babylon", scene, {},
      { quality: "high", onProgress: expect.any(Function) });
    expect(scene.activeCamera).toBe(scene.getCameraByName("World camera"));
    expect(boundary.startRuntime).not.toHaveBeenCalled();
  });

  it("disposes the partial scene when the authored native world fails to load", async () => {
    const failure = new Error("Offscreen binary geometry failed to load");
    let loadedScene: Scene | undefined;
    boundary.loadEditorScene.mockImplementation(async (_root: string, _file: string, sceneBeingLoaded: Scene) => {
      loadedScene = sceneBeingLoaded;
      throw failure;
    });
    await expect(loadEnvironment(engine)).rejects.toBe(failure);
    expect(loadedScene?.isDisposed).toBe(true);
    expect(engine.scenes).toHaveLength(0);
  });
});

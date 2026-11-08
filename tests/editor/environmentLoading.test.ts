import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { loadAuthoredNativeWorld } from "../../src/scene/authoredNativeWorld";

const boundary = vi.hoisted(() => ({ load: vi.fn(), scripts: { fixture: "authored-script-map" } }));
vi.mock("babylonjs-editor-tools", () => ({ loadScene: boundary.load }));
vi.mock("../../src/scripts", () => ({ scriptsMap: boundary.scripts }));

describe("authored native world incremental geometry loading", () => {
  let engine: NullEngine, scene: Scene, priorFlag: boolean;
  beforeEach(() => {
    priorFlag = SceneLoaderFlags.ForceFullSceneLoadingForIncremental;
    engine = new NullEngine();
    scene = new Scene(engine);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { title: "Initial title" }));
    boundary.load.mockReset();
  });
  afterEach(() => {
    scene.dispose(); engine.dispose(); SceneLoaderFlags.ForceFullSceneLoadingForIncremental = priorFlag;
    vi.unstubAllGlobals();
  });

  it.each([false, true])("holds full loading throughout the Editor load and restores the prior %s value", async previous => {
    SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previous;
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    const observed: boolean[] = [];
    boundary.load.mockImplementation(async (_root: string, _file: string, loadedScene: Scene) => {
      observed.push(SceneLoaderFlags.ForceFullSceneLoadingForIncremental);
      new ArcRotateCamera("World camera", 1.8, 1.15, 4.25, Vector3.Zero(), loadedScene);
      await completion;
      observed.push(SceneLoaderFlags.ForceFullSceneLoadingForIncremental);
    });
    const pending = loadAuthoredNativeWorld(scene);
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith("/scene/", "native-world.babylon", scene, boundary.scripts, { quality: "high", onProgress: expect.any(Function) });
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(true);
    finish();
    await pending;
    expect(observed).toEqual([true, true]);
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(previous);
    expect(scene.useRightHandedSystem).toBe(true);
    expect(scene.activeCamera).toBe(scene.getCameraByName("World camera"));
    expect(document.title).toBe("Native asset slice · L2 Browser Client");
  });

  it.each([false, true])("restores the prior %s flag after a rejected Editor load", async previous => {
    SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previous;
    const failure = new Error("Offscreen binary geometry failed to load");
    boundary.load.mockImplementation(async (_root: string, _file: string, loadedScene: Scene) => {
      new ArcRotateCamera("World camera", 1.8, 1.15, 4.25, Vector3.Zero(), loadedScene);
      expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(true);
      await Promise.resolve();
      expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(true);
      throw failure;
    });
    await expect(loadAuthoredNativeWorld(scene)).rejects.toBe(failure);
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(previous);
    expect(document.title).toBe("Initial title");
  });
});

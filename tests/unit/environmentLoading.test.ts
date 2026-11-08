import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { loadEnvironment } from "../../src/scene/loadEnvironment";

const boundary = vi.hoisted(() => ({ load: vi.fn(), scripts: { fixture: "authored-script-map" } }));
vi.mock("babylonjs-editor-tools", () => ({ loadScene: boundary.load }));
vi.mock("../../src/scripts", () => ({ scriptsMap: boundary.scripts }));

describe("native environment loading", () => {
  let engine: NullEngine, priorFlag: boolean;
  beforeEach(() => {
    priorFlag = SceneLoaderFlags.ForceFullSceneLoadingForIncremental;
    engine = new NullEngine();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search: "?authored=1" } }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { title: "Initial title" }));
    boundary.load.mockReset();
  });
  afterEach(() => {
    engine.dispose(); SceneLoaderFlags.ForceFullSceneLoadingForIncremental = priorFlag;
    vi.unstubAllGlobals();
  });

  it.each([false, true])("holds full loading throughout the authored async load and restores the prior %s value", async previous => {
    SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previous;
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    const observed: boolean[] = [];
    boundary.load.mockImplementation(async (_root: string, _file: string, scene: Scene) => {
      observed.push(SceneLoaderFlags.ForceFullSceneLoadingForIncremental);
      new ArcRotateCamera("World camera", 1.8, 1.15, 4.25, Vector3.Zero(), scene);
      await completion;
      observed.push(SceneLoaderFlags.ForceFullSceneLoadingForIncremental);
    });
    const pending = loadEnvironment(engine);
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith("/scene/", "native-world.babylon", expect.any(Scene), boundary.scripts, { quality: "high", onProgress: expect.any(Function) });
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(true);
    finish();
    const scene = await pending;
    expect(observed).toEqual([true, true]);
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(previous);
    expect(scene.isDisposed).toBe(false); expect(scene.useRightHandedSystem).toBe(true);
    expect(scene.activeCamera).toBe(scene.getCameraByName("World camera"));
    expect(document.title).toBe("Initial title");
  });

  it.each([false, true])("restores the prior %s flag and disposes the partial scene after an authored load failure", async previous => {
    SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previous;
    const failure = new Error("Offscreen binary geometry failed to load");
    let loadedScene: Scene | undefined;
    boundary.load.mockImplementation(async (_root: string, _file: string, scene: Scene) => {
      loadedScene = scene;
      new ArcRotateCamera("World camera", 1.8, 1.15, 4.25, Vector3.Zero(), scene);
      expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(true);
      await Promise.resolve();
      expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(true);
      throw failure;
    });
    await expect(loadEnvironment(engine)).rejects.toBe(failure);
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(previous);
    expect(loadedScene?.isDisposed).toBe(true); expect(engine.scenes).toHaveLength(0);
    expect(document.title).toBe("Initial title");
  });

  it.each([
    { search: "", previous: false },
    { search: "", previous: true },
    { search: "?authored=0", previous: false },
    { search: "?character=human-female-fighter", previous: true },
    { search: "?world=courtyard", previous: false },
  ])("loads the source native scene on $search with incremental loading left at prior $previous", async ({ search, previous }) => {
    window.location.search = search;
    SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previous;
    const observed: boolean[] = [];
    boundary.load.mockImplementation(async (_root: string, _file: string, scene: Scene) => {
      observed.push(SceneLoaderFlags.ForceFullSceneLoadingForIncremental);
      new ArcRotateCamera("World camera", 1.8, 1.15, 4.25, Vector3.Zero(), scene);
      await Promise.resolve();
      observed.push(SceneLoaderFlags.ForceFullSceneLoadingForIncremental);
    });
    const scene = await loadEnvironment(engine);
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith("/scene/", "native-parity.babylon", scene, boundary.scripts, { quality: "high", onProgress: expect.any(Function) });
    expect(observed).toEqual([previous, previous]);
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(previous);
    expect(scene.isDisposed).toBe(false); expect(scene.useRightHandedSystem).toBe(true);
    expect(scene.activeCamera).toBe(scene.getCameraByName("World camera"));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { loadEnvironment } from "../../src/scene/loadEnvironment";

const boundary = vi.hoisted(() => ({ load: vi.fn(), importedWorld: vi.fn(), scripts: { fixture: "authored-script-map" } }));
vi.mock("babylonjs-editor-tools", () => ({ loadScene: boundary.load }));
vi.mock("../../src/scripts", () => ({ scriptsMap: boundary.scripts }));
vi.mock("../../src/scene/world/loadImportedWorld", () => ({ loadImportedWorld: boundary.importedWorld }));

/** Real Babylon scene lifetime and global loader flag; only the asynchronous
 * Editor loader boundary is controlled. This checks the flag at the point where
 * Editor tools decides whether to load offscreen incremental mesh geometry. */
describe("authored environment incremental geometry loading", () => {
  let engine: NullEngine, priorFlag: boolean;
  beforeEach(() => {
    priorFlag = SceneLoaderFlags.ForceFullSceneLoadingForIncremental;
    engine = new NullEngine();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search: "?world=interlude&authored=1" } }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { title: "Initial title" }));
    boundary.load.mockReset(); boundary.importedWorld.mockReset(); boundary.importedWorld.mockResolvedValue(null);
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
    expect(document.title).toBe("Native asset slice · L2 Browser Client");
    expect(boundary.importedWorld).not.toHaveBeenCalled();
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
    { search: "?world=courtyard&authored=1", file: "example.babylon", previous: false },
    { search: "?world=courtyard", file: "example.babylon", previous: true },
    { search: "?authored=1", file: "example.babylon", previous: false },
  ])("leaves ordinary-route loading unchanged for $search with prior $previous", async ({ search, file, previous }) => {
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
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith("/scene/", file, scene, boundary.scripts, { quality: "high", onProgress: expect.any(Function) });
    expect(observed).toEqual([previous, previous]);
    expect(SceneLoaderFlags.ForceFullSceneLoadingForIncremental).toBe(previous);
    expect(scene.isDisposed).toBe(false); expect(scene.activeCamera).toBe(scene.getCameraByName("World camera"));
  });
});

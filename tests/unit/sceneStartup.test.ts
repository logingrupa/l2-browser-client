import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { guardSceneStartup, type SceneStartupProgress } from "../../src/scene/guardSceneStartup";

describe("scene startup failure and progress", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("rejects a real failed Babylon delayed mesh and stops the Editor polling continuation", async () => {
    vi.useFakeTimers();
    const mesh = MeshBuilder.CreateBox("failed world geometry", {}, scene);
    mesh.geometry!.releaseForMesh(mesh);
    mesh.delayLoadingFile = "/fixture/failed.babylonbinarymeshdata";
    mesh._delayLoadingFunction = () => undefined;
    vi.spyOn(scene, "_loadDelayedFileAsync").mockRejectedValue(new Error("HTTP 502 fixture"));
    let loaderStopped = false, scriptsStarted = false;
    const loading = guardSceneStartup(scene, async onProgress => {
      try {
        mesh.delayLoadState = 4;
        mesh._checkDelayState();
        // The pinned Editor waits this way before attaching scene scripts.
        while (!scene.isDisposed && (!scene.isReady() || scene.getWaitingItemsCount() > 0)) {
          await new Promise(resolve => setTimeout(resolve, 150));
          onProgress(0.75);
        }
        onProgress(1);
        scriptsStarted = true;
      } finally { loaderStopped = true; }
    });
    await expect(loading).rejects.toThrow("World geometry could not be loaded");
    expect(scene.isDisposed).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(loaderStopped).toBe(true); expect(scriptsStarted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(engine.onContextLostObservable.observers).toHaveLength(0);
  });

  it("reports pending work and allows a slow successful geometry load to finish", async () => {
    const messages: string[] = [];
    let complete!: () => void;
    const mesh = MeshBuilder.CreateBox("loading world geometry", {}, scene);
    const loading = guardSceneStartup(scene, async onProgress => {
      mesh.delayLoadState = 2; scene.addPendingData(mesh);
      onProgress(Number.NaN);
      await new Promise<void>(resolve => { complete = resolve; });
      mesh.delayLoadState = 1; scene.removePendingData(mesh);
      onProgress(1);
    }, { onStatus: message => messages.push(message) });
    expect(scene.isDisposed).toBe(false);
    expect(messages).toContain("Loading world… 1 resources pending");
    expect(messages.every(message => !message.includes("NaN"))).toBe(true);
    complete(); await loading;
    expect(scene.isDisposed).toBe(false);
    expect(messages.at(-1)).toBe("World files loaded…");
  });

  it("reports measured current-step progress and leaves graphics duration indeterminate", async () => {
    const reports: SceneStartupProgress[] = [];
    await guardSceneStartup(scene, async onProgress => {
      onProgress(0.125); // The pinned Editor maps the world download to 0..0.5.
      const mesh = MeshBuilder.CreateBox("measured geometry", {}, scene);
      mesh.delayLoadingFile = "/fixture/geometry.babylonbinarymeshdata";
      mesh.delayLoadState = 2; scene.addPendingData(mesh);
      onProgress(0.5);
      mesh.delayLoadState = 1; scene.removePendingData(mesh);
      onProgress(0.75);
    }, { onStatus: (_message, progress) => { if (progress) reports.push(progress); } });
    expect(reports).toContainEqual({ stage: "world", detail: "Downloading the world description…", measurement: { completed: .25, total: 1, label: "World data downloaded" } });
    expect(reports.find(report => report.stage === "assets")?.measurement).toEqual({ completed: 0, total: 1, label: "Scene items ready" });
    expect(reports.find(report => report.stage === "graphics")?.measurement).toBeUndefined();
    expect(reports.some(report => report.stage === "enter")).toBe(false);
    expect(reports.at(-1)).toEqual({ stage: "assets", detail: "World files loaded. Preparing characters and controls…" });
  });

  it("rejects a failed texture instead of accepting a scene with a missing material input", async () => {
    const texture = new BaseTexture(scene);
    vi.spyOn(texture, "loadingError", "get").mockReturnValue(true);
    await expect(guardSceneStartup(scene, async onProgress => { onProgress(0.75); }))
      .rejects.toThrow("A world texture could not be loaded");
    expect(scene.isDisposed).toBe(true);
  });

  it("bounds a never-ready scene and removes every guard timer", async () => {
    vi.useFakeTimers();
    const loading = guardSceneStartup(scene, () => new Promise<void>(() => undefined), { timeoutMs: 1000 });
    const rejection = expect(loading).rejects.toThrow("World loading took too long");
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    await vi.advanceTimersByTimeAsync(1); // Babylon defers observable removal.
    expect(scene.isDisposed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it("reports context loss during loading and detaches the context observer", async () => {
    const loading = guardSceneStartup(scene, () => new Promise<void>(() => undefined));
    const rejection = expect(loading).rejects.toThrow("browser lost its graphics connection");
    engine.onContextLostObservable.notifyObservers(engine);
    await rejection;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scene.isDisposed).toBe(true);
    expect(engine.onContextLostObservable.observers).toHaveLength(0);
  });

  it("preserves synchronous loader errors and cancels an externally disposed scene", async () => {
    const failure = new Error("Malformed scene document");
    await expect(guardSceneStartup(scene, () => { throw failure; })).rejects.toBe(failure);
    expect(scene.isDisposed).toBe(true);
    scene = new Scene(engine);
    const dispose = vi.spyOn(scene, "dispose");
    const loading = guardSceneStartup(scene, () => new Promise<void>(() => undefined));
    const rejection = expect(loading).rejects.toThrow("World loading was cancelled");
    scene.dispose(); await rejection;
    expect(dispose).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(engine.onContextLostObservable.observers).toHaveLength(0);
  });
});

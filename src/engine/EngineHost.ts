import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { createWebGPUEngine } from "./createWebGPUEngine";
import type { Scene } from "@babylonjs/core/scene";
import { isSceneSuspended } from "./renderSuspension";
import type { SceneStartupProgress } from "../scene/guardSceneStartup";
import { getLoadingScreen } from "../ui/LoadingScreen";

export class EngineHost {
  private readonly resize = (): void => this.engine.resize();

  static async create(canvas: HTMLCanvasElement): Promise<EngineHost> {
    return new EngineHost(await createWebGPUEngine(canvas, { reloadOnDeviceLoss: true }));
  }

  private constructor(readonly engine: WebGPUEngine) {
    const loadingScreen = getLoadingScreen();
    this.engine.loadingScreen = {
      loadingUIText: "Entering the world…",
      loadingUIBackgroundColor: "#202522",
      displayLoadingUI: () => loadingScreen?.show(),
      // The file loader can hide its UI before material compilation finishes.
      // App removes this panel only after the complete startup succeeds.
      hideLoadingUI: () => undefined,
    };
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 1.5));
    window.addEventListener("resize", this.resize);
  }

  run(scene: Scene, onError: (error: unknown) => void): () => void {
    const render = () => {
      try { if (!scene.isDisposed && !isSceneSuspended(scene)) scene.render(); }
      catch (error) { this.engine.stopRenderLoop(render); onError(error); }
    };
    const lost = this.engine.onContextLostObservable.add(() => {
      this.engine.stopRenderLoop(render);
      onError(new Error("The browser lost its WebGPU graphics connection. Reload to try again."));
    });
    this.engine.runRenderLoop(render);
    return () => {
      this.engine.stopRenderLoop(render);
      this.engine.onContextLostObservable.remove(lost);
    };
  }

  setLoadingStatus(message: string, progress?: SceneStartupProgress): void {
    getLoadingScreen()?.update(progress ?? { stage: "world", detail: message });
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}

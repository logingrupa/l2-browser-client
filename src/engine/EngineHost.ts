import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";

export class EngineHost {
  readonly engine: Engine;
  private readonly resize = (): void => this.engine.resize();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, powerPreference: "high-performance" });
    const loadingMessage = document.getElementById("loading");
    this.engine.loadingScreen = {
      loadingUIText: "Entering the proving grounds…",
      loadingUIBackgroundColor: "#202522",
      displayLoadingUI: () => loadingMessage?.removeAttribute("hidden"),
      hideLoadingUI: () => loadingMessage?.setAttribute("hidden", ""),
    };
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 1.5));
    window.addEventListener("resize", this.resize);
  }

  run(scene: Scene): void {
    this.engine.runRenderLoop(() => scene.render());
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.engine.stopRenderLoop();
    this.engine.dispose();
  }
}

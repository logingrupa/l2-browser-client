// Native Vanilla template entry, adapted from Babylon.js Editor (Apache-2.0).
import type { Scene } from "@babylonjs/core/scene";
import { EngineHost } from "./engine/EngineHost";
import { loadEnvironment } from "./scene/loadEnvironment";

export class App {
  private host: EngineHost | undefined;
  private scene: Scene | undefined;
  private isDisposed = false;

  async init(): Promise<void> {
    const canvas = document.getElementById("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("World canvas is missing.");
    this.host = new EngineHost(canvas);
    this.scene = await loadEnvironment(this.host.engine);
    if (this.isDisposed) { this.scene.dispose(); return; }
    this.host.engine.hideLoadingUI();
    document.getElementById("loading")?.remove();
    this.host.run(this.scene);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.scene?.dispose();
    this.host?.dispose();
  }
}

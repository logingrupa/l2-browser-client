import type { Scene } from "@babylonjs/core/scene";
import { EngineHost } from "./engine/EngineHost";
import { loadEnvironment } from "./scene/loadEnvironment";
import { prepareSceneForReveal } from "./scene/prepareSceneForReveal";
import { showLoadingError } from "./ui/LoadingScreen";

export class App {
  private host: EngineHost | undefined;
  private scene: Scene | undefined;
  private isDisposed = false;
  private readonly lifetime = new AbortController();
  private isReady = false;
  private closeInspector: (() => Promise<void>) | undefined;

  async init(): Promise<void> {
    if (this.isDisposed) return;
    const canvas = document.getElementById("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("World canvas is missing.");
    const host = await EngineHost.create(canvas);
    if (this.isDisposed) { host.dispose(); return; }
    this.host = host;
    this.scene = await loadEnvironment(this.host.engine, (message, progress) => this.host?.setLoadingStatus(message, progress));
    if (this.isDisposed) { this.scene.dispose(); return; }
    const frame = await prepareSceneForReveal(this.scene, onError => this.host!.run(this.scene!, error => {
      if (!this.isReady) { onError(error); return; }
      this.dispose();
      document.body.dataset.worldState = "loading";
      showLoadingError(error);
    }), {
      signal: this.lifetime.signal,
      onProgress: progress => this.host?.setLoadingStatus(progress.detail, progress),
    });
    if (this.isDisposed) return;
    this.isReady = true;
    canvas.dataset.readyFrame = String(frame);
    document.body.dataset.worldState = "ready";
    document.getElementById("app")?.removeAttribute("inert");
    document.getElementById("loading")?.remove();
    if (new URLSearchParams(window.location.search).get("inspect") === "1") await this.openInspector(this.scene);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.lifetime.abort();
    if (this.closeInspector) void this.closeInspector();
    this.scene?.dispose();
    this.host?.dispose();
  }

  private async openInspector(scene: Scene): Promise<void> {
    const { openBabylonInspector } = await import("./scene/openBabylonInspector");
    if (this.isDisposed) return;
    const closeInspector = await openBabylonInspector(scene);
    if (this.isDisposed) { void closeInspector(); return; }
    this.closeInspector = closeInspector;
  }
}

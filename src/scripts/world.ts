import type { Scene } from "@babylonjs/core/scene";
import type { IScript } from "babylonjs-editor-tools";
import { createWorldRuntime } from "../runtime/createWorldRuntime";

/** Attached to the authored scene; runs in Editor play and the native Vite app. */
export default class WorldScript implements IScript {
  private stopRuntime: (() => void) | undefined;
  constructor(private readonly scene: Scene) {}
  onStart(): void { this.stopRuntime = createWorldRuntime(this.scene); }
  onStop(): void { this.stopRuntime?.(); this.stopRuntime = undefined; }
}

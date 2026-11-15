import type { Scene } from "@babylonjs/core/scene";

const suspended = new WeakSet<Scene>();
export function setSceneSuspended(scene: Scene, value: boolean): void {
  if (value) suspended.add(scene); else suspended.delete(scene);
}
export function isSceneSuspended(scene: Scene): boolean { return suspended.has(scene); }

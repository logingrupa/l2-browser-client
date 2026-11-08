import type { Scene } from "@babylonjs/core/scene";

export async function openBabylonInspector(scene: Scene): Promise<() => Promise<void>> {
  const { ShowInspector } = await import("@babylonjs/inspector");
  const inspectorToken = ShowInspector(scene, { layoutMode: "overlay" });
  return () => inspectorToken.dispose();
}

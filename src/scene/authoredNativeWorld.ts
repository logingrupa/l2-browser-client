import "@babylonjs/core/Shaders/lightProxy.vertex";
import "@babylonjs/core/Shaders/lightProxy.fragment";
import "@babylonjs/core/ShadersWGSL/lightProxy.vertex";
import "@babylonjs/core/ShadersWGSL/lightProxy.fragment";
import type { Scene } from "@babylonjs/core/scene";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { loadScene } from "babylonjs-editor-tools";
import { scriptsMap } from "../scripts";
import { guardSceneStartup, type SceneStartupOptions } from "./guardSceneStartup";
import { nativeSliceDocumentTitle } from "./documentTitles";

export async function loadAuthoredNativeWorld(scene: Scene, onStatus?: SceneStartupOptions["onStatus"]): Promise<void> {
  const previousFullLoading = SceneLoaderFlags.ForceFullSceneLoadingForIncremental;
  SceneLoaderFlags.ForceFullSceneLoadingForIncremental = true;
  try {
    await guardSceneStartup(scene,
      onProgress => loadScene("/scene/", "native-world.babylon", scene, scriptsMap, { quality: "high", onProgress }),
      onStatus ? { onStatus } : {});
  } finally {
    SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previousFullLoading;
  }
  scene.useRightHandedSystem = true;
  scene.activeCamera = scene.getCameraByName("World camera");
  document.title = nativeSliceDocumentTitle;
}

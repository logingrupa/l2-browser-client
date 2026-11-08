import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import "@babylonjs/core/Cameras/arcRotateCamera";
import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import "@babylonjs/core/Meshes/groundMesh";
import "@babylonjs/core/Lights/hemisphericLight";
import "@babylonjs/core/Lights/directionalLight";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Materials/PBR/pbrMaterial";
import "@babylonjs/core/Materials/shaderMaterial";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/ShadersWGSL/default.vertex";
import "@babylonjs/core/ShadersWGSL/default.fragment";
import "@babylonjs/core/Shaders/lightProxy.vertex";
import "@babylonjs/core/Shaders/lightProxy.fragment";
import "@babylonjs/core/Shaders/pbr.vertex";
import "@babylonjs/core/Shaders/pbr.fragment";
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/Shaders/rgbdDecode.fragment";
import "@babylonjs/core/ShadersWGSL/lightProxy.vertex";
import "@babylonjs/core/ShadersWGSL/lightProxy.fragment";
import "@babylonjs/core/ShadersWGSL/pbr.vertex";
import "@babylonjs/core/ShadersWGSL/pbr.fragment";
import "@babylonjs/core/ShadersWGSL/postprocess.vertex";
import "@babylonjs/core/ShadersWGSL/rgbdDecode.fragment";
import "@babylonjs/core/Materials/imageProcessingConfiguration";
import "@babylonjs/core/Materials/colorCurves";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { loadScene } from "babylonjs-editor-tools";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { scriptsMap } from "../scripts";
import { guardSceneStartup, type SceneStartupProgress } from "./guardSceneStartup";
import { requireSceneStartup } from "./prepareSceneForReveal";

export async function loadEnvironment(engine: AbstractEngine, onStatus?: (message: string, progress?: SceneStartupProgress) => void): Promise<Scene> {
  const scene = new Scene(engine);
  try {
    requireSceneStartup(scene, "native-world");
    const loadsEditorSavedWorld = new URLSearchParams(window.location.search).get("authored") === "1";
    const previousFullLoading = SceneLoaderFlags.ForceFullSceneLoadingForIncremental;
    try {
      if (loadsEditorSavedWorld) SceneLoaderFlags.ForceFullSceneLoadingForIncremental = true;
      await guardSceneStartup(scene,
        onProgress => loadScene("/scene/", loadsEditorSavedWorld ? "native-world.babylon" : "native-parity.babylon", scene, scriptsMap, { quality: "high", onProgress }),
        onStatus ? { onStatus } : {});
    } finally { SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previousFullLoading; }
    scene.useRightHandedSystem = true;
    scene.activeCamera = scene.getCameraByName("World camera");
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

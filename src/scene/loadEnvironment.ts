import { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import "@babylonjs/core/Meshes/groundMesh";
import "@babylonjs/core/Lights/hemisphericLight";
import "@babylonjs/core/Lights/directionalLight";
import "@babylonjs/core/Materials/standardMaterial";
// Register the default WebGL shaders before serialized materials are parsed.
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/Materials/imageProcessingConfiguration";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { loadScene } from "babylonjs-editor-tools";
import { scriptsMap } from "../scripts";

export async function loadEnvironment(engine: Engine): Promise<Scene> {
  const scene = new Scene(engine);
  try {
    await loadScene("/scene/", "example.babylon", scene, scriptsMap, { quality: "high" });
    const camera = scene.getCameraByName("World camera");
    if (!(camera instanceof ArcRotateCamera)) throw new Error("The authored World camera must be an ArcRotateCamera.");
    scene.activeCamera = camera;
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

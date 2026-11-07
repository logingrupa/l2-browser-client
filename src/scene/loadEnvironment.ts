import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import "@babylonjs/core/Meshes/groundMesh";
import "@babylonjs/core/Lights/hemisphericLight";
import "@babylonjs/core/Lights/directionalLight";
import "@babylonjs/core/Materials/standardMaterial";
// Register both shader languages before serialized materials are parsed.
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/ShadersWGSL/default.vertex";
import "@babylonjs/core/ShadersWGSL/default.fragment";
// Editor tools create a clustered-light container even for these two lights.
// Register its shaders before loadScene forces compilation (dynamic imports race).
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
import { loadImportedWorld } from "./world/loadImportedWorld";
import { setImportedEnvironment } from "./environmentContext";
import { guardSceneStartup, type SceneStartupProgress } from "./guardSceneStartup";
import { requireSceneStartup } from "./prepareSceneForReveal";

export async function loadEnvironment(engine: AbstractEngine, onStatus?: (message: string, progress?: SceneStartupProgress) => void): Promise<Scene> {
  const scene = new Scene(engine);
  const loadAuthoredScene = (file: string) => guardSceneStartup(scene,
    onProgress => loadScene("/scene/", file, scene, scriptsMap, { quality: "high", onProgress }),
    onStatus ? { onStatus } : {});
  try {
    if (new URLSearchParams(window.location.search).get("world") === "interlude") {
      requireSceneStartup(scene, "native-world");
      const authored = new URLSearchParams(window.location.search).get("authored") === "1";
      const previousFullLoading = SceneLoaderFlags.ForceFullSceneLoadingForIncremental;
      try {
        // The bounded authored section validates every placement before actors
        // start. Load its offscreen binary geometry before those script hooks.
        if (authored) SceneLoaderFlags.ForceFullSceneLoadingForIncremental = true;
        await loadAuthoredScene(authored ? "native-world.babylon" : "native-parity.babylon");
      } finally { SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previousFullLoading; }
      scene.useRightHandedSystem = true;
      scene.activeCamera = scene.getCameraByName("World camera");
      document.title = "Native asset slice · L2 Browser Client";
      return scene;
    }
    await loadAuthoredScene("example.babylon");
    const camera = scene.getCameraByName("World camera");
    if (!(camera instanceof ArcRotateCamera)) throw new Error("The authored World camera must be an ArcRotateCamera.");
    scene.activeCamera = camera;
    if (new URLSearchParams(window.location.search).get("world") !== "courtyard") {
      const authoredMeshes = [...scene.meshes];
      scene.useRightHandedSystem = true;
      const world = await loadImportedWorld(scene);
      if (world) {
        setImportedEnvironment(scene, world);
        for (const mesh of authoredMeshes) mesh.setEnabled(false);
        scene.clearColor = new Color4(0.58, 0.71, 0.8, 1);
        camera.setTarget(world.spawnPoint.add(new Vector3(0, 0.5, 0)));
        camera.alpha = -Math.PI / 2.5;
        camera.beta = 1.1;
        camera.radius = 8;
        camera.lowerRadiusLimit = 1;
        camera.upperRadiusLimit = 50;
        camera.minZ = 0.05;
        camera.maxZ = 4000;
        document.title = "Talking Island · L2 Browser Client";
      } else {
        scene.useRightHandedSystem = false;
      }
    }
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

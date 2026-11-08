import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "./registerSceneShaders";
import { loadScene } from "babylonjs-editor-tools";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { scriptsMap } from "../scripts";
import { loadImportedWorld } from "./world/loadImportedWorld";
import { setImportedEnvironment } from "./environmentContext";
import { guardSceneStartup, type SceneStartupProgress } from "./guardSceneStartup";
import { requireSceneStartup } from "./prepareSceneForReveal";
import { buildPresentationScene } from "./buildPresentationScene";
import { nativeSandboxPresentation, talkingIslandCameraOverrides } from "./presentationConfiguration";
import { startNativeSandboxRuntime } from "../runtime/startNativeSandboxRuntime";
import { nativeSandboxConfiguration } from "../runtime/nativeSandboxConfiguration";

type EnvironmentStatusListener = (message: string, progress?: SceneStartupProgress) => void;

const nativeSliceDocumentTitle = "Native asset slice · L2 Browser Client";

function loadNativeSandboxWorld(engine: AbstractEngine): Scene {
  const { scene } = buildPresentationScene(engine, nativeSandboxPresentation);
  try {
    document.title = nativeSliceDocumentTitle;
    startNativeSandboxRuntime(scene, nativeSandboxConfiguration);
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

export async function loadEnvironment(engine: AbstractEngine, onStatus?: EnvironmentStatusListener): Promise<Scene> {
  const query = new URLSearchParams(window.location.search);
  const isNativeWorld = query.get("world") === "interlude";
  const isAuthoredNativeWorld = isNativeWorld && query.get("authored") === "1";
  if (isNativeWorld && !isAuthoredNativeWorld) return loadNativeSandboxWorld(engine);
  const scene = new Scene(engine);
  const loadAuthoredScene = (file: string) => guardSceneStartup(scene,
    onProgress => loadScene("/scene/", file, scene, scriptsMap, { quality: "high", onProgress }),
    onStatus ? { onStatus } : {});
  try {
    if (isAuthoredNativeWorld) {
      requireSceneStartup(scene, "native-world");
      const previousFullLoading = SceneLoaderFlags.ForceFullSceneLoadingForIncremental;
      try {
        SceneLoaderFlags.ForceFullSceneLoadingForIncremental = true;
        await loadAuthoredScene("native-world.babylon");
      } finally { SceneLoaderFlags.ForceFullSceneLoadingForIncremental = previousFullLoading; }
      scene.useRightHandedSystem = true;
      scene.activeCamera = scene.getCameraByName("World camera");
      document.title = nativeSliceDocumentTitle;
      return scene;
    }
    await loadAuthoredScene("example.babylon");
    const camera = scene.getCameraByName("World camera");
    if (!(camera instanceof ArcRotateCamera)) throw new Error("The authored World camera must be an ArcRotateCamera.");
    scene.activeCamera = camera;
    if (query.get("world") !== "courtyard") {
      const authoredMeshes = [...scene.meshes];
      scene.useRightHandedSystem = true;
      const world = await loadImportedWorld(scene);
      if (world) {
        setImportedEnvironment(scene, world);
        for (const mesh of authoredMeshes) mesh.setEnabled(false);
        scene.clearColor = Color4.FromArray(talkingIslandCameraOverrides.clearColor);
        camera.setTarget(world.spawnPoint.add(Vector3.FromArray(talkingIslandCameraOverrides.targetOffsetAboveSpawnPoint)));
        camera.alpha = talkingIslandCameraOverrides.alpha;
        camera.beta = talkingIslandCameraOverrides.beta;
        camera.radius = talkingIslandCameraOverrides.radius;
        camera.lowerRadiusLimit = talkingIslandCameraOverrides.lowerRadiusLimit;
        camera.upperRadiusLimit = talkingIslandCameraOverrides.upperRadiusLimit;
        camera.minZ = talkingIslandCameraOverrides.minZ;
        camera.maxZ = talkingIslandCameraOverrides.maxZ;
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

import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "./registerSceneShaders";
import { loadScene } from "babylonjs-editor-tools";
import { scriptsMap } from "../scripts";
import { loadImportedWorld } from "./world/loadImportedWorld";
import { setImportedEnvironment } from "./environmentContext";
import { guardSceneStartup, type SceneStartupOptions } from "./guardSceneStartup";
import { requireSceneStartup } from "./prepareSceneForReveal";
import { buildPresentationScene } from "./buildPresentationScene";
import { nativeSandboxPresentation, talkingIslandCameraOverrides } from "./presentationConfiguration";
import { nativeSliceDocumentTitle, talkingIslandDocumentTitle } from "./documentTitles";
import { startNativeSandboxRuntime } from "../runtime/startNativeSandboxRuntime";
import { nativeSandboxConfiguration } from "../runtime/nativeSandboxConfiguration";

type EnvironmentStatusListener = SceneStartupOptions["onStatus"];

function loadNativeSandboxWorld(engine: AbstractEngine): Scene {
  const { scene, camera } = buildPresentationScene(engine, nativeSandboxPresentation);
  try {
    document.title = nativeSliceDocumentTitle;
    startNativeSandboxRuntime(scene, camera, nativeSandboxConfiguration);
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

async function loadAuthoredNativeWorldOnDemand(scene: Scene, onStatus: EnvironmentStatusListener): Promise<void> {
  requireSceneStartup(scene, "native-world");
  const { loadAuthoredNativeWorld } = await import("./authoredNativeWorld");
  await loadAuthoredNativeWorld(scene, onStatus);
}

async function loadReferenceWorld(scene: Scene, onStatus: EnvironmentStatusListener, isCourtyard: boolean): Promise<void> {
  await guardSceneStartup(scene,
    onProgress => loadScene("/scene/", "example.babylon", scene, scriptsMap, { quality: "high", onProgress }),
    onStatus ? { onStatus } : {});
  const camera = scene.getCameraByName("World camera");
  if (!(camera instanceof ArcRotateCamera)) throw new Error("The authored World camera must be an ArcRotateCamera.");
  scene.activeCamera = camera;
  if (isCourtyard) return;
  const authoredMeshes = [...scene.meshes];
  scene.useRightHandedSystem = true;
  const world = await loadImportedWorld(scene);
  if (!world) {
    scene.useRightHandedSystem = false;
    return;
  }
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
  document.title = talkingIslandDocumentTitle;
}

export async function loadEnvironment(engine: AbstractEngine, onStatus?: EnvironmentStatusListener): Promise<Scene> {
  const query = new URLSearchParams(window.location.search);
  const isNativeWorld = query.get("world") === "interlude";
  const isAuthoredNativeWorld = isNativeWorld && query.get("authored") === "1";
  if (isNativeWorld && !isAuthoredNativeWorld) return loadNativeSandboxWorld(engine);
  const scene = new Scene(engine);
  try {
    if (isAuthoredNativeWorld) await loadAuthoredNativeWorldOnDemand(scene, onStatus);
    else await loadReferenceWorld(scene, onStatus, query.get("world") === "courtyard");
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

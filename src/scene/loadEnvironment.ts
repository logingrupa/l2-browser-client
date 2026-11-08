import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "./registerSceneShaders";
import { loadImportedWorld, type ImportedWorld } from "./world/loadImportedWorld";
import { setImportedEnvironment } from "./environmentContext";
import type { SceneStartupOptions } from "./guardSceneStartup";
import { requireSceneStartup } from "./prepareSceneForReveal";
import { buildPresentationScene } from "./buildPresentationScene";
import { nativeSandboxPresentation, referenceWorldPresentation, talkingIslandCameraOverrides } from "./presentationConfiguration";
import { nativeSliceDocumentTitle, talkingIslandDocumentTitle } from "./documentTitles";
import { startNativeSandboxRuntime } from "../runtime/startNativeSandboxRuntime";
import { nativeSandboxConfiguration } from "../runtime/nativeSandboxConfiguration";
import { createWorldRuntime } from "../runtime/createWorldRuntime";

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

async function loadAuthoredNativeWorldOnDemand(engine: AbstractEngine, onStatus: EnvironmentStatusListener): Promise<Scene> {
  const scene = new Scene(engine);
  try {
    requireSceneStartup(scene, "native-world");
    const { loadAuthoredNativeWorld } = await import("./authoredNativeWorld");
    await loadAuthoredNativeWorld(scene, onStatus);
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

function applyTalkingIslandCameraOverrides(scene: Scene, camera: ArcRotateCamera, world: ImportedWorld): void {
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

async function loadReferenceWorld(engine: AbstractEngine): Promise<Scene> {
  const { scene, camera } = buildPresentationScene(engine, referenceWorldPresentation);
  try {
    const world = await loadImportedWorld(scene);
    if (world) {
      setImportedEnvironment(scene, world);
      applyTalkingIslandCameraOverrides(scene, camera, world);
    }
    const stopWorldRuntime = createWorldRuntime(scene, camera);
    scene.onDisposeObservable.addOnce(stopWorldRuntime);
    return scene;
  } catch (error: unknown) {
    scene.dispose();
    throw error;
  }
}

export async function loadEnvironment(engine: AbstractEngine, onStatus?: EnvironmentStatusListener): Promise<Scene> {
  const query = new URLSearchParams(window.location.search);
  if (query.get("world") !== "interlude") return loadReferenceWorld(engine);
  if (query.get("authored") === "1") return loadAuthoredNativeWorldOnDemand(engine, onStatus);
  return loadNativeSandboxWorld(engine);
}

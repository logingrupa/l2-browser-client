import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import "./registerSceneShaders";
import type { SceneStartupOptions } from "./guardSceneStartup";
import { requireSceneStartup } from "./prepareSceneForReveal";
import { buildPresentationScene } from "./buildPresentationScene";
import { nativeSandboxPresentation } from "./presentationConfiguration";
import { nativeSliceDocumentTitle } from "./documentTitles";
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

export async function loadEnvironment(engine: AbstractEngine, onStatus?: EnvironmentStatusListener): Promise<Scene> {
  if (new URLSearchParams(window.location.search).get("authored") === "1") return loadAuthoredNativeWorldOnDemand(engine, onStatus);
  return loadNativeSandboxWorld(engine);
}

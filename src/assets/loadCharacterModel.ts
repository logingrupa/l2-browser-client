import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import "./package/nativeSkinWeights";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";

/** Validate the response before Babylon parses it; HTML fallbacks are common in dev servers. */
export async function loadCharacterModel(
  scene: Scene, modelUrl: string, signal: AbortSignal,
): Promise<AssetContainer> {
  const response = await fetch(modelUrl, { signal });
  if (!response.ok) throw new Error(`Model request returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  if (bytes.byteLength < 12) throw new Error("Model response is not a binary glTF file.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2
    || header.getUint32(8, true) !== bytes.byteLength) {
    throw new Error("Model response is not a valid glTF 2 binary.");
  }
  // Binary input still needs a base URL for folder-relative dependencies.
  const resolvedUrl = new URL(response.url || modelUrl, globalThis.location?.href ?? "http://localhost/");
  const container = await LoadAssetContainerAsync(bytes, scene, {
    pluginExtension: ".glb", rootUrl: new URL(".", resolvedUrl).href,
    name: resolvedUrl.pathname.split("/").at(-1) ?? "character.glb",
    pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } },
  });
  if (signal.aborted || scene.isDisposed) {
    container.dispose();
    signal.throwIfAborted();
    throw new Error("The character scene was disposed while the model loaded.");
  }
  return container;
}

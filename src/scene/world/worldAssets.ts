import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";

export const WORLD_SOURCE = "feeee654b2804b11fe7df871d912251cf65d6210";
export const WORLD_PINS = {
  terrain: "9deb41bc2e7d5e0289bfed51fe45d6ac850eb5c8c153600e44fb687bb9ee5920",
  models: "cfdb7b561b26ee9ea72612778a3ded183fd36ea8ac333141cff9b7e76e3bda6f",
  surfaces: "0258a92e316692473f9e78893885959c3fe4622a5be8db9a5e48cf461cd82c4a",
  locations: "1d284ac39658ce6cbc7558f9ea5051851bb5514e9ebaa52af913c343b2fbb7ce",
} as const;

export async function verifiedWorldBytes(url: string, expected: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!/^\/assets\/world\/[A-Za-z0-9._/-]+$/.test(url) || url.includes("..") || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("Invalid local world asset descriptor.");
  }
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`World asset unavailable: ${url} (HTTP ${response.status}). Run pnpm world:stage.`);
  const buffer = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error(`World asset hash mismatch: ${url}. Run pnpm world:stage --verify.`);
  return new Uint8Array(buffer);
}

export async function verifiedWorldJson<T>(url: string, expected: string, signal?: AbortSignal): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await verifiedWorldBytes(url, expected, signal))) as T;
}

export async function loadWorldModel(scene: Scene, url: string, hash: string): Promise<AssetContainer> {
  const bytes = await verifiedWorldBytes(url, hash);
  if (scene.isDisposed) throw new Error("World scene was disposed during asset loading.");
  const container = await LoadAssetContainerAsync(bytes, scene, {
    pluginExtension: ".glb", rootUrl: url.slice(0, url.lastIndexOf("/") + 1), name: url.split("/").at(-1) ?? "world.glb",
  });
  if (scene.isDisposed) { container.dispose(); throw new Error("World scene was disposed during asset loading."); }
  return container;
}

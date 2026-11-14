import type { NativeWindowTextureResolution } from "./nativeWindowManifestLoader";

export type TextureImageState = { readonly status: "loading" } | NativeWindowTextureResolution;

export function showTextureImage(target: HTMLElement, state: TextureImageState, placeImage: (image: HTMLElement) => void): void {
  target.setAttribute("data-native-texture-state", state.status);
  const existing = target.querySelector("img");
  if (state.status !== "resolved") {
    existing?.remove();
    return;
  }
  if (existing?.getAttribute("src") === state.url) return placeImage(existing);
  existing?.remove();
  const imageElement = document.createElement("img");
  imageElement.setAttribute("alt", "");
  imageElement.setAttribute("src", state.url);
  placeImage(imageElement);
  target.append(imageElement);
}

import type { NativeMinimapRouteRadar, NativeTextureArchivePin } from "./nativeMinimapRoute";
import { showTextureImage, type TextureImageState } from "./nativeTextureImageElement";
import {
  chooseNewRadarTexture, newRadarTextureAbsentReason, newRadarTextureAnchorGapReason, newRadarTriggerSourceGapReason,
} from "./newRadarTextureChoice";
import type { RadarZoneNameSample } from "./radarZoneName";

export type RadarZoneNameState = RadarZoneNameSample | { readonly status: "loading" };

export interface RenderedNewRadarTextureMap {
  show(zoneName: RadarZoneNameState, radar: NativeMinimapRouteRadar, textureImage: (texture: NativeTextureArchivePin) => TextureImageState): void;
}

const textureMapPlacement = "fills the control, presentation";

function fillControl(image: HTMLElement): void {
  image.style.position = "absolute";
  image.style.left = "0px";
  image.style.top = "0px";
  image.style.width = "100%";
  image.style.height = "100%";
}

export function renderNewRadarTextureMap(controlElement: HTMLElement): RenderedNewRadarTextureMap {
  const textureMapElement = document.createElement("div");
  textureMapElement.setAttribute("data-native-radar-texture-map", "");
  textureMapElement.setAttribute("data-native-radar-texture-placement", textureMapPlacement);
  fillControl(textureMapElement);
  controlElement.append(textureMapElement);
  const setAttribute = (name: string, value: string | null): void => {
    if (value === null) textureMapElement.removeAttribute(name);
    else textureMapElement.setAttribute(name, value);
  };
  return {
    show: (zoneName, radar, textureImage) => {
      const choice = zoneName.status === "named" ? chooseNewRadarTexture(radar, zoneName.zoneName) : null;
      setAttribute("data-native-radar-zone-name", zoneName.status === "named" ? zoneName.zoneName : null);
      setAttribute("data-native-radar-texture", choice?.texture?.object ?? null);
      setAttribute("data-native-radar-is-global", choice === null ? null : String(choice.isGlobal));
      const state: TextureImageState = zoneName.status === "loading" ? zoneName : zoneName.status === "gap" ? zoneName
        : choice!.texture === null ? { status: "gap", reason: newRadarTextureAbsentReason } : textureImage(choice!.texture);
      showTextureImage(textureMapElement, state, fillControl);
      const gaps = [newRadarTriggerSourceGapReason, newRadarTextureAnchorGapReason, ...(state.status === "gap" ? [state.reason] : [])];
      textureMapElement.setAttribute("data-native-gap", gaps.join(" "));
    },
  };
}

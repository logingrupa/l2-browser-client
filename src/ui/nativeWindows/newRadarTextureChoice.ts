import type { NativeMinimapRouteRadar, NativeMinimapRouteTexture } from "./nativeMinimapRoute";

export interface NewRadarTextureChoice {
  readonly matchedZoneName: string | null;
  readonly texture: NativeMinimapRouteTexture | null;
  readonly isGlobal: boolean;
}

export const newRadarTriggerSourceGapReason = "minimap-join-unresolved:zone-title-source";
export const newRadarTextureAnchorGapReason = "minimap-join-unresolved:radar-anchor";
export const newRadarTextureAbsentReason = "route-texture-absent";

function foldAsciiCase(text: string): string {
  return text.replace(/[A-Z]/g, letter => letter.toLowerCase());
}

export function chooseNewRadarTexture(radar: NativeMinimapRouteRadar, zoneName: string): NewRadarTextureChoice {
  const foldedZoneName = foldAsciiCase(zoneName);
  const matched = radar.cases.find(radarCase => foldAsciiCase(radarCase.zoneName) === foldedZoneName);
  if (matched === undefined) return { matchedZoneName: null, texture: radar.default.texture, isGlobal: true };
  return { matchedZoneName: matched.zoneName, texture: matched.texture, isGlobal: false };
}

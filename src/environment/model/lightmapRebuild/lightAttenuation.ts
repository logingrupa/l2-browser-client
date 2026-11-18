import type { ShadowAttenuationInput } from "./lightAttenuationGeometry";
import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import { requireByte, type LightmapRebuildResult, type NativeVector3 } from "./lightmapRebuildTypes";
import { attenuatePointFalloff } from "./pointFalloffAttenuation";
import { attenuateSpotCone } from "./spotConeAttenuation";
import { attenuateSunDirection } from "./sunDirectionAttenuation";

export type LightAttenuationBranch = "sun-direction" | "spot-cone" | "point-falloff";
export type UnportedLightEffectReason = `bsp-rebuild-light-effect-unported:${number}`;

export type AttenuationLight =
  | { readonly branch: "sun-direction"; readonly direction: NativeVector3 }
  | { readonly branch: "point-falloff"; readonly position: NativeVector3; readonly radius: number }
  | { readonly branch: "spot-cone"; readonly position: NativeVector3; readonly radius: number; readonly cone: number; readonly spotDirection: NativeVector3 };

const { lightEffectBranches } = LIGHTMAP_REBUILD_CONSTANTS;
const unportedLightEffects: ReadonlySet<number> = new Set(lightEffectBranches.value.unported);
const spotConeLightEffects: ReadonlySet<number> = new Set(lightEffectBranches.value.spotCone);

export function lightAttenuationBranch(lightEffect: number): LightmapRebuildResult<LightAttenuationBranch, UnportedLightEffectReason> {
  requireByte(lightEffect, "LightEffect");
  if (lightEffect === lightEffectBranches.value.sunDirection) return { status: "resolved", value: "sun-direction" };
  if (spotConeLightEffects.has(lightEffect)) return { status: "resolved", value: "spot-cone" };
  if (unportedLightEffects.has(lightEffect)) return { status: "unresolved", reason: `bsp-rebuild-light-effect-unported:${lightEffect}` };
  return { status: "resolved", value: "point-falloff" };
}

export function attenuateShadowIntensities(input: ShadowAttenuationInput, light: AttenuationLight): Uint8Array {
  switch (light.branch) {
    case "sun-direction": return attenuateSunDirection(input, light.direction);
    case "point-falloff": return attenuatePointFalloff(input, light.position, light.radius);
    case "spot-cone": return attenuateSpotCone(input, light.position, light.radius, light.cone, light.spotDirection);
  }
}

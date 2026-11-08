import type { AssetPackage } from "../package/readAssetPackage";
import type { NativeFootstepDefinition } from "../../audio/nativeFootstepPreview";

export type NativeWalkSource = "footstep-pair" | "profile-alias";

export interface NativeLocomotionClips {
  readonly walkClip: string | null;
  readonly runClip: string;
  readonly walkSource: NativeWalkSource | null;
  readonly reason: string | null;
}

export function resolveNativeLocomotionClips(asset: AssetPackage, configuredRun: string,
  definitions: readonly NativeFootstepDefinition[], profileWalkAliasClip?: string): NativeLocomotionClips {
  const gaitRowsForThisAsset = definitions.filter(row => row.asset === asset);
  const walks = gaitRowsForThisAsset.filter(row => row.gait === "walk"), runs = gaitRowsForThisAsset.filter(row => row.gait === "run");
  const bundleHasNoGaitRowForThisAsset = gaitRowsForThisAsset.length === 0;
  if (bundleHasNoGaitRowForThisAsset && profileWalkAliasClip) {
    return { walkClip: profileWalkAliasClip, runClip: configuredRun, walkSource: "profile-alias", reason: null };
  }
  if (walks.length !== 1 || runs.length !== 1) {
    return { walkClip: null, runClip: configuredRun, walkSource: null, reason: "Walking needs one verified walk/run pair for this character." };
  }
  if (runs[0]!.clip !== configuredRun) {
    return { walkClip: null, runClip: configuredRun, walkSource: null, reason: "The saved run clip differs from the staged gait pair; its selection is preserved." };
  }
  return { walkClip: walks[0]!.clip, runClip: configuredRun, walkSource: "footstep-pair", reason: null };
}

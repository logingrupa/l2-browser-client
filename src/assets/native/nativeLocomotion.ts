import type { AssetPackage } from "../package/readAssetPackage";
import type { NativeFootstepDefinition } from "../../audio/nativeFootstepPreview";

/** The verified system bundle selects exact gait clips. Do not infer a weapon
 * family from names or replace an author's different run selection. */
export function resolveNativeLocomotionClips(asset: AssetPackage, configuredRun: string,
  definitions: readonly NativeFootstepDefinition[]) {
  const selected = definitions.filter(row => row.asset === asset);
  const walks = selected.filter(row => row.gait === "walk"), runs = selected.filter(row => row.gait === "run");
  if (walks.length !== 1 || runs.length !== 1) {
    return { walkClip: null, runClip: configuredRun, reason: "Walking needs one verified walk/run pair for this character." };
  }
  if (runs[0]!.clip !== configuredRun) {
    return { walkClip: null, runClip: configuredRun, reason: "The saved run clip differs from the staged gait pair; its selection is preserved." };
  }
  return { walkClip: walks[0]!.clip, runClip: configuredRun, reason: null };
}

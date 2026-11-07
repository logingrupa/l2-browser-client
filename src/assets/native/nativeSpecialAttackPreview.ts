import type { AssetPackage } from "../package/readAssetPackage";
import type { NativeActionCueCoverage } from "../../audio/nativeActionCuePreview";

/** Exact source-animation preview, independent of equipped family/skill policy.
 * Both 47/30 clips and their four direct cues are verified in
 * native-human-skill-audio-20261107/attack-source/DIRECT_SPECIAL_CUES.json.
 * Cue coverage is admitted only after the coordinator checks source, model,
 * event tuples, provenance and original WAV bytes. */
export function resolveNativeSpecialAttackPreview(asset: AssetPackage, coverage: readonly NativeActionCueCoverage[]) {
  const ids: Readonly<Record<string, { object: string; clip: string }>> = {
    "interlude:assembly:MFighter-native-body-face0-hair0": { object: "Fighter.MFighter_m001_u", clip: "SpAtk01_1HS_MFighter" },
    "interlude:assembly:FFighter-native-body-face0-hair0": { object: "Fighter.FFighter_m001_u", clip: "SpAtk01_1HS_FFighter" },
  };
  const source = ids[asset.manifest?.id];
  if (!source || asset.manifest.source.edition !== "interlude" || asset.manifest.source.object !== source.object ||
    asset.manifest.source.sha256 !== "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c") {
    return { clip: null, reason: "No verified special-attack preview for this character." };
  }
  const selected = coverage.filter(row => row.assetId === asset.manifest.id && row.clip === source.clip);
  if (selected.length !== 1 || selected[0]!.admitted !== 4) {
    return { clip: null, reason: "The original special-attack animation and four direct sound cues are not ready." };
  }
  return { clip: source.clip, reason: null };
}

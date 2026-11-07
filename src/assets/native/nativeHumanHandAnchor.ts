import type { AssetPackage } from "../package/readAssetPackage";

export interface NativeHumanHandAnchorSelection {
  binding: { id: "right-hand"; sourceObject: string; boneName: "Weapon_R_Bone" } | null;
  reason: string | null;
  sourceClass: string | null;
  modelSha256: string | null;
}

// Actor RightHandBone declarations and exact converted rig joins are retained in
// native-power-strike-effect-preview-20261107/ATTACHMENT_FINDINGS.json. Selecting
// the upper base rig is presentation policy, not native AttachToBone composition.
const FIGHTER_PACKAGE = "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c";
const RIGS = [
  { name: "MFighter", modelSha256: "448dd406d001a45057f41a564f022ef1068623921605b1206bd5483e630704ce" },
  { name: "FFighter", modelSha256: "dd197ccf29e0d47645c3a81814ce0a675d223595d7481de9e04ee4dff04e2b2c" },
] as const;

/** Only qualify the two checked assemblies. A changed/new conversion needs its
 * own source join; do not guess a hand from a scene-global name or a joint index. */
export function resolveNativeHumanHandAnchor(asset: AssetPackage): NativeHumanHandAnchorSelection {
  const { manifest } = asset;
  const rig = RIGS.find(row => manifest?.id === `interlude:assembly:${row.name}-native-body-face0-hair0`);
  const sourceObject = rig ? `Fighter.${rig.name}_m001_u` : null;
  const model = manifest?.files?.filter(file => file.path === manifest.model?.file);
  if (!rig || manifest.kind !== "model" || manifest.source.edition !== "interlude" ||
    manifest.source.sha256 !== FIGHTER_PACKAGE || manifest.source.object !== sourceObject ||
    !Array.isArray(manifest.source.assembly) || manifest.source.assembly.filter(value => value === sourceObject).length !== 1 ||
    model?.length !== 1 || model[0]!.sha256 !== rig.modelSha256) {
    return { binding: null, reason: "This model has no qualified human right-hand rig binding.", sourceClass: null, modelSha256: null };
  }
  return { binding: { id: "right-hand", sourceObject: sourceObject!, boneName: "Weapon_R_Bone" }, reason: null,
    sourceClass: `LineageWarrior.${rig.name}`, modelSha256: rig.modelSha256 };
}

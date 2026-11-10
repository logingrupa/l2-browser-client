import type { AssetPackage } from "../package/readAssetPackage";
import type { NativePlayerProfile } from "./loadNativePlayerProfiles";
import { readRetainedGlbBoneIdentity } from "./nativeGlbBoneIdentity";

export interface NativeHandAnchorSelection<BoneName extends string = string> {
  binding: { id: "right-hand"; sourceObject: string; boneName: BoneName } | null;
  reason: string | null;
  sourceClass: string | null;
  modelSha256: string | null;
}

export type NativeHumanHandAnchorSelection = NativeHandAnchorSelection<"Weapon_R_Bone">;

const reviewedFighterPackageSha256 = "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c";
const reviewedRigRightHandBone = "Weapon_R_Bone";
const reviewedHumanFighterRigs = [
  { name: "MFighter", sourceClass: "LineageWarrior.MFighter", modelSha256: "448dd406d001a45057f41a564f022ef1068623921605b1206bd5483e630704ce",
    evidenceFile: "native-power-strike-effect-preview-20261107/ATTACHMENT_FINDINGS.json" },
  { name: "FFighter", sourceClass: "LineageWarrior.FFighter", modelSha256: "dd197ccf29e0d47645c3a81814ce0a675d223595d7481de9e04ee4dff04e2b2c",
    evidenceFile: "native-power-strike-effect-preview-20261107/ATTACHMENT_FINDINGS.json" },
] as const;
const unqualifiedHumanRigReason = "This model has no qualified human right-hand rig binding.";
const classTemplateMappingUndecodedReason = "class-template-mapping-undecoded";
const rightHandBoneUnresolvedReason = "actor-default-unresolved:RightHandBone";

function rightHandSelection<BoneName extends string>(sourceObject: string, boneName: BoneName, sourceClass: string,
  modelSha256: string): NativeHandAnchorSelection<BoneName> {
  return { binding: { id: "right-hand", sourceObject, boneName }, reason: null, sourceClass, modelSha256 };
}

function unresolvedHandSelection(reason: string): NativeHandAnchorSelection<never> {
  return { binding: null, reason, sourceClass: null, modelSha256: null };
}

function singleModelFileSha256(asset: AssetPackage): string | null {
  const modelFiles = asset.manifest?.files?.filter(file => file.path === asset.manifest.model?.file);
  return modelFiles?.length === 1 ? modelFiles[0]!.sha256 : null;
}

export function resolveNativeHumanHandAnchor(asset: AssetPackage): NativeHumanHandAnchorSelection {
  const manifest = asset.manifest;
  const rig = reviewedHumanFighterRigs.find(row => manifest?.id === `interlude:assembly:${row.name}-native-body-face0-hair0`);
  if (!rig) return unresolvedHandSelection(unqualifiedHumanRigReason);
  const sourceObject = `Fighter.${rig.name}_m001_u`;
  if (manifest.kind !== "model" || manifest.source.edition !== "interlude" || manifest.source.sha256 !== reviewedFighterPackageSha256 ||
    manifest.source.object !== sourceObject || !Array.isArray(manifest.source.assembly) ||
    manifest.source.assembly.filter(value => value === sourceObject).length !== 1 || singleModelFileSha256(asset) !== rig.modelSha256) {
    return unresolvedHandSelection(unqualifiedHumanRigReason);
  }
  return rightHandSelection(sourceObject, reviewedRigRightHandBone, rig.sourceClass, rig.modelSha256);
}

function sourceSkinHasJoint(asset: AssetPackage, sourceObject: string, boneName: string): boolean {
  try {
    readRetainedGlbBoneIdentity(asset, sourceObject, boneName);
    return true;
  } catch {
    return false;
  }
}

export function resolveNativeCharacterHandAnchor(profile: Pick<NativePlayerProfile, "sourceObject" | "sourceEvidence">,
  asset: AssetPackage): NativeHandAnchorSelection {
  const classDefaults = profile.sourceEvidence.actorClassDefaults;
  if (typeof classDefaults !== "object" || classDefaults === null || Array.isArray(classDefaults)) {
    return unresolvedHandSelection(classTemplateMappingUndecodedReason);
  }
  const { class: sourceClass, RightHandBone: rightHandBone } = classDefaults as Record<string, unknown>;
  if (typeof sourceClass !== "string" || !sourceClass) return unresolvedHandSelection(classTemplateMappingUndecodedReason);
  if (typeof rightHandBone !== "string" || !rightHandBone) return unresolvedHandSelection(rightHandBoneUnresolvedReason);
  const modelSha256 = singleModelFileSha256(asset);
  if (modelSha256 === null || !sourceSkinHasJoint(asset, profile.sourceObject, rightHandBone)) return unresolvedHandSelection(rightHandBoneUnresolvedReason);
  return rightHandSelection(profile.sourceObject, rightHandBone, sourceClass, modelSha256);
}

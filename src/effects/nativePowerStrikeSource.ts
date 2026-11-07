import { validatePackageModel, type AssetPackage } from "../assets/package/readAssetPackage";
import type { NativeNpcProfile } from "../assets/native/loadNativeNpcProfiles";

export interface NativePowerStrikeShotSource {
  readonly clip: string;
  readonly durationSeconds: number;
  readonly eventSeconds: number;
  readonly normalizedTime: number;
  readonly eventIndex: number;
  readonly eventObject: string;
  readonly eventPointer: string;
  readonly animationSet: string;
  readonly assetId: string;
  readonly sourceObject: string;
  readonly sourceSha256: string;
  readonly modelSha256: string;
  readonly animationSourceSha256: string;
  readonly sourceFrames: 47;
  readonly sourceRate: 30;
  readonly policy: "retained-source-attack-shot-event";
  readonly hasDirectSound: false;
  readonly nativeDispatchVerified: false;
}
export interface NativePowerStrikeShotTarget {
  readonly npcId: 21622;
  readonly profileId: "npc:21622";
  /** Metres, from the source radius alone; never multiplied by DrawScale. */
  readonly collisionRadius: number;
  readonly sourceCollisionRadius: 18;
  readonly sourceUnitsPerMetre: 100;
  readonly sourceClass: "LineageMonster.field_stalker_20_bi";
  readonly sourceMesh: "LineageMonsters.field_stalker_m00";
  readonly drawScaleIndependent: true;
  readonly prePivotUnresolved: true;
  readonly nativeRuntimeRadiusVerified: false;
}
export type NativePowerStrikeShotSourceResult =
  { source: NativePowerStrikeShotSource; reason: null } | { source: null; reason: string };
export type NativePowerStrikeShotTargetResult =
  { target: NativePowerStrikeShotTarget; reason: null } | { target: null; reason: string };

const PACKAGE_HASH = "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c";
const DURATION = 47 / 30;
const TIMING_BASIS = "source normalized notification time * (NumFrames / Rate)";
const SOURCE_TO_GLTF = [.01, 0, 0, 0, 0, 0, .01, 0, 0, .01, 0, 0, 0, 0, 0, 1];
// Retained package/event joins in native-power-strike-shot-20261107/{source,
// target}. These are two independent source times, not a shared cast policy.
const SOURCES = {
  "interlude:assembly:MFighter-native-body-face0-hair0": {
    actor: "MFighter", clip: "SpAtk01_1HS_MFighter", eventIndex: 90, eventObject: "Fighter.AnimNotify_AttackShot167",
    normalizedTime: 0.5893617272377014, eventSeconds: 0.9233333726723989,
    modelSha256: "448dd406d001a45057f41a564f022ef1068623921605b1206bd5483e630704ce", modelBytes: 44321256,
    animationSourceSha256: "67213724612eb112ff3604d85a2053ff49fa7f8a6cd51308f2ebfa746c0b35f8", animationSourceBytes: 462991,
    motionSha256: "b42ef084bb04d5a925876db1ad2c1eaa58a3f5f1dec734d288b76ccc40426518",
  },
  "interlude:assembly:FFighter-native-body-face0-hair0": {
    actor: "FFighter", clip: "SpAtk01_1HS_FFighter", eventIndex: 40, eventObject: "Fighter.AnimNotify_AttackShot69",
    normalizedTime: 0.5808510184288025, eventSeconds: 0.9099999288717906,
    modelSha256: "dd197ccf29e0d47645c3a81814ce0a675d223595d7481de9e04ee4dff04e2b2c", modelBytes: 46983116,
    animationSourceSha256: "3ca578f9c7dbdb6c7c2e537678498ce58d46aa2a4113a6f022252318609efae7", animationSourceBytes: 474170,
    motionSha256: "5911eca74840fbf9d953e59401da5f0fd53637288404f4657f7c92dad4e8697a",
  },
} as const;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function ordered(a: unknown, b: readonly unknown[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}
const unavailable = (reason: string): NativePowerStrikeShotSourceResult => ({ source: null, reason });

/** Qualify already-loaded, byte-authenticated package metadata. readAssetPackage
 * owns archive/member hashes; this resolver does not refetch/reopen assets or
 * authenticate arbitrary in-memory bytes. It defensively rechecks the exact
 * supported identities/event and the in-memory clip metadata before admission.
 * No sound/function/property is promoted into a runtime skill policy. */
export function resolveNativePowerStrikeShotSource(asset: AssetPackage, specialClip: string | null): NativePowerStrikeShotSourceResult {
  const manifest = asset?.manifest;
  if (!manifest || !Object.hasOwn(SOURCES, manifest.id)) return unavailable("No retained Power Strike shot event for this character.");
  const expected = SOURCES[manifest.id as keyof typeof SOURCES], source = manifest.source;
  const sourceObject = `Fighter.${expected.actor}_m001_u`, animationSet = `Fighter.${expected.actor}_anim`;
  const assembly = ["m001_u", "m001_l", "m001_g", "m001_b", "m000_f", "m000_m00_ah", "m000_m00_bh"].map(part => `Fighter.${expected.actor}_${part}`);
  if (manifest.schemaVersion !== 1 || manifest.kind !== "model" || !object(source) || source.edition !== "interlude" ||
    source.package !== "Fighter" || source.object !== sourceObject || source.sha256 !== PACKAGE_HASH ||
    source.packageVersion !== 123 || source.licenseeVersion !== 30 || !ordered(source.assembly, assembly)) {
    return unavailable("The fighter package/source assembly differs from the retained shot event.");
  }
  if (specialClip !== expected.clip) return unavailable("The qualified original special-attack clip is unavailable or differs.");
  const model = manifest.model;
  if (!model || model.file !== "model.glb" || model.unit !== "metre" || model.sourceUnitsPerMetre !== 100 ||
    !ordered(model.sourceToGltf, SOURCE_TO_GLTF) || !Array.isArray(manifest.files)) {
    return unavailable("The source model coordinate contract differs.");
  }
  const modelFiles = manifest.files.filter(file => file.path === model.file), animationFiles = manifest.files.filter(file => file.path === "animation-source.json");
  if (modelFiles.length !== 1 || animationFiles.length !== 1 || modelFiles[0]!.sha256 !== expected.modelSha256 ||
    modelFiles[0]!.bytes !== expected.modelBytes || modelFiles[0]!.mime !== "model/gltf-binary" ||
    animationFiles[0]!.sha256 !== expected.animationSourceSha256 || animationFiles[0]!.bytes !== expected.animationSourceBytes ||
    animationFiles[0]!.mime !== "application/json") return unavailable("The qualified model or animation-source inventory is missing, changed or ambiguous.");
  const events = manifest.animationEvents;
  if (!Array.isArray(events) || !events.every(object)) return unavailable("The original animation-event table is unavailable or malformed.");
  const candidates = events.map((event, index) => ({ event, index })).filter(({ event }) =>
    event.object === expected.eventObject || event.clip === expected.clip && event.type === "AnimNotify_AttackShot");
  if (candidates.length !== 1) return unavailable("The selected source AttackShot event is missing or ambiguous.");
  const { event, index } = candidates[0]!;
  if (index !== expected.eventIndex || event.clip !== expected.clip || event.animationSet !== animationSet ||
    event.object !== expected.eventObject || event.type !== "AnimNotify_AttackShot" || event.function !== "None" || event.sound !== null ||
    !object(event.properties) || Object.keys(event.properties).length !== 0 || event.sourceFrames !== 47 || event.sourceRate !== 30 ||
    event.normalizedTime !== expected.normalizedTime || event.timeSeconds !== expected.eventSeconds ||
    event.timeSeconds !== expected.normalizedTime * DURATION || event.timingBasis !== TIMING_BASIS) {
    return unavailable("The retained AttackShot tuple, source time or empty sound/function/property boundary differs.");
  }
  try {
    const modelBytes = asset.files.get(model.file), animationBytes = asset.files.get("animation-source.json");
    if (modelBytes?.byteLength !== expected.modelBytes || animationBytes?.byteLength !== expected.animationSourceBytes) {
      return unavailable("The already-loaded model or animation-source payload is unavailable.");
    }
    const clips = validatePackageModel(modelBytes).animations.filter(clip => clip.name === expected.clip);
    if (clips.length !== 1 || clips[0]!.nativeDurationSeconds !== DURATION) return unavailable("The loaded special clip is missing, duplicated or has a different source duration.");
    const sidecar: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(animationBytes));
    if (!object(sidecar) || !Array.isArray(sidecar.parts) || sidecar.parts.length !== assembly.length ||
      !sidecar.parts.every(part => {
        if (!object(part) || part.animationSet !== animationSet || !Array.isArray(part.clips) || !part.clips.every(object)) return false;
        const selected = part.clips.filter(clip => clip.name === expected.clip);
        return selected.length === 1 && selected[0]!.frames === 47 && selected[0]!.rate === 30 &&
          selected[0]!.sourceDurationSeconds === DURATION && selected[0]!.sourceMotionSha256 === expected.motionSha256;
      })) return unavailable("The retained per-part source clip/duration/motion join differs.");
  } catch { return unavailable("The already-loaded source clip metadata cannot be qualified."); }
  return { source: Object.freeze({ clip: expected.clip, durationSeconds: DURATION, eventSeconds: expected.eventSeconds,
    normalizedTime: expected.normalizedTime, eventIndex: index, eventObject: expected.eventObject, eventPointer: `/animationEvents/${index}`,
    animationSet, assetId: manifest.id, sourceObject, sourceSha256: PACKAGE_HASH, modelSha256: expected.modelSha256,
    animationSourceSha256: expected.animationSourceSha256, sourceFrames: 47 as const, sourceRate: 30 as const,
    policy: "retained-source-attack-shot-event" as const, hasDirectSound: false as const, nativeDispatchVerified: false as const }), reason: null };
}

/** Accept the exact retained NPC profile after loadNativeNpcProfiles verified
 * its catalog-selected bytes. That loader's authentication boundary is reused;
 * this type carries no original manifest hash and does not attest current native
 * radius overrides. Browser actor-root/target lifetime selection is the caller's. */
export function resolveNativePowerStrikeShotTarget(profile: NativeNpcProfile | null | undefined): NativePowerStrikeShotTargetResult {
  if (!profile || profile.id !== "npc:21622" || profile.npcId !== 21622 || profile.name !== "Greater Musveren" ||
    profile.actorClass !== "LineageMonster.field_stalker_20_bi" || profile.mesh !== "LineageMonsters.field_stalker_m00" ||
    profile.sourceUnitsPerMetre !== 100 || profile.collisionRadius !== 18 || profile.collisionHeight !== 36 ||
    profile.drawScale !== 1.2 || !ordered(profile.drawScale3D, [1, 1, 1]) || profile.prePivot !== undefined ||
    !Array.isArray(profile.unsupportedFields) || profile.unsupportedFields.length !== 1 ||
    profile.unsupportedFields[0]?.field !== "prePivot" || typeof profile.unsupportedFields[0]?.reason !== "string" || !profile.unsupportedFields[0].reason.trim()) {
    return { target: null, reason: "The exact retained Greater Musveren source profile is unavailable or differs." };
  }
  return { target: Object.freeze({ npcId: 21622 as const, profileId: "npc:21622" as const,
    collisionRadius: profile.collisionRadius / profile.sourceUnitsPerMetre, sourceCollisionRadius: 18 as const, sourceUnitsPerMetre: 100 as const,
    sourceClass: "LineageMonster.field_stalker_20_bi" as const, sourceMesh: "LineageMonsters.field_stalker_m00" as const,
    drawScaleIndependent: true as const, prePivotUnresolved: true as const, nativeRuntimeRadiusVerified: false as const }), reason: null };
}

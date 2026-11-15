import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readAssetPackage, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import { copyAssetPackage } from "./support/copyAssetPackage";
import { loadNativeNpcProfiles, type NativeNpcProfile } from "../../src/assets/native/loadNativeNpcProfiles";
import { resolveNativePowerStrikeShotSource, resolveNativePowerStrikeShotTarget } from "../../src/effects/nativePowerStrikeSource";

const variants = [
  { sex: "male", archive: "678067311414990c82307a045f01b3da0cb083d2075ed927c83372ca647bd2d5", clip: "SpAtk01_1HS_MFighter",
    index: 90, normalized: 0.5893617272377014, seconds: 0.9233333726723989, event: "Fighter.AnimNotify_AttackShot167" },
  { sex: "female", archive: "ce3984dded01419ce9fc1ec1644ffe06346803f889d5925684d583a154015990", clip: "SpAtk01_1HS_FFighter",
    index: 40, normalized: 0.5808510184288025, seconds: 0.9099999288717906, event: "Fighter.AnimNotify_AttackShot69" },
] as const;
const npcProfileManifestSha256 = "5bb30f9f869b39e0421de07939798bebec094758228db9784ab2c18da3b4096f";
const npcProfileManifestPath = `public/l2/npc-profiles/${npcProfileManifestSha256}/manifest.json`;
const stagedInputPaths = [...variants.map(row => `public/l2/${row.archive}/asset.l2asset`), npcProfileManifestPath];
const missingStagedInputPaths = stagedInputPaths.filter(path => !existsSync(path));
const stagedStoreAbsentReason = `needs the gitignored staged native store; missing ${missingStagedInputPaths.join(", ")}`;
const packages: AssetPackage[] = [];
let profile: NativeNpcProfile;
beforeAll(async () => {
  if (missingStagedInputPaths.length > 0) return;
  for (const row of variants) packages.push(await readAssetPackage(new Uint8Array(await readFile(`public/l2/${row.archive}/asset.l2asset`))));
  const bytes = new Uint8Array(await readFile(npcProfileManifestPath));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes.slice())));
  try {
    const profiles = await loadNativeNpcProfiles([{ id: "native-npc-profiles", manifest: `/l2/npc-profiles/${npcProfileManifestSha256}/manifest.json`,
      manifestBytes: bytes.length, manifestSha256: npcProfileManifestSha256 }], new AbortController().signal);
    profile = profiles.get("npc:21622")!;
  } finally { vi.unstubAllGlobals(); }
}, 60_000);
beforeEach(context => { context.skip(missingStagedInputPaths.length > 0, stagedStoreAbsentReason); });
afterEach(() => vi.unstubAllGlobals());
function fixture(index = 0): AssetPackage {
  return copyAssetPackage(packages[index]!);
}
function event(asset: AssetPackage, index = variants[0].index): Record<string, unknown> {
  return asset.manifest.animationEvents![index] as Record<string, unknown>;
}
interface AnimationSourceClip { name: string; sourceDurationSeconds: number; sourceMotionSha256: string }
interface AnimationSourceSidecar { parts: { animationSet: string; clips: AnimationSourceClip[] }[] }
function alterSidecar(asset: AssetPackage, edit: (sidecar: AnimationSourceSidecar) => void) {
  const source = asset.files.get("animation-source.json")!, sidecar = JSON.parse(new TextDecoder().decode(source)) as AnimationSourceSidecar; edit(sidecar);
  const encoded = new TextEncoder().encode(JSON.stringify(sidecar));
  expect(encoded.length).toBeLessThanOrEqual(source.length);
  const bytes = new Uint8Array(source.length).fill(32); bytes.set(encoded);
  (asset.files as Map<string, Uint8Array>).set("animation-source.json", bytes);
}
function maleSpecialAttackClip(sidecar: AnimationSourceSidecar): AnimationSourceClip {
  return sidecar.parts[6]!.clips.find(clip => clip.name === variants[0].clip)!;
}
function alterClipList(asset: AssetPackage, animations: unknown[]) {
  const original = asset.files.get("model.glb")!, bytes = original.slice(), view = new DataView(bytes.buffer);
  const length = view.getUint32(12, true), json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, animations, meshes: [] }));
  expect(json.length).toBeLessThan(length); bytes.fill(32, 20, 20 + length); bytes.set(json, 20);
  (asset.files as Map<string, Uint8Array>).set("model.glb", bytes);
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
}

describe("retained Power Strike source-event qualification", () => {
  it.each(variants.map((row, index) => ({ ...row, indexInFixture: index })))("qualifies exact $sex source time without selecting audio", row => {
    const asset = fixture(row.indexInFixture), before = JSON.stringify(asset.manifest); freeze(asset.manifest);
    const fetch = vi.fn(() => { throw new Error("Resolver must not fetch."); }); vi.stubGlobal("fetch", fetch);
    const result = resolveNativePowerStrikeShotSource(asset, row.clip);
    expect(result.reason).toBeNull(); expect(result.source).toMatchObject({ clip: row.clip, durationSeconds: 47 / 30,
      eventSeconds: row.seconds, normalizedTime: row.normalized, eventIndex: row.index, eventObject: row.event,
      eventPointer: `/animationEvents/${row.index}`, sourceFrames: 47, sourceRate: 30, hasDirectSound: false, nativeDispatchVerified: false });
    expect(result.source!.eventSeconds).toBe(row.normalized * (47 / 30)); expect(Object.isFrozen(result.source)).toBe(true);
    expect(JSON.stringify(asset.manifest)).toBe(before); expect(fetch).not.toHaveBeenCalled();
    for (const [name, bytes] of asset.files) expect(bytes).toBe(packages[row.indexInFixture]!.files.get(name));
  });

  it.each([
    ["asset identity", (asset: AssetPackage) => { asset.manifest.id = "interlude:assembly:Other"; }],
    ["source package", (asset: AssetPackage) => { asset.manifest.source.package = "Other"; }],
    ["source object", (asset: AssetPackage) => { asset.manifest.source.object = "Fighter.FFighter_m001_u"; }],
    ["source hash", (asset: AssetPackage) => { asset.manifest.source.sha256 = "0".repeat(64); }],
    ["source edition", (asset: AssetPackage) => { Object.assign(asset.manifest.source, { edition: "high-five" }); }],
    ["source version", (asset: AssetPackage) => { asset.manifest.source.packageVersion = 122; }],
    ["assembly missing", (asset: AssetPackage) => { asset.manifest.source.assembly = []; }],
    ["assembly duplicate", (asset: AssetPackage) => { const rows = asset.manifest.source.assembly as string[]; rows[1] = rows[0]!; }],
    ["model pin", (asset: AssetPackage) => { asset.manifest.files.find(file => file.path === "model.glb")!.sha256 = "0".repeat(64); }],
    ["animation-source pin", (asset: AssetPackage) => { asset.manifest.files.find(file => file.path === "animation-source.json")!.sha256 = "0".repeat(64); }],
    ["duplicate model inventory", (asset: AssetPackage) => { asset.manifest.files.push({ ...asset.manifest.files.find(file => file.path === "model.glb")! }); }],
    ["source unit", (asset: AssetPackage) => { asset.manifest.coordinates!.sourceUnitsPerMetre = 1; }],
    ["coordinate basis", (asset: AssetPackage) => { asset.manifest.coordinates!.sourceToGltf[0] = 1; }],
    ["missing coordinates", (asset: AssetPackage) => { delete asset.manifest.coordinates; }],
    ["schemaVersion 3", (asset: AssetPackage) => { Object.assign(asset.manifest, { schemaVersion: 3 }); }],
  ] as const)("rejects changed %s", (_label, mutate) => {
    const asset = fixture(); mutate(asset); const result = resolveNativePowerStrikeShotSource(asset, variants[0].clip);
    expect(result.source).toBeNull(); expect(result.reason).toEqual(expect.any(String));
  });

  it.each([
    ["wrong clip", { clip: "Atk01_Hand_MFighter" }], ["wrong animation set", { animationSet: "Fighter.FFighter_anim" }],
    ["wrong object", { object: "Fighter.AnimNotify_AttackShot69" }], ["wrong event type", { type: "AnimNotify_Sound" }],
    ["direct sound", { sound: "SkillSound.power_strike" }], ["function", { function: "Trigger" }],
    ["authored property", { properties: { Sound: "SkillSound.power_strike" } }], ["array properties", { properties: [] }],
    ["missing properties", { properties: undefined }], ["wrong frames", { sourceFrames: 46 }], ["wrong rate", { sourceRate: 60 }],
    ["nonfinite normalized time", { normalizedTime: Number.NaN }], ["female normalized time", { normalizedTime: variants[1].normalized }],
    ["rounded event time", { timeSeconds: .9233333333333333 }], ["infinite event time", { timeSeconds: Infinity }],
    ["wrong timing basis", { timingBasis: "frame counter" }],
  ] as const)("rejects %s instead of inventing a dispatch", (_label, changes) => {
    const asset = fixture(); Object.assign(event(asset), changes);
    expect(resolveNativePowerStrikeShotSource(asset, variants[0].clip).source).toBeNull();
  });

  it("rejects missing, duplicated, aliased and relocated events", () => {
    for (const modify of [
      (asset: AssetPackage) => { asset.manifest.animationEvents = []; },
      (asset: AssetPackage) => { asset.manifest.animationEvents!.push(structuredClone(event(asset))); },
      (asset: AssetPackage) => { asset.manifest.animationEvents!.push({ ...event(asset), object: "Fighter.OtherShot" }); },
      (asset: AssetPackage) => { asset.manifest.animationEvents!.push({ ...event(asset), clip: "other" }); },
      (asset: AssetPackage) => { const rows = asset.manifest.animationEvents!; [rows[89], rows[90]] = [rows[90], rows[89]]; },
      (asset: AssetPackage) => { asset.manifest.animationEvents![0] = null; },
    ]) { const asset = fixture(); modify(asset); expect(resolveNativePowerStrikeShotSource(asset, variants[0].clip).source).toBeNull(); }
  });

  it("requires the already-qualified selected clip and handles unavailable packages", () => {
    for (const clip of [null, "Atk01_Hand_MFighter", variants[1].clip]) expect(resolveNativePowerStrikeShotSource(fixture(), clip).source).toBeNull();
    expect(resolveNativePowerStrikeShotSource({} as AssetPackage, variants[0].clip).source).toBeNull();
  });

  it("rejects missing payloads and mismatched or duplicate loaded GLB durations", () => {
    for (const animations of [[], [{ name: variants[0].clip, extras: { nativeDurationSeconds: 1.5 } }],
      [0, 1].map(() => ({ name: variants[0].clip, extras: { nativeDurationSeconds: 47 / 30 } }))]) {
      const asset = fixture(); alterClipList(asset, animations);
      expect(resolveNativePowerStrikeShotSource(asset, variants[0].clip).source).toBeNull();
    }
    for (const name of ["model.glb", "animation-source.json"]) {
      const asset = fixture(); (asset.files as Map<string, Uint8Array>).delete(name);
      expect(resolveNativePowerStrikeShotSource(asset, variants[0].clip).source).toBeNull();
    }
  });

  it("requires all seven matching source part clips and never repairs sidecars", () => {
    const qualifiedClipOnlyModelPackage = fixture();
    alterClipList(qualifiedClipOnlyModelPackage, [{ name: variants[0].clip, extras: { nativeDurationSeconds: 47 / 30 } }]);
    expect(resolveNativePowerStrikeShotSource(qualifiedClipOnlyModelPackage, variants[0].clip).reason).toBeNull();
    for (const modify of [
      (sidecar: AnimationSourceSidecar) => { sidecar.parts.pop(); },
      (sidecar: AnimationSourceSidecar) => { sidecar.parts[6]!.animationSet = "Fighter.Other_anim"; },
      (sidecar: AnimationSourceSidecar) => { maleSpecialAttackClip(sidecar).sourceDurationSeconds = 1.5; },
      (sidecar: AnimationSourceSidecar) => { maleSpecialAttackClip(sidecar).sourceMotionSha256 = "0".repeat(64); },
      (sidecar: AnimationSourceSidecar) => { sidecar.parts[6]!.clips = sidecar.parts[6]!.clips.filter(clip => clip.name !== variants[0].clip); },
      (sidecar: AnimationSourceSidecar) => { const clip = maleSpecialAttackClip(sidecar); sidecar.parts[6]!.clips = [clip, clip]; },
    ]) {
      const asset = copyAssetPackage(qualifiedClipOnlyModelPackage); alterSidecar(asset, modify); const before = asset.files.get("animation-source.json")!.slice();
      expect(resolveNativePowerStrikeShotSource(asset, variants[0].clip)).toEqual({ source: null, reason: "The retained per-part source clip/duration/motion join differs." });
      expect(asset.files.get("animation-source.json")).toEqual(before);
    }
  });

  it("accepts the same coordinate basis from an asset.json v2 manifest", () => {
    const asset = fixture(), versionOne = asset.manifest;
    asset.manifest = { ...versionOne, schemaVersion: 2, source: { ...versionOne.source, path: { host: "SYNTHETIC-HOST", absolutePath: "C:/SyntheticClient/Fighter.ukx" } },
      clientBuild: { referenceTreeLockSha256: "a".repeat(64), engineDllSha256: "b".repeat(64) }, converterVersion: "c".repeat(64),
      coordinates: { ...versionOne.coordinates!, handedness: "right", upAxis: "Y" } };
    expect(resolveNativePowerStrikeShotSource(asset, variants[0].clip).reason).toBeNull();
  });

  it("returns detached immutable event values without changing the loaded package", () => {
    const asset = fixture(), result = resolveNativePowerStrikeShotSource(asset, variants[0].clip);
    event(asset).timeSeconds = 0; asset.manifest.source.sha256 = "0".repeat(64);
    expect(result.source!.eventSeconds).toBe(variants[0].seconds);
    expect(result.source!.sourceSha256).toBe(packages[0]!.manifest.source.sha256);
  });
});

describe("retained NPC shot-target profile", () => {
  it("reuses the verified loader result and keeps source radius independent of DrawScale", () => {
    const before = JSON.stringify(profile); freeze(profile); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = resolveNativePowerStrikeShotTarget(profile);
    expect(result).toMatchObject({ reason: null, target: { profileId: "npc:21622", npcId: 21622, collisionRadius: .18,
      sourceCollisionRadius: 18, sourceUnitsPerMetre: 100, drawScaleIndependent: true, prePivotUnresolved: true, nativeRuntimeRadiusVerified: false } });
    expect(result.target!.collisionRadius).not.toBe(18 * 1.2 / 100);
    expect(JSON.stringify(profile)).toBe(before); expect(Object.isFrozen(result.target)).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { id: "npc:1" }, { npcId: 1 }, { name: "Other Musveren" }, { actorClass: "LineageMonster.field_stalker" },
    { mesh: "LineageMonsters.field_stalker_m01" }, { collisionRadius: 21.6 }, { collisionRadius: NaN },
    { collisionHeight: 35 }, { sourceUnitsPerMetre: 1 }, { drawScale: 2.4 }, { drawScale3D: [1, 1, 2] },
    { prePivot: [0, 0, 0] }, { unsupportedFields: [] }, { unsupportedFields: [{ field: "prePivot", reason: "" }] },
  ])("rejects unsupported or altered profile %#", changes => {
    const result = resolveNativePowerStrikeShotTarget({ ...profile, ...changes } as NativeNpcProfile);
    expect(result.target).toBeNull(); expect(result.reason).toEqual(expect.any(String));
  });
  it("keeps absent targets unavailable", () => {
    expect(resolveNativePowerStrikeShotTarget(null).target).toBeNull();
    expect(resolveNativePowerStrikeShotTarget(undefined).target).toBeNull();
  });
});

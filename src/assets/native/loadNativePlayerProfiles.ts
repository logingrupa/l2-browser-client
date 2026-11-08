import { sha256, validatePackageModel, type AssetPackage } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
import {
  boundAliasStatuses, isNativeAnimationAlias, requiredNativeAliases, unboundAliasStatuses,
  type NativeAliasEvidence, type NativeAliasEvidenceRow, type NativeAliasStatus, type NativePlayerClips,
} from "./nativeAnimationAliases";

export interface NativePlayerProfile {
  readonly id: string;
  readonly name: string;
  readonly catalogId: string;
  readonly assetId: string;
  readonly sourceObject: string;
  readonly sourceSha256: string;
  readonly clips: NativePlayerClips;
  readonly aliasEvidence?: NativeAliasEvidence;
  readonly forwardAxis: readonly [number, number, number];
  readonly actorScale: readonly [number, number, number];
  readonly collisionRadius: number;
  readonly collisionHeight: number;
  readonly sourceUnitsPerMetre: 100;
  readonly upperItems: readonly { itemId: number; catalogId: string; sourceObject: string; sourceSha256: string }[];
  readonly sourceEvidence: Readonly<Record<string, unknown>>;
  readonly limitations: readonly string[];
  readonly chargrpIndex?: number;
}

export const defaultNativePlayerProfile: NativePlayerProfile = {
  id: "human-male-fighter", name: "Human male fighter", catalogId: "human-male-fighter:0",
  assetId: "interlude:assembly:MFighter-native-body-face0-hair0", sourceObject: "Fighter.MFighter_m001_u",
  sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c",
  clips: { idle: "Wait_Hand_MFighter", run: "Run_Hand_MFighter", attack: "Atk01_Hand_MFighter", death: "Death_MFighter" },
  forwardAxis: [1, 0, 0], actorScale: [1, 1, 1], collisionRadius: 9, collisionHeight: 23, sourceUnitsPerMetre: 100,
  upperItems: [{ itemId: 22, catalogId: "fighter-equipment:0", sourceObject: "Fighter.MFighter_m001_u",
    sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c" }],
  sourceEvidence: { scope: "Existing verified male slice, LineageWarrior.MFighter dimensions and preserved mesh-facing transform" },
  limitations: ["Synthetic movement, navigation and action selection; native gameplay dispatch remains unverified."],
};

const hash = /^[a-f0-9]{64}$/;
const identity = /^[a-z0-9][a-z0-9:-]{0,95}$/;
const qualified = /^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Native player profile object is invalid.");
  return value as Record<string, unknown>;
}
function string(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || !value || value.length > 512 || (pattern && !pattern.test(value))) throw new Error("Native player profile string is invalid.");
  return value;
}
function dimension(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10000) throw new Error("Native player collision dimension is invalid.");
  return value;
}
const profileFields = new Set(["id", "name", "catalogId", "assetId", "sourceObject", "sourceSha256", "clips", "forwardAxis", "actorScale",
  "collisionRadius", "collisionHeight", "sourceUnitsPerMetre", "upperItems", "sourceEvidence", "limitations", "aliasEvidence",
  "chargrpIndex"]);
function optionalChargrpIndex(value: unknown): { readonly chargrpIndex?: number } {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Native player profile chargrpIndex is invalid.");
  return { chargrpIndex: value };
}
function parseClips(value: unknown): NativePlayerClips {
  const raw = object(value), clips: Record<string, string> = {};
  for (const alias of requiredNativeAliases) if (!Object.hasOwn(raw, alias)) throw new Error(`Native player clip alias ${alias} is required.`);
  if (Object.keys(raw).length > 64) throw new Error("Native player clip mapping is invalid.");
  for (const [alias, clip] of Object.entries(raw)) {
    if (!isNativeAnimationAlias(alias)) throw new Error(`Native player clip alias ${alias} is unknown.`);
    clips[alias] = string(clip);
  }
  return clips as NativePlayerClips;
}
const bound: ReadonlySet<string> = new Set(boundAliasStatuses), unbound: ReadonlySet<string> = new Set(unboundAliasStatuses);
const evidenceFields = ["generator", "report", "reportSha256", "family", "familySource", "familySourceSha256", "rows"];
const evidenceRowFields = ["alias", "key", "status", "reference", "line", "selectionPath", "reason"];
function parseAliasEvidence(value: unknown, clips: NativePlayerClips): NativeAliasEvidence {
  const row = object(value);
  if (Object.keys(row).some(key => !evidenceFields.includes(key)) || !Array.isArray(row.rows) || !row.rows.length || row.rows.length > 64) {
    throw new Error("Native player alias evidence is invalid.");
  }
  const seen = new Set<string>();
  const rows = row.rows.map((value: unknown): NativeAliasEvidenceRow => {
    const entry = object(value), alias = string(entry.alias), status = string(entry.status);
    if (!isNativeAnimationAlias(alias) || seen.has(alias) || (!bound.has(status) && !unbound.has(status)) ||
      Object.keys(entry).some(key => !evidenceRowFields.includes(key))) throw new Error("Native player alias evidence row is invalid or duplicated.");
    seen.add(alias);
    const clip = clips[alias];
    if (bound.has(status) ? clip === undefined : clip !== undefined || entry.reason === undefined) {
      throw new Error(`Native player alias ${alias} evidence disagrees with its clip.`);
    }
    if (entry.line !== undefined && (!Number.isSafeInteger(entry.line) || (entry.line as number) <= 0)) throw new Error("Native player alias evidence line is invalid.");
    return { alias, key: string(entry.key), status: status as NativeAliasStatus,
      ...(entry.reference !== undefined ? { reference: string(entry.reference) } : {}),
      ...(entry.line !== undefined ? { line: entry.line as number } : {}),
      ...(entry.selectionPath !== undefined ? { selectionPath: string(entry.selectionPath) } : {}),
      ...(entry.reason !== undefined ? { reason: string(entry.reason) } : {}) };
  });
  for (const alias of Object.keys(clips)) if (!seen.has(alias)) throw new Error(`Native player alias ${alias} has no evidence row.`);
  return { generator: string(row.generator), report: string(row.report), reportSha256: string(row.reportSha256, hash),
    family: string(row.family), familySource: string(row.familySource), familySourceSha256: string(row.familySourceSha256, hash), rows };
}
function parseProfile(value: unknown): NativePlayerProfile {
  const row = object(value);
  if (Object.keys(row).some(key => !profileFields.has(key))) throw new Error("Native player profile has unknown fields.");
  const clips = parseClips(row.clips);
  const axis = row.forwardAxis;
  if (!Array.isArray(axis) || axis.length !== 3 || !axis.every(v => typeof v === "number" && Number.isFinite(v)) ||
    axis[1] !== 0 || Math.abs(Math.hypot(axis[0], axis[2]) - 1) > 1e-6) throw new Error("Native player forward axis must be a horizontal unit vector.");
  const scale = row.actorScale;
  if (!Array.isArray(scale) || scale.length !== 3 || !scale.every(v => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100)) throw new Error("Native player actor scale is invalid.");
  if (row.sourceUnitsPerMetre !== 100 || !Array.isArray(row.upperItems) || row.upperItems.length > 64 ||
    !Array.isArray(row.limitations) || !row.limitations.length || row.limitations.length > 64) throw new Error("Native player profile coverage is invalid.");
  const ids = new Set<number>();
  const upperItems = row.upperItems.map((value: unknown) => {
    const item = object(value);
    if (!Number.isSafeInteger(item.itemId) || (item.itemId as number) <= 0 || ids.has(item.itemId as number)) throw new Error("Native player equipment identity is invalid or duplicated.");
    ids.add(item.itemId as number);
    return { itemId: item.itemId as number, catalogId: string(item.catalogId, identity),
      sourceObject: string(item.sourceObject, qualified), sourceSha256: string(item.sourceSha256, hash) };
  });
  const sourceEvidence = object(row.sourceEvidence);
  if (!Object.keys(sourceEvidence).length) throw new Error("Native player profile source evidence is missing.");
  return { id: string(row.id, identity), name: string(row.name), catalogId: string(row.catalogId, identity),
    assetId: string(row.assetId), sourceObject: string(row.sourceObject, qualified), sourceSha256: string(row.sourceSha256, hash),
    clips, ...(row.aliasEvidence !== undefined ? { aliasEvidence: parseAliasEvidence(row.aliasEvidence, clips) } : {}),
    forwardAxis: [axis[0], axis[1], axis[2]], actorScale: [scale[0], scale[1], scale[2]], collisionRadius: dimension(row.collisionRadius),
    collisionHeight: dimension(row.collisionHeight), sourceUnitsPerMetre: 100, upperItems,
    sourceEvidence, limitations: row.limitations.map((v: unknown) => string(v)), ...optionalChargrpIndex(row.chargrpIndex) };
}

function matchesBuiltInMaleFighterIdentity(profile: NativePlayerProfile): boolean {
  const builtIn = defaultNativePlayerProfile;
  return profile.catalogId === builtIn.catalogId && profile.assetId === builtIn.assetId && profile.sourceObject === builtIn.sourceObject &&
    profile.sourceSha256 === builtIn.sourceSha256 && profile.collisionRadius === builtIn.collisionRadius &&
    profile.collisionHeight === builtIn.collisionHeight && profile.forwardAxis.every((value, index) => value === builtIn.forwardAxis[index]) &&
    profile.actorScale.every((value, index) => value === builtIn.actorScale[index]) &&
    requiredNativeAliases.every(alias => profile.clips[alias] === builtIn.clips[alias]) &&
    JSON.stringify(profile.upperItems) === JSON.stringify(builtIn.upperItems);
}

export async function loadNativePlayerProfiles(records: unknown, signal: AbortSignal): Promise<ReadonlyMap<string, NativePlayerProfile>> {
  if (!Array.isArray(records) || records.length > 16) throw new Error("Native player profile catalog is invalid.");
  const profiles = new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile]]), bundles = new Set<string>();
  let replacedBuiltIn = false;
  for (const value of records) {
    const entry = object(value), id = string(entry.id, identity), expectedHash = string(entry.manifestSha256, hash);
    if (bundles.has(id) || entry.manifest !== `/l2/player-profiles/${expectedHash}/manifest.json` ||
      !Number.isSafeInteger(entry.manifestBytes) || (entry.manifestBytes as number) <= 0 || (entry.manifestBytes as number) > 2_000_000) throw new Error("Native player manifest reference is invalid.");
    bundles.add(id);
    const response = await fetch(nativeResourceUrl(entry.manifest as string), { signal });
    if (!response.ok) throw new Error(`Native player profile request returned ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== entry.manifestBytes || await sha256(bytes) !== expectedHash) throw new Error("Native player profile manifest hash/length mismatch.");
    const manifest = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
    if (manifest.schemaVersion !== 1 || manifest.kind !== "native-player-profiles" || !Array.isArray(manifest.profiles) ||
      !manifest.profiles.length || manifest.profiles.length > 128) throw new Error("Native player manifest is invalid.");
    for (const row of manifest.profiles) {
      const profile = parseProfile(row);
      const builtIn = profile.id === defaultNativePlayerProfile.id && !replacedBuiltIn;
      if (builtIn && !matchesBuiltInMaleFighterIdentity(profile)) throw new Error("Native player profile differs from the built-in male fighter identity.");
      if (profiles.has(profile.id) && !builtIn) throw new Error("Native player profile identity is duplicated.");
      if (builtIn) replacedBuiltIn = true;
      profiles.set(profile.id, profile);
    }
  }
  signal.throwIfAborted();
  return profiles;
}

export function validateNativePlayerAssets(profile: NativePlayerProfile, assets: ReadonlyMap<string, AssetPackage>): void {
  const body = assets.get(profile.catalogId);
  if (!body || body.manifest.kind !== "model" || body.manifest.id !== profile.assetId || body.manifest.source.edition !== "interlude" ||
    body.manifest.source.object !== profile.sourceObject || body.manifest.source.sha256 !== profile.sourceSha256) throw new Error("Native player body source identity mismatch.");
  const glb = body.files.get(body.manifest.model?.file ?? "");
  if (!glb) throw new Error("Native player geometry is unavailable.");
  const clips = validatePackageModel(glb).animations;
  for (const name of Object.values(profile.clips)) if (clips.filter(clip => clip.name === name).length !== 1) throw new Error(`Native player clip ${name} is missing or ambiguous.`);
  const assembly = body.manifest.source.assembly;
  for (const item of profile.upperItems) {
    const asset = assets.get(item.catalogId);
    if (!asset || asset.manifest.kind !== "model" || asset.manifest.source.edition !== "interlude" ||
      asset.manifest.source.object !== item.sourceObject || asset.manifest.source.sha256 !== item.sourceSha256 ||
      !Array.isArray(assembly) || !assembly.includes(item.sourceObject)) throw new Error("Native player equipment source identity mismatch.");
  }
}

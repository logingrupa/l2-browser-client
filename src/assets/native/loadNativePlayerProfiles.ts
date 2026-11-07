import { sha256, validatePackageModel, type AssetPackage } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";

export interface NativePlayerProfile {
  readonly id: string;
  readonly name: string;
  readonly catalogId: string;
  readonly assetId: string;
  readonly sourceObject: string;
  readonly sourceSha256: string;
  readonly clips: Readonly<Record<"idle" | "run" | "attack" | "death", string>>;
  readonly forwardAxis: readonly [number, number, number];
  readonly actorScale: readonly [number, number, number];
  readonly collisionRadius: number;
  readonly collisionHeight: number;
  readonly sourceUnitsPerMetre: 100;
  readonly upperItems: readonly { itemId: number; catalogId: string; sourceObject: string; sourceSha256: string }[];
  readonly sourceEvidence: Readonly<Record<string, unknown>>;
  readonly limitations: readonly string[];
}

/** Preserve the existing male slice and authored clip overrides when no added
 * profile is selected. New variants are data in immutable staged manifests. */
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
function parseProfile(value: unknown): NativePlayerProfile {
  const row = object(value), rawClips = object(row.clips);
  const clips = { idle: string(rawClips.idle), run: string(rawClips.run), attack: string(rawClips.attack), death: string(rawClips.death) };
  if (Object.keys(rawClips).length !== 4) throw new Error("Native player clip mapping is invalid.");
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
    clips, forwardAxis: [axis[0], axis[1], axis[2]], actorScale: [scale[0], scale[1], scale[2]], collisionRadius: dimension(row.collisionRadius),
    collisionHeight: dimension(row.collisionHeight), sourceUnitsPerMetre: 100, upperItems,
    sourceEvidence, limitations: row.limitations.map((v: unknown) => string(v)) };
}

export async function loadNativePlayerProfiles(records: unknown, signal: AbortSignal): Promise<ReadonlyMap<string, NativePlayerProfile>> {
  if (!Array.isArray(records) || records.length > 16) throw new Error("Native player profile catalog is invalid.");
  const profiles = new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile]]), bundles = new Set<string>();
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
      if (profiles.has(profile.id)) throw new Error("Native player profile identity is duplicated.");
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

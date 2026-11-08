import { sha256 } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";

export interface NativeNpcProfile {
  readonly id: string;
  readonly npcId: number;
  readonly name: string;
  readonly mesh: string;
  readonly actorClass: string;
  readonly drawScale: number;
  readonly drawScale3D: readonly [number, number, number];
  readonly collisionRadius: number;
  readonly collisionHeight: number;
  readonly sourceUnitsPerMetre: 100;
  readonly prePivot?: readonly [number, number, number];
  readonly modelCatalogId?: string;
  readonly unsupportedFields: readonly { field: string; reason: string }[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Native NPC profile object is invalid.");
  return value as Record<string, unknown>;
}
function vector(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(item => typeof item === "number" && Number.isFinite(item))) {
    throw new Error("Native NPC profile vector is invalid.");
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}
const modelCatalogIdPattern = /^[a-z0-9][a-z0-9:-]{0,95}$/;
function optionalModelCatalogId(value: unknown): { readonly modelCatalogId?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string" || !modelCatalogIdPattern.test(value)) throw new Error("Native NPC profile modelCatalogId is invalid.");
  return { modelCatalogId: value };
}
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("Native NPC profile dimension is invalid.");
  return value;
}

export async function loadNativeNpcProfiles(records: unknown, signal: AbortSignal): Promise<ReadonlyMap<string, NativeNpcProfile>> {
  if (!Array.isArray(records) || records.length > 16) throw new Error("Native NPC profile catalog is invalid.");
  const result = new Map<string, NativeNpcProfile>(), bundles = new Set<string>();
  for (const item of records as unknown[]) {
    const record = object(item);
    if (typeof record.id !== "string" || bundles.has(record.id) || typeof record.manifestSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.manifestSha256) ||
      record.manifest !== `/l2/npc-profiles/${record.manifestSha256}/manifest.json` ||
      !Number.isSafeInteger(record.manifestBytes) || (record.manifestBytes as number) <= 0 || (record.manifestBytes as number) > 8_000_000) {
      throw new Error("Native NPC profile catalog entry is invalid.");
    }
    bundles.add(record.id);
    const response = await fetch(nativeResourceUrl(record.manifest as string), { signal });
    if (!response.ok) throw new Error(`Native NPC profile request returned ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== record.manifestBytes || await sha256(bytes) !== record.manifestSha256) throw new Error("Native NPC profile manifest hash/length mismatch.");
    const manifest = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
    if (manifest.schemaVersion !== 1 || manifest.kind !== "native-npc-profiles" || manifest.support !== "source-profile-fields-ready" ||
      !Array.isArray(manifest.unsupported) || manifest.unsupported.length ||
      !Array.isArray(manifest.profiles) || !manifest.profiles.length || manifest.profiles.length > 128) throw new Error("Native NPC profile manifest is incomplete.");
    for (const candidate of manifest.profiles as unknown[]) {
      const row = object(candidate);
      if (!Number.isSafeInteger(row.npcId) || (row.npcId as number) <= 0 || row.id !== `npc:${row.npcId}` ||
        result.has(row.id as string) || typeof row.name !== "string" || !row.name || row.sourceUnitsPerMetre !== 100 ||
        typeof row.mesh !== "string" || !/^\w+(?:\.\w+)+$/.test(row.mesh) ||
        typeof row.actorClass !== "string" || !/^\w+(?:\.\w+)+$/.test(row.actorClass)) throw new Error("Native NPC profile identity is invalid or duplicated.");
      const drawScale3D = vector(row.drawScale3D), prePivot = row.prePivot === undefined ? undefined : vector(row.prePivot);
      const gaps = row.unsupportedFields ?? [];
      if (!Array.isArray(gaps) || gaps.length > 16) throw new Error("Native NPC unsupported-field record is invalid.");
      const unsupportedFields = (gaps as unknown[]).map(item => {
        const gap = object(item);
        if (typeof gap.field !== "string" || !gap.field || typeof gap.reason !== "string" || !gap.reason) throw new Error("Native NPC unsupported-field record is invalid.");
        return { field: gap.field, reason: gap.reason };
      });
      if (!prePivot && !unsupportedFields.some(gap => gap.field === "prePivot")) throw new Error("Unresolved native actor pivot must be explicit.");
      if (drawScale3D.some(value => value <= 0)) throw new Error("Native NPC profile scale must be positive.");
      result.set(row.id as string, { id: row.id as string, npcId: row.npcId as number, name: row.name,
        mesh: row.mesh, actorClass: row.actorClass, drawScale: positive(row.drawScale), drawScale3D,
        collisionRadius: positive(row.collisionRadius), collisionHeight: positive(row.collisionHeight),
        sourceUnitsPerMetre: 100, unsupportedFields, ...(prePivot ? { prePivot } : {}), ...optionalModelCatalogId(row.modelCatalogId) });
    }
  }
  signal.throwIfAborted();
  return result;
}

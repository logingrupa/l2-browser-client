import { loadNativeNpcProfiles } from "./loadNativeNpcProfiles";
import { loadNativePlayerProfiles } from "./loadNativePlayerProfiles";
import { readTileCatalogRecord, type NativeTileManifestCatalogRecord } from "./nativeCatalogRecords";
import type { NativeCatalog } from "./readNativeCatalog";

export interface NativeNpcCatalogRecord { readonly npcId: number; readonly profileId: string; readonly modelCatalogId: string }
export interface NativeItemCatalogRecord {
  readonly itemId: number; readonly slot: "upper"; readonly catalogIds: readonly string[]; readonly playerProfileIds: readonly string[];
}
export interface NativeSkillCatalogRecord { readonly skillId: number; readonly level: number; readonly effectComponentId: string }
export interface NativeTileCatalogRecord { readonly tile: string; readonly sectionId: string }
export type NativeCatalogRecord =
  | NativeNpcCatalogRecord | NativeItemCatalogRecord | NativeSkillCatalogRecord | NativeTileCatalogRecord | NativeTileManifestCatalogRecord;

export type NativeCatalogLookup =
  | { readonly status: "converted"; readonly key: string; readonly record: NativeCatalogRecord }
  | { readonly status: "not-in-catalog"; readonly key: string; readonly reason: string };

export interface NativeCatalogIndex {
  lookup(key: string): NativeCatalogLookup;
  keys(prefix: string): readonly string[];
}

const windowNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const tilePattern = /^\d{2}_\d{2}$/;
const skillEffectComponentPattern = /^interlude:skill:(\d+):level:(\d+):/;
const sectionTilePattern = /^map-(\d{2})-(\d{2})-section$/;
const windowsNotConvertedReason = "interface windows are not converted yet (UI-01)";
export const notInCatalogReason = "not in catalog";

function requireCatalogInteger(value: number, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${label} must be a safe integer of at least ${minimum}.`);
  return value;
}

export function npcCatalogKey(npcId: number): string {
  return `npc:${requireCatalogInteger(npcId, 0, "NPC id")}`;
}

export function itemCatalogKey(itemId: number): string {
  return `item:${requireCatalogInteger(itemId, 0, "Item id")}`;
}

export function skillCatalogKey(skillId: number, level: number): string {
  return `skill:${requireCatalogInteger(skillId, 0, "Skill id")}:${requireCatalogInteger(level, 1, "Skill level")}`;
}

export function windowCatalogKey(name: string): string {
  if (!windowNamePattern.test(name)) throw new RangeError("Window name must be a bounded interface window identifier.");
  return `window:${name}`;
}

export function tileCatalogKey(tile: string): string {
  if (!tilePattern.test(tile)) throw new RangeError("Tile must be written as XX_YY.");
  return `tile:${tile}`;
}

export function describeNativeCatalogLookup(lookup: NativeCatalogLookup): string {
  if (lookup.status === "converted") return `${lookup.key} converted`;
  return lookup.reason === notInCatalogReason ? `${lookup.key} not in catalog` : `${lookup.key} not in catalog: ${lookup.reason}`;
}

function duplicateEntries(key: string): Error {
  return new Error(`Native catalog has duplicate entries for ${key}.`);
}

function catalogRecordIdentity(value: unknown, sliceName: string): Record<string, unknown> & { id: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as { id?: unknown }).id !== "string") {
    throw new Error(`Native catalog ${sliceName} entry is invalid.`);
  }
  return value as Record<string, unknown> & { id: string };
}

function readModelSourceObjects(models: readonly unknown[]): ReadonlyMap<string, string | null> {
  const sourceObjectsByModelId = new Map<string, string | null>();
  for (const value of models) {
    const model = catalogRecordIdentity(value, "model");
    if (sourceObjectsByModelId.has(model.id)) throw duplicateEntries(model.id);
    const source = model.source;
    const sourceObject = typeof source === "object" && source !== null && typeof (source as { object?: unknown }).object === "string"
      ? (source as { object: string }).object : null;
    sourceObjectsByModelId.set(model.id, sourceObject);
  }
  return sourceObjectsByModelId;
}

export function unavailableNativeCatalogIndex(failure: string): NativeCatalogIndex {
  const reason = `catalog index unavailable: ${failure}`;
  return { lookup: key => ({ status: "not-in-catalog", key, reason }), keys: () => [] };
}

export async function buildNativeCatalogIndex(catalog: NativeCatalog, signal: AbortSignal): Promise<NativeCatalogIndex> {
  const entries = new Map<string, NativeCatalogLookup>();
  const addEntry = (lookup: NativeCatalogLookup) => {
    if (entries.has(lookup.key)) throw duplicateEntries(lookup.key);
    entries.set(lookup.key, lookup);
  };
  const sourceObjectsByModelId = readModelSourceObjects(catalog.models);

  for (const profile of (await loadNativeNpcProfiles(catalog.npcProfiles, signal)).values()) {
    const key = npcCatalogKey(profile.npcId);
    const modelIds = [...sourceObjectsByModelId].filter(([, sourceObject]) => sourceObject === profile.mesh).map(([modelId]) => modelId);
    if (modelIds.length > 1) {
      addEntry({ status: "not-in-catalog", key, reason: `mesh ${profile.mesh} matches ${modelIds.length} converted packages (${modelIds.sort().join(", ")})` });
      continue;
    }
    if (!modelIds.length) {
      addEntry({ status: "not-in-catalog", key, reason: `NPC profile staged but mesh ${profile.mesh} has no converted model` });
      continue;
    }
    addEntry({ status: "converted", key, record: { npcId: profile.npcId, profileId: profile.id, modelCatalogId: modelIds[0]! } });
  }

  const upperItems = new Map<number, { catalogIds: Set<string>; playerProfileIds: Set<string> }>();
  for (const profile of (await loadNativePlayerProfiles(catalog.playerProfiles, signal)).values()) {
    for (const item of profile.upperItems) {
      if (!sourceObjectsByModelId.has(item.catalogId)) continue;
      const staged = upperItems.get(item.itemId) ?? { catalogIds: new Set<string>(), playerProfileIds: new Set<string>() };
      staged.catalogIds.add(item.catalogId);
      staged.playerProfileIds.add(profile.id);
      upperItems.set(item.itemId, staged);
    }
  }
  for (const [itemId, staged] of upperItems) {
    addEntry({ status: "converted", key: itemCatalogKey(itemId), record: { itemId, slot: "upper",
      catalogIds: [...staged.catalogIds].sort(), playerProfileIds: [...staged.playerProfileIds].sort() } });
  }

  for (const value of catalog.effectComponents) {
    const component = catalogRecordIdentity(value, "effect component");
    const match = skillEffectComponentPattern.exec(component.id);
    if (!match) continue;
    const skillId = Number(match[1]), level = Number(match[2]);
    addEntry({ status: "converted", key: skillCatalogKey(skillId, level), record: { skillId, level, effectComponentId: component.id } });
  }

  for (const value of catalog.tiles) {
    const record = readTileCatalogRecord(value);
    addEntry({ status: "converted", key: tileCatalogKey(record.tile), record });
  }

  const sectionIds = new Set<string>();
  for (const value of catalog.sections) {
    const section = catalogRecordIdentity(value, "section");
    if (sectionIds.has(section.id)) throw duplicateEntries(section.id);
    sectionIds.add(section.id);
    const match = sectionTilePattern.exec(section.id);
    if (!match) continue;
    const tile = `${match[1]}_${match[2]}`;
    const key = tileCatalogKey(tile);
    if (entries.has(key)) continue;
    addEntry({ status: "converted", key, record: { tile, sectionId: section.id } });
  }

  signal.throwIfAborted();
  return {
    lookup(key) {
      const entry = entries.get(key);
      if (entry) return entry;
      return { status: "not-in-catalog", key, reason: key.startsWith("window:") ? windowsNotConvertedReason : notInCatalogReason };
    },
    keys(prefix) {
      return [...entries.keys()].filter(key => key.startsWith(prefix)).sort();
    },
  };
}

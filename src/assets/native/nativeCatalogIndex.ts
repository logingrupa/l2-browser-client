import { loadNativeNpcProfiles, type NativeNpcProfile } from "./loadNativeNpcProfiles";
import { joinNpcProfileToModel, type NativeNpcModelJoinKind } from "./nativeNpcModelJoin";
import { loadNativePlayerProfiles, type NativePlayerProfile } from "./loadNativePlayerProfiles";
import {
  readTableCatalogRecord, readTileCatalogRecord, readWindowCatalogRecord, tableIdPattern, tileIdPattern, windowIdPattern,
  type NativeTableCatalogRecord, type NativeTileManifestCatalogRecord, type NativeWindowCatalogRecord,
} from "./nativeCatalogRecords";
import type { NativeCatalog } from "./readNativeCatalog";
import { parseSkillEffectComponentId } from "../../effects/castSkillIndex";
import { readNativeCoverageUnlessAbsent, type NativeCoverageStatus } from "./readNativeCoverage";

export interface NativeNpcCatalogRecord {
  readonly npcId: number; readonly profileId: string; readonly modelCatalogId: string; readonly join: NativeNpcModelJoinKind;
}
export interface NativeItemCatalogRecord {
  readonly itemId: number; readonly slot: "upper"; readonly catalogIds: readonly string[]; readonly playerProfileIds: readonly string[];
}
export interface NativeSkillCatalogRecord { readonly skillId: number; readonly level: number; readonly effectComponentId: string }
export interface NativeTileCatalogRecord { readonly tile: string; readonly sectionId: string }
export interface NativeCharacterCatalogRecord { readonly chargrpIndex: number; readonly playerProfileId: string; readonly catalogId: string }
export type NativeCatalogRecord =
  | NativeNpcCatalogRecord | NativeItemCatalogRecord | NativeSkillCatalogRecord | NativeTileCatalogRecord | NativeTileManifestCatalogRecord
  | NativeTableCatalogRecord | NativeWindowCatalogRecord | NativeCharacterCatalogRecord;

export type NativeCatalogLookup =
  | { readonly status: "converted"; readonly key: string; readonly record: NativeCatalogRecord }
  | { readonly status: "not-in-catalog"; readonly key: string; readonly reason: string }
  | { readonly status: "gap"; readonly key: string; readonly reason: string; readonly coverageStatus: Exclude<NativeCoverageStatus, "pass"> };

export interface NativeCatalogIndex {
  lookup(key: string): NativeCatalogLookup;
  keys(prefix: string): readonly string[];
}

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

export function characterCatalogKey(chargrpIndex: number): string {
  return `character:${requireCatalogInteger(chargrpIndex, 0, "Chargrp index")}`;
}

export function tableCatalogKey(table: string): string {
  if (!tableIdPattern.test(table)) throw new RangeError("Table must be a lower-case inventory table name.");
  return `table:${table}`;
}

export function windowCatalogKey(name: string): string {
  if (!windowIdPattern.test(name)) throw new RangeError("Window name must be a bounded interface window identifier.");
  return `window:${name}`;
}

export function tileCatalogKey(tile: string): string {
  if (!tileIdPattern.test(tile)) throw new RangeError("Tile must be written as XX_YY.");
  return `tile:${tile}`;
}

export function describeNativeCatalogLookup(lookup: NativeCatalogLookup): string {
  if (lookup.status === "converted") return `${lookup.key} converted`;
  if (lookup.status === "gap") return `${lookup.key} gap: ${lookup.reason}`;
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

export function readModelSourceObjects(models: readonly unknown[]): ReadonlyMap<string, string | null> {
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

function npcCatalogLookup(profile: NativeNpcProfile, sourceObjectsByModelId: ReadonlyMap<string, string | null>): NativeCatalogLookup {
  const key = npcCatalogKey(profile.npcId), modelJoin = joinNpcProfileToModel(profile, sourceObjectsByModelId);
  if (modelJoin.status === "missing") return { status: "not-in-catalog", key, reason: modelJoin.reason };
  return { status: "converted", key,
    record: { npcId: profile.npcId, profileId: profile.id, modelCatalogId: modelJoin.modelCatalogId, join: modelJoin.join } };
}

function upperItemLookups(playerProfiles: Iterable<NativePlayerProfile>, sourceObjectsByModelId: ReadonlyMap<string, string | null>): NativeCatalogLookup[] {
  const upperItems = new Map<number, { catalogIds: Set<string>; playerProfileIds: Set<string> }>();
  for (const profile of playerProfiles) {
    for (const item of profile.upperItems) {
      if (!sourceObjectsByModelId.has(item.catalogId)) continue;
      const staged = upperItems.get(item.itemId) ?? { catalogIds: new Set<string>(), playerProfileIds: new Set<string>() };
      staged.catalogIds.add(item.catalogId);
      staged.playerProfileIds.add(profile.id);
      upperItems.set(item.itemId, staged);
    }
  }
  return [...upperItems].map(([itemId, staged]) => ({ status: "converted", key: itemCatalogKey(itemId), record: { itemId, slot: "upper",
    catalogIds: [...staged.catalogIds].sort(), playerProfileIds: [...staged.playerProfileIds].sort() } }));
}

function characterLookup(profile: NativePlayerProfile, chargrpIndex: number, sourceObjectsByModelId: ReadonlyMap<string, string | null>): NativeCatalogLookup {
  const key = characterCatalogKey(chargrpIndex);
  if (!sourceObjectsByModelId.has(profile.catalogId)) {
    return { status: "not-in-catalog", key, reason: `player profile ${profile.id} model ${profile.catalogId} is not in the catalog` };
  }
  return { status: "converted", key, record: { chargrpIndex, playerProfileId: profile.id, catalogId: profile.catalogId } };
}

function skillLookups(effectComponents: readonly unknown[]): NativeCatalogLookup[] {
  const lookups: NativeCatalogLookup[] = [];
  for (const value of effectComponents) {
    const component = catalogRecordIdentity(value, "effect component");
    const identity = parseSkillEffectComponentId(component.id);
    if (!identity) continue;
    const { skillId, level } = identity;
    lookups.push({ status: "converted", key: skillCatalogKey(skillId, level), record: { skillId, level, effectComponentId: component.id } });
  }
  return lookups;
}

function legacySectionTileLookups(sections: readonly unknown[]): NativeCatalogLookup[] {
  const sectionIds = new Set<string>();
  const lookups: NativeCatalogLookup[] = [];
  for (const value of sections) {
    const section = catalogRecordIdentity(value, "section");
    if (sectionIds.has(section.id)) throw duplicateEntries(section.id);
    sectionIds.add(section.id);
    const match = sectionTilePattern.exec(section.id);
    if (!match) continue;
    const tile = `${match[1]}_${match[2]}`;
    lookups.push({ status: "converted", key: tileCatalogKey(tile), record: { tile, sectionId: section.id } });
  }
  return lookups;
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

  for (const profile of (await loadNativeNpcProfiles(catalog.npcProfiles, signal)).values()) addEntry(npcCatalogLookup(profile, sourceObjectsByModelId));
  const playerProfiles = [...(await loadNativePlayerProfiles(catalog.playerProfiles, signal)).values()];
  for (const lookup of upperItemLookups(playerProfiles, sourceObjectsByModelId)) addEntry(lookup);
  for (const profile of playerProfiles) {
    if (profile.chargrpIndex !== undefined) addEntry(characterLookup(profile, profile.chargrpIndex, sourceObjectsByModelId));
  }
  for (const lookup of skillLookups(catalog.effectComponents)) addEntry(lookup);
  for (const value of catalog.tables) {
    const record = readTableCatalogRecord(value);
    addEntry({ status: "converted", key: tableCatalogKey(record.table), record });
  }
  for (const value of catalog.windows) {
    const record = readWindowCatalogRecord(value);
    addEntry({ status: "converted", key: windowCatalogKey(record.window), record });
  }
  for (const value of catalog.tiles) {
    const record = readTileCatalogRecord(value);
    addEntry({ status: "converted", key: tileCatalogKey(record.tile), record });
  }
  for (const lookup of legacySectionTileLookups(catalog.sections)) if (!entries.has(lookup.key)) addEntry(lookup);

  for (const row of (await readNativeCoverageUnlessAbsent(signal, catalog.servedCatalogSha256, catalog.laneCatalogSha256))?.rows ?? []) {
    if (row.status === "pass" || entries.has(row.key)) continue;
    addEntry({ status: "gap", key: row.key, reason: row.reason, coverageStatus: row.status });
  }

  const missingWindowReason = catalog.windows.length ? notInCatalogReason : windowsNotConvertedReason;
  signal.throwIfAborted();
  return {
    lookup(key) {
      const entry = entries.get(key);
      if (entry) return entry;
      return { status: "not-in-catalog", key, reason: key.startsWith("window:") ? missingWindowReason : notInCatalogReason };
    },
    keys(prefix) {
      return [...entries.keys()].filter(key => key.startsWith(prefix)).sort();
    },
  };
}

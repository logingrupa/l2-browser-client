import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nativeSliceNpcIds } from "../../src/assets/native/loadNativeCatalog";
import { maximumNpcProfileBundles, maximumProfilesPerBundle, sharedStoreNpcProfileRecordId } from "../../src/assets/native/loadNativeNpcProfiles";

const sharedStoreNpcProfileRecipePath = "recipes/native-npc-profiles.json";

function readJson<Value>(path: string): Value {
  return JSON.parse(readFileSync(path, "utf-8")) as Value;
}

function pythonIntegerConstant(source: string, name: string): number {
  const match = new RegExp(`^${name} = (\\d+)$`, "m").exec(source);
  if (!match) throw new Error(`scripts/native_actor_profiles.py has no ${name} integer constant.`);
  return Number(match[1]);
}

describe("NPC profile bounds and slice ids agree across TypeScript, Python and the committed data", () => {
  it("uses the Python profile bounds, whose product covers every decoded npcgrp row", () => {
    const pythonSource = readFileSync("scripts/native_actor_profiles.py", "utf-8");
    expect(maximumProfilesPerBundle).toBe(pythonIntegerConstant(pythonSource, "MAXIMUM_PROFILES_PER_BUNDLE"));
    expect(maximumNpcProfileBundles).toBe(pythonIntegerConstant(pythonSource, "MAXIMUM_NPC_PROFILE_BUNDLES"));
    const census = readJson<{ tables: { table: string; rowCount: number }[] }>("docs/parts/npcs/actor-unit-census.json");
    const npcgrpTables = census.tables.filter(table => table.table === "npcgrp");
    expect(npcgrpTables).toHaveLength(1);
    expect(maximumProfilesPerBundle * maximumNpcProfileBundles).toBeGreaterThanOrEqual(npcgrpTables[0]!.rowCount);
  });

  it("pins the slice NPC ids to the npcIds of the shared-store profile recipe", () => {
    const recipe = readJson<{ profiles: { npcId: number }[] }>(sharedStoreNpcProfileRecipePath);
    expect(nativeSliceNpcIds).toEqual(recipe.profiles.map(profile => profile.npcId));
  });

  it("pins the shared-store record id to the migration job that builds the shared-store profile recipe", () => {
    const migration = readJson<{ jobs: { id: string; recipe?: string }[] }>("recipes/native-migration.json");
    const jobs = migration.jobs.filter(job => job.recipe === sharedStoreNpcProfileRecipePath);
    expect(jobs.map(job => job.id)).toEqual([sharedStoreNpcProfileRecordId]);
  });
});

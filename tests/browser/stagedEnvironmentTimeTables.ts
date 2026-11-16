import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nativeEnvironmentRecordId } from "../../src/scene/world/nativeEnvironmentTables";

interface CatalogWithEnvironments { readonly environments?: readonly { readonly id?: string }[] }

export const environmentTimeTablesRequirement = `environment-time-tables-unstaged: the served catalog has no environments record ${nativeEnvironmentRecordId}, `
  + "so tile lighting and the sky colours stay unbound; run scripts/world/environment_step.py in the world lane, then write the lane catalog and the union";

function catalogPinsEnvironment(catalogPath: string): boolean {
  if (!existsSync(catalogPath)) return false;
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogWithEnvironments;
  return (catalog.environments ?? []).some(record => record.id === nativeEnvironmentRecordId);
}

export function environmentTimeTablesStaged(storeName: string): boolean {
  return [resolve("artifacts/lane-store", storeName, "l2/catalog.json"), resolve("public/l2/catalog.json")].some(catalogPinsEnvironment);
}

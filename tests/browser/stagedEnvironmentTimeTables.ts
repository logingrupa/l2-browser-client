import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { nativeEnvironmentRecordId } from "../../src/scene/world/nativeEnvironmentTables";

interface CatalogWithEnvironments { readonly environments?: readonly { readonly id?: string; readonly manifest?: string }[] }

const stagedTimeTablesSchemaVersion = 2;
export const environmentTimeTablesRequirement = `environment-time-tables-unstaged: the served catalog has no environments record ${nativeEnvironmentRecordId} `
  + `with schema ${stagedTimeTablesSchemaVersion} time tables, so tile lighting and the sky colours stay unbound; run scripts/world/environment_step.py in the world lane, `
  + "then write the lane catalog and the union";

function catalogPinsEnvironment(catalogPath: string): boolean {
  if (!existsSync(catalogPath)) return false;
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogWithEnvironments;
  const manifest = (catalog.environments ?? []).find(record => record.id === nativeEnvironmentRecordId)?.manifest;
  if (manifest === undefined) return false;
  const timeTablesPath = resolve(dirname(catalogPath), dirname(manifest.replace(/^\/l2\//, "")), "time-tables.json");
  if (!existsSync(timeTablesPath)) return false;
  return (JSON.parse(readFileSync(timeTablesPath, "utf8")) as { readonly schemaVersion?: number }).schemaVersion === stagedTimeTablesSchemaVersion;
}

export function environmentTimeTablesStaged(storeName: string): boolean {
  return [resolve("artifacts/lane-store", storeName, "l2/catalog.json"), resolve("public/l2/catalog.json")].some(catalogPinsEnvironment);
}

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nativeEnvironmentSource } from "../../src/scene/world/nativeEnvironmentTables";

const timeTablesProduct = "time-tables.json";
const conversionManifestPath = `l2/environments/${nativeEnvironmentSource.conversionManifestSha256}/conversion-manifest.json`;

export const environmentTimeTablesRequirement = `environment-time-tables-unstaged: the staged environment export ${nativeEnvironmentSource.conversionManifestSha256.slice(0, 8)} `
  + `has no ${timeTablesProduct}, so tile lighting and the sky colours stay unbound; the integration thread restages it and re-pins nativeEnvironmentSource`;

export function environmentTimeTablesStaged(storeName: string): boolean {
  const manifestPath = [resolve("artifacts/lane-store", storeName, conversionManifestPath), resolve("public", conversionManifestPath)].find(path => existsSync(path));
  if (manifestPath === undefined) return false;
  const products = (JSON.parse(readFileSync(manifestPath, "utf8")) as { products?: Record<string, unknown> }).products ?? {};
  return Object.hasOwn(products, timeTablesProduct);
}

import type { AssetPackage } from "../../../src/assets/package/readAssetPackage";

export function copyAssetPackage(source: AssetPackage): AssetPackage {
  return { manifest: structuredClone(source.manifest), files: new Map(source.files) };
}

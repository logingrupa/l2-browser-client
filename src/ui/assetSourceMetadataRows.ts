import type { AssetPackageManifest } from "../assets/package/readAssetPackage";

export type AssetSourceMetadataRow = readonly [label: string, value: string];

export function assetSourceMetadataRows(manifest: AssetPackageManifest): readonly AssetSourceMetadataRow[] {
  return [
    ["Edition", "Interlude"],
    ["Package", manifest.source.package],
    ["Object", manifest.source.object],
    ...(manifest.coordinates ? [["Unit", `1 metre = ${manifest.coordinates.sourceUnitsPerMetre} source units`] as const] : []),
    ...(manifest.model ? [["Viewer scale", "1:1 — no size normalization"] as const] : []),
    ["Source SHA-256", manifest.source.sha256],
  ];
}

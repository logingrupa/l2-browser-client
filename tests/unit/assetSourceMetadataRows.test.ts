import { describe, expect, it } from "vitest";
import type { AssetPackageManifest, AssetPackageManifestVersionTwo } from "../../src/assets/package/readAssetPackage";
import { assetSourceMetadataRows } from "../../src/ui/assetSourceMetadataRows";
import { assetFixture } from "../fixtures/assetPackageFixture";

const identityTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function versionTwoModelManifest(): AssetPackageManifestVersionTwo {
  return { schemaVersion: 2, id: "fixture-model", name: "Native model fixture", kind: "model",
    source: { edition: "interlude", package: "Fixture", object: "Fixture.Native", sha256: "a".repeat(64), path: { host: "fixture", absolutePath: "C:/fixture/Fixture.ukx" } },
    clientBuild: { referenceTreeLockSha256: "b".repeat(64), engineDllSha256: "c".repeat(64) }, converterVersion: "fixture",
    model: { file: "model.glb" },
    coordinates: { unit: "metre", sourceUnitsPerMetre: 52.5, handedness: "right", upAxis: "Y", sourceToGltf: identityTransform },
    files: [{ path: "model.glb", sha256: "d".repeat(64), bytes: 1, mime: "model/gltf-binary" }], limitations: [] };
}

const rowValue = (manifest: AssetPackageManifest, label: string) => assetSourceMetadataRows(manifest).find(([rowLabel]) => rowLabel === label)?.[1];

describe("asset inspector source metadata rows", () => {
  it("reads the unit of an asset.json v2 model from its coordinates", () => {
    expect(rowValue(versionTwoModelManifest(), "Unit")).toBe("1 metre = 52.5 source units");
    expect(rowValue(versionTwoModelManifest(), "Viewer scale")).toBe("1:1 — no size normalization");
  });

  it("reads the unit of a normalized asset.json v1 model from its coordinates", async () => {
    const { readManifest } = await assetFixture("model");
    expect(rowValue(readManifest, "Unit")).toBe("1 metre = 100 source units");
  });

  it("lists no unit or viewer scale for an audio package", async () => {
    const { readManifest } = await assetFixture("audio");
    expect(assetSourceMetadataRows(readManifest).map(([label]) => label)).toEqual(["Edition", "Package", "Object", "Source SHA-256"]);
  });
});

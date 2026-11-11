import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nativeSectionManifestPath, nativeSectionResourcePaths, privatePreviewCatalogPath, privatePreviewOrigin, privatePreviewWorldPath } from "../../scripts/private-preview-targets.mjs";

const privatePreviewScriptPaths = [
  "scripts/private-preview.mjs",
  "scripts/check-private-preview.mjs",
  "scripts/check-private-preview-burst.mjs",
  "scripts/check-private-preview-external.mjs",
  "scripts/private-preview-tunnel.ps1",
];
const nodePrivatePreviewScriptPaths = privatePreviewScriptPaths.filter(scriptPath => scriptPath.endsWith(".mjs"));
const sectionManifestSha256 = "a".repeat(64);
const sectionBase = `/l2/maps/${sectionManifestSha256}/`;
const sectionRecord = { manifest: `${sectionBase}map-section-runtime/manifest.json`, manifestSha256: sectionManifestSha256 };

describe("private preview targets", () => {
  it("opens the native sandbox world through the code-built route", () => {
    expect(privatePreviewWorldPath).toBe("/");
    expect(privatePreviewCatalogPath).toBe("/l2/catalog.json");
    expect(privatePreviewOrigin).toBe("https://l2.kingdom.lv");
  });

  it("leaves no preview script on the retired authored route or Editor scene", () => {
    for (const scriptPath of privatePreviewScriptPaths) {
      const scriptText = readFileSync(scriptPath, "utf8");
      expect(scriptText, scriptPath).not.toMatch(/authored=1|native-world\.babylon|\/scene\//);
    }
  });

  it("reads the world route from the shared target module in every Node preview script", () => {
    for (const scriptPath of nodePrivatePreviewScriptPaths) {
      expect(readFileSync(scriptPath, "utf8"), scriptPath).toContain("./private-preview-targets.mjs");
    }
  });

  it("reports the native sandbox world URL from the tunnel connector", () => {
    expect(readFileSync("scripts/private-preview-tunnel.ps1", "utf8")).toContain(`url='${privatePreviewOrigin}${privatePreviewWorldPath}'`);
  });

  it("redirects a valid invite to the native sandbox world", () => {
    expect(readFileSync("scripts/private-preview.mjs", "utf8")).toContain('return 303 "${privatePreviewWorldPath}";');
  });

  it("lists the hash-addressed section manifest, terrain, patches, models and BSP once each", () => {
    const sectionManifest = {
      terrain: { file: "terrain.glb" },
      terrainPatches: [{ model: { file: "terrain-patch-0.glb" } }],
      models: [{ model: { file: `${"b".repeat(64)}/model.glb` } }, { model: { file: `${"b".repeat(64)}/model.glb` } }],
      bsp: [{ model: { file: "bsp-floor.glb" } }],
    };
    expect(nativeSectionResourcePaths(sectionRecord, sectionManifest)).toEqual([
      sectionRecord.manifest,
      `${sectionBase}map-section/terrain.glb`,
      `${sectionBase}map-section/terrain-patch-0.glb`,
      `${sectionBase}map-section-models/${"b".repeat(64)}/model.glb`,
      `${sectionBase}map-section-bsp/bsp-floor.glb`,
    ]);
  });

  it("refuses a section manifest path that is not hash-addressed", () => {
    expect(() => nativeSectionResourcePaths({ ...sectionRecord, manifest: "/l2/maps/other/manifest.json" }, { terrain: { file: "terrain.glb" }, models: [] }))
      .toThrow("Native catalog section manifest path is not hash-addressed.");
  });

  it("validates the section manifest path from the catalog record alone, before any manifest is read", () => {
    expect(nativeSectionManifestPath(sectionRecord)).toBe(sectionRecord.manifest);
    expect(() => nativeSectionManifestPath({ ...sectionRecord, manifest: "/../.assets/private-preview/access-key" }))
      .toThrow("Native catalog section manifest path is not hash-addressed.");
    expect(() => nativeSectionManifestPath({ ...sectionRecord, manifestSha256: "../.assets" }))
      .toThrow("Native catalog section has no valid manifest hash.");
  });

  it("reads each section manifest only through its validated path inside dist in the burst check", () => {
    const burstScriptText = readFileSync("scripts/check-private-preview-burst.mjs", "utf8");
    expect(burstScriptText).toContain("readDistFile(nativeSectionManifestPath(sectionRecord))");
    expect(burstScriptText).not.toContain("readDistFile(sectionRecord.manifest)");
  });

  it("refuses a resource file that climbs out of the section", () => {
    expect(() => nativeSectionResourcePaths(sectionRecord, { terrain: { file: "../../catalog.json" }, models: [] }))
      .toThrow("Native section terrain has an unsafe resource file.");
  });
});

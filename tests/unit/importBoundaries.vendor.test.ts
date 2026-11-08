import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listTypeScriptModules, readSourceModuleText, readSourceTextImports } from "../support/sourceImportSpecifiers";

const lazyInspectorEntryModule = "src/scene/openBabylonInspector.ts";
const vendorPackagesWithoutSemantics = ["@recast-navigation", "@babylonjs/materials", "@babylonjs/node-particle-editor"];
const vendorSemanticsIdentifierPattern = /\b(ParticleSystem|GPUParticleSystem|SolidParticleSystem|moveWithCollisions|checkCollisions)\b/g;
const recastPackages = ["@recast-navigation/core", "@recast-navigation/generators"];
const pinnedRecastVersion = "0.43.0";
const probeModulePath = "src/scene/vendorBoundaryProbe.ts";

interface PackageManifest {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

function isVendorPackageWithoutSemantics(specifier: string): boolean {
  return vendorPackagesWithoutSemantics.some(packageName => specifier === packageName || specifier.startsWith(`${packageName}/`));
}

function findVendorImportViolations(modulePath: string, sourceText: string): string[] {
  if (modulePath === lazyInspectorEntryModule) return [];
  return readSourceTextImports(modulePath, sourceText)
    .filter(sourceImport => isVendorPackageWithoutSemantics(sourceImport.specifier))
    .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`);
}

function findVendorSemanticsViolations(modulePath: string, sourceText: string): string[] {
  return sourceText.split("\n").flatMap((line, lineIndex) => [...line.matchAll(vendorSemanticsIdentifierPattern)]
    .map(match => `${modulePath}:${lineIndex + 1} ${match[1]}`));
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as PackageManifest;
}

const sourceModules = listTypeScriptModules("src");

describe("vendor boundary over src", () => {
  it("scans every source module, the lazy inspector entry included", () => {
    expect(sourceModules).toContain(lazyInspectorEntryModule);
    expect(sourceModules.length).toBeGreaterThan(100);
  });

  it("imports no recast, Babylon materials or node particle editor module outside the lazy inspector entry", () => {
    const violations = sourceModules.flatMap(modulePath => findVendorImportViolations(modulePath, readSourceModuleText(modulePath)));
    expect(violations).toEqual([]);
  });

  it("uses no Babylon particle system or Babylon collision movement", () => {
    const violations = sourceModules.flatMap(modulePath => findVendorSemanticsViolations(modulePath, readSourceModuleText(modulePath)));
    expect(violations).toEqual([]);
  });

  it.each([
    'import { NavMesh } from "@recast-navigation/core";',
    'import type { TiledNavMeshGeneratorConfig } from "@recast-navigation/generators";',
    'import { GridMaterial } from "@babylonjs/materials/grid";',
    'import "@babylonjs/materials";',
    'export * from "@babylonjs/node-particle-editor";',
    'const editor = await import("@babylonjs/node-particle-editor");',
    'const recast = await import("@recast-navigation/core");',
  ])("names the module that holds %s", probeSource => {
    expect(findVendorImportViolations(probeModulePath, probeSource)).toHaveLength(1);
    expect(findVendorImportViolations(probeModulePath, probeSource)[0]).toMatch(new RegExp(`^${probeModulePath} -> `));
  });

  it("allows the same imports in the lazy inspector entry", () => {
    const probeSource = 'const recast = await import("@recast-navigation/core");\nimport "@babylonjs/materials";';
    expect(findVendorImportViolations(lazyInspectorEntryModule, probeSource)).toEqual([]);
  });

  it("does not mistake other Babylon packages for the forbidden ones", () => {
    expect(findVendorImportViolations(probeModulePath, 'import { Material } from "@babylonjs/core/Materials/material";')).toEqual([]);
    expect(findVendorImportViolations(probeModulePath, 'import "@babylonjs/materials-library";')).toEqual([]);
  });

  it.each([
    ["const emitter = new ParticleSystem(\"flame\", 64, scene);", "ParticleSystem"],
    ["const emitter = new GPUParticleSystem(\"flame\", { capacity: 64 }, scene);", "GPUParticleSystem"],
    ["const solids = new SolidParticleSystem(\"solids\", scene);", "SolidParticleSystem"],
    ["playerMesh.moveWithCollisions(displacement);", "moveWithCollisions"],
    ["groundMesh.checkCollisions = true;", "checkCollisions"],
  ])("names the line of %s", (probeSource, identifier) => {
    expect(findVendorSemanticsViolations(probeModulePath, probeSource)).toEqual([`${probeModulePath}:1 ${identifier}`]);
  });
});

describe("recast navigation dependency section", () => {
  it("is not a runtime dependency", () => {
    const runtimeRecastPackages = Object.keys(readPackageManifest().dependencies).filter(packageName => packageName.startsWith("@recast-navigation/"));
    expect(runtimeRecastPackages).toEqual([]);
  });

  it("stays pinned as a development dependency for the Editor navmesh plugin test", () => {
    const { devDependencies } = readPackageManifest();
    expect(recastPackages.map(packageName => devDependencies[packageName])).toEqual([pinnedRecastVersion, pinnedRecastVersion]);
  });
});

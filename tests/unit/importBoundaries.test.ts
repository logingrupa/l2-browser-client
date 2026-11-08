import { describe, expect, it } from "vitest";
import { staticImportClosure } from "../support/staticImportGraph";
import { listTypeScriptModules, readSourceImports } from "../support/sourceImportSpecifiers";

const worldModules = listTypeScriptModules("src/world");
const concreteAdapterModules = ["src/world/MockWorldAdapter.ts", "src/world/NativeSliceAdapter.ts"];
const presentationAndRuntimeFolders = ["src/assets/", "src/audio/", "src/effects/", "src/scene/", "src/ui/", "src/entities/", "src/camera/", "src/engine/", "src/runtime/"];

describe("src/world import boundary", () => {
  it("scans the world modules", () => {
    expect(worldModules).toContain("src/world/GameWorldAdapter.ts");
    expect(worldModules).toContain("src/world/WorldNavigation.ts");
  });

  it("has no Babylon import or export specifier, by value or by type", () => {
    const babylonImports = worldModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.specifier.startsWith("@babylonjs"))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(babylonImports).toEqual([]);
  });

  it("resolves every specifier inside src/world", () => {
    const outwardImports = worldModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.resolvedModulePath === null || !sourceImport.resolvedModulePath.startsWith("src/world/"))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(outwardImports).toEqual([]);
  });

  it("never reaches asset resolution, audio, presentation or runtime folders", () => {
    const presentationImports = worldModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => presentationAndRuntimeFolders.some(folder => sourceImport.resolvedModulePath?.startsWith(folder) === true))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(presentationImports).toEqual([]);
  });

  it.each(worldModules)("keeps the static closure of %s inside src/world with no packages", async modulePath => {
    const closure = await staticImportClosure(modulePath);
    expect([...closure.packages]).toEqual([]);
    expect([...closure.modules].filter(closureModule => !closureModule.startsWith("src/world/"))).toEqual([]);
  });
});

describe("concrete adapter importers", () => {
  it("are only the runtime and the adapter modules themselves", () => {
    const sourceModules = listTypeScriptModules("src");
    const disallowedImporters = sourceModules
      .filter(modulePath => !modulePath.startsWith("src/runtime/") && !concreteAdapterModules.includes(modulePath))
      .flatMap(modulePath => readSourceImports(modulePath)
        .filter(sourceImport => sourceImport.resolvedModulePath !== null && concreteAdapterModules.includes(sourceImport.resolvedModulePath))
        .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(disallowedImporters).toEqual([]);
  });

  it("still sees the runtime importing the native slice adapter", () => {
    const runtimeAdapterImports = listTypeScriptModules("src/runtime").flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.resolvedModulePath === "src/world/NativeSliceAdapter.ts"));
    expect(runtimeAdapterImports.length).toBeGreaterThan(0);
  });
});

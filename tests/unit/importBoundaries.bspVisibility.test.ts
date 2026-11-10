import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { staticImportClosure } from "../support/staticImportGraph";
import { listTypeScriptModules, readSourceImports } from "../support/sourceImportSpecifiers";

const visibilityCoreFolder = "src/scene/world/bspVisibility/core/";
const sharedFolder = "src/shared/";
const visibilityCoreModules = listTypeScriptModules("src/scene/world/bspVisibility/core");
const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
const typeScriptCompilerPath = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));
const languageOnlyCompilerArguments = [
  "--ignoreConfig", "--noEmit", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--target", "es2022", "--module", "esnext",
  "--moduleResolution", "bundler", "--lib", "es2022", "--types", "", "--skipLibCheck",
];
const isInsideVisibilityCoreBoundary = (modulePath: string) => modulePath.startsWith(visibilityCoreFolder) || modulePath.startsWith(sharedFolder);

describe("src/scene/world/bspVisibility/core import boundary", () => {
  it("scans every visibility core module", () => {
    expect(visibilityCoreModules).toEqual(expect.arrayContaining([
      "src/scene/world/bspVisibility/core/decodeBspVisibility.ts",
      "src/scene/world/bspVisibility/core/locateZone.ts",
      "src/scene/world/bspVisibility/core/portalWalk.ts",
      "src/scene/world/bspVisibility/core/viewFrustum.ts",
      "src/scene/world/bspVisibility/core/translucentOrder.ts",
      "src/scene/world/bspVisibility/core/tileVisibilityFrame.ts",
    ]));
  });

  it("imports only relative modules inside the visibility core and src/shared", () => {
    const outwardImports = visibilityCoreModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.resolvedModulePath === null || !isInsideVisibilityCoreBoundary(sourceImport.resolvedModulePath))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(outwardImports).toEqual([]);
  });

  it.each(visibilityCoreModules)("keeps the static closure of %s inside the visibility core and src/shared with no packages", async modulePath => {
    const closure = await staticImportClosure(modulePath);
    expect([...closure.packages]).toEqual([]);
    expect([...closure.dynamicImportTargets]).toEqual([]);
    expect([...closure.modules].filter(closureModule => !isInsideVisibilityCoreBoundary(closureModule))).toEqual([]);
  });

  it("type-checks against the ES2022 library alone, so no DOM or browser global is reachable", () => {
    const compilation = spawnSync(process.execPath, [typeScriptCompilerPath, ...languageOnlyCompilerArguments, ...visibilityCoreModules],
      { cwd: projectDirectory, encoding: "utf8" });
    expect(compilation.stdout + compilation.stderr).toBe("");
    expect(compilation.status).toBe(0);
  });
});

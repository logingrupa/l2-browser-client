import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { staticImportClosure } from "../support/staticImportGraph";
import { listTypeScriptModules, readSourceImports } from "../support/sourceImportSpecifiers";

const movementCoreFolder = "src/scene/world/movement/core/";
const sharedFolder = "src/shared/";
const movementCoreModules = listTypeScriptModules("src/scene/world/movement/core");
const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
const typeScriptCompilerPath = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));
const languageOnlyCompilerArguments = [
  "--ignoreConfig", "--noEmit", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--target", "es2022", "--module", "esnext",
  "--moduleResolution", "bundler", "--lib", "es2022", "--types", "", "--skipLibCheck",
];
const isInsideMovementCoreBoundary = (modulePath: string) => modulePath.startsWith(movementCoreFolder) || modulePath.startsWith(sharedFolder);

describe("src/scene/world/movement/core import boundary", () => {
  it("scans every movement core module", () => {
    expect(movementCoreModules).toEqual(expect.arrayContaining([
      "src/scene/world/movement/core/collisionCell.ts",
      "src/scene/world/movement/core/collisionWorld.ts",
      "src/scene/world/movement/core/decodeNativeTileCollision.ts",
      "src/scene/world/movement/core/movementRules.ts",
      "src/scene/world/movement/core/collisionTrace.ts",
      "src/scene/world/movement/core/convexHullClip.ts",
      "src/scene/world/movement/core/bspCollisionTrace.ts",
      "src/scene/world/movement/core/cylinderTrace.ts",
      "src/scene/world/movement/core/lineCheck.ts",
      "src/scene/world/movement/core/moveActor.ts",
    ]));
  });

  it("imports only relative modules inside the movement core and src/shared", () => {
    const outwardImports = movementCoreModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.resolvedModulePath === null || !isInsideMovementCoreBoundary(sourceImport.resolvedModulePath))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(outwardImports).toEqual([]);
  });

  it.each(movementCoreModules)("keeps the static closure of %s inside the movement core and src/shared with no packages", async modulePath => {
    const closure = await staticImportClosure(modulePath);
    expect([...closure.packages]).toEqual([]);
    expect([...closure.dynamicImportTargets]).toEqual([]);
    expect([...closure.modules].filter(closureModule => !isInsideMovementCoreBoundary(closureModule))).toEqual([]);
  });

  it("type-checks against the ES2022 library alone, so no DOM or browser global is reachable", () => {
    const compilation = spawnSync(process.execPath, [typeScriptCompilerPath, ...languageOnlyCompilerArguments, ...movementCoreModules],
      { cwd: projectDirectory, encoding: "utf8" });
    expect(compilation.stdout + compilation.stderr).toBe("");
    expect(compilation.status).toBe(0);
  });
});

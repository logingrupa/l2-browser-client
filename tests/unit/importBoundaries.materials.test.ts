import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { staticImportClosure } from "../support/staticImportGraph";
import { listTypeScriptModules, readSourceImports, readSourceTextImports } from "../support/sourceImportSpecifiers";

const modelModules = listTypeScriptModules("src/materials/ue2/model");
const domGlobalPattern = /(?<![\w.$-])(window|document|navigator|location|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|performance|HTMLElement|HTMLCanvasElement|globalThis|self|fetch|XMLHttpRequest|WebSocket|AudioContext)(?![\w$-])/;

function isAllowedModelTarget(resolvedModulePath: string | null): boolean {
  return resolvedModulePath !== null && (resolvedModulePath.startsWith("src/materials/ue2/model/") || resolvedModulePath.startsWith("src/shared/"));
}

function outwardModelImports(modulePath: string, sourceText?: string): string[] {
  const sourceImports = sourceText === undefined ? readSourceImports(modulePath) : readSourceTextImports(modulePath, sourceText);
  return sourceImports.filter(sourceImport => !isAllowedModelTarget(sourceImport.resolvedModulePath)).map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`);
}

describe("src/materials/ue2/model import boundary", () => {
  it("scans every model module", () => {
    expect(modelModules).toEqual(expect.arrayContaining([
      "src/materials/ue2/model/materialProgram.ts", "src/materials/ue2/model/blendTable.ts", "src/materials/ue2/model/combiner.ts",
      "src/materials/ue2/model/modifiers.ts", "src/materials/ue2/model/textureFrames.ts", "src/materials/ue2/model/fog.ts",
      "src/materials/ue2/model/displayGamma.ts", "src/materials/ue2/model/constants/materialConstants.ts",
    ]));
  });

  it("imports only itself and src/shared", () => {
    expect(modelModules.flatMap(modulePath => outwardModelImports(modulePath))).toEqual([]);
  });

  it.each(modelModules)("keeps the static closure of %s inside the model and src/shared with no packages", async modulePath => {
    const closure = await staticImportClosure(modulePath);
    expect([...closure.packages]).toEqual([]);
    expect([...closure.dynamicImportTargets]).toEqual([]);
    expect([...closure.modules].filter(closureModule => !isAllowedModelTarget(closureModule))).toEqual([]);
  });

  it("references no DOM or browser global", () => {
    const globalReferences = modelModules.flatMap(modulePath => readFileSync(new URL(`../../${modulePath}`, import.meta.url), "utf8").split("\n")
      .flatMap((line, lineIndex) => {
        const match = domGlobalPattern.exec(line);
        return match ? [`${modulePath}:${lineIndex + 1} ${match[1]}`] : [];
      }));
    expect(globalReferences).toEqual([]);
  });

  it("fails on a planted Babylon, package or outside-module import", () => {
    const plantedModule = "src/materials/ue2/model/plantedProbe.ts";
    expect(outwardModelImports(plantedModule, 'import { Scene } from "@babylonjs/core/scene";')).toEqual([`${plantedModule} -> @babylonjs/core/scene`]);
    expect(outwardModelImports(plantedModule, 'import { sourcePositionToWorld } from "../../../world/sourceFrame";')).toEqual([`${plantedModule} -> ../../../world/sourceFrame`]);
    expect(outwardModelImports(plantedModule, 'import { createRandomStream } from "../../../shared/random";')).toEqual([]);
  });
});

describe("src/world and the adapters", () => {
  it("import nothing from src/materials", () => {
    const worldModules = listTypeScriptModules("src/world");
    const materialImports = worldModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.resolvedModulePath?.startsWith("src/materials/") ?? false)
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(materialImports).toEqual([]);
  });
});

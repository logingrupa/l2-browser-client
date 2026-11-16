import { describe, expect, it } from "vitest";
import { staticImportClosure } from "../support/staticImportGraph";
import { listTypeScriptModules, readSourceImports, readSourceModuleText, readSourceTextImports } from "../support/sourceImportSpecifiers";

const modelFolder = "src/environment/model";
const modelModules = listTypeScriptModules(modelFolder);
const domGlobalPattern = /(?<![\w.$-])(window|document|navigator|location|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|performance|HTMLElement|HTMLCanvasElement|globalThis|self|fetch|XMLHttpRequest|WebSocket|AudioContext|Date)(?![\w$-])/;

function isAllowedModelTarget(resolvedModulePath: string | null): boolean {
  return resolvedModulePath !== null && (resolvedModulePath.startsWith(`${modelFolder}/`) || resolvedModulePath.startsWith("src/shared/"));
}

function outwardModelImports(modulePath: string, sourceText?: string): string[] {
  const sourceImports = sourceText === undefined ? readSourceImports(modulePath) : readSourceTextImports(modulePath, sourceText);
  return sourceImports.filter(sourceImport => !isAllowedModelTarget(sourceImport.resolvedModulePath)).map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`);
}

describe("src/environment/model import boundary", () => {
  it("scans every model module", () => {
    expect(modelModules).toEqual(expect.arrayContaining([
      `${modelFolder}/nativeTimeClock.ts`, `${modelFolder}/nativeEnvironmentManager.ts`, `${modelFolder}/calculateEnvironmentDelta.ts`,
      `${modelFolder}/sampleNativeTimeTables.ts`, `${modelFolder}/fGetHsv.ts`, `${modelFolder}/nativeEnvironmentColours.ts`, `${modelFolder}/nativeSunMoonDirection.ts`,
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

  it("references no DOM, browser or wall-clock global, so real time is always injected", () => {
    const globalReferences = modelModules.flatMap(modulePath => readSourceModuleText(modulePath).split("\n").flatMap((line, lineIndex) => {
      const match = domGlobalPattern.exec(line);
      return match ? [`${modulePath}:${lineIndex + 1} ${match[1]}`] : [];
    }));
    expect(globalReferences).toEqual([]);
  });

  it("fails on a planted Babylon or outside-module import", () => {
    const plantedModule = `${modelFolder}/plantedProbe.ts`;
    expect(outwardModelImports(plantedModule, 'import { Scene } from "@babylonjs/core/scene";')).toEqual([`${plantedModule} -> @babylonjs/core/scene`]);
    expect(outwardModelImports(plantedModule, 'import { presentationClock } from "../../shared/presentationClock";')).toEqual([]);
    expect(outwardModelImports(plantedModule, 'import { createWorldEnvironmentClock } from "../../scene/world/lighting/worldEnvironmentClock";'))
      .toEqual([`${plantedModule} -> ../../scene/world/lighting/worldEnvironmentClock`]);
  });
});

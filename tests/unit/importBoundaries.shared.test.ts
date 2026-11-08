import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { staticImportClosure } from "../support/staticImportGraph";
import { listTypeScriptModules, readSourceImports } from "../support/sourceImportSpecifiers";

const sharedModules = listTypeScriptModules("src/shared");
const domGlobalPattern = /\b(window|document|navigator|location|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|performance|HTMLElement|HTMLCanvasElement|globalThis|self|fetch|XMLHttpRequest|WebSocket|AudioContext)\b/;

describe("src/shared import boundary", () => {
  it("scans every shared module", () => {
    expect(sharedModules).toEqual(expect.arrayContaining([
      "src/shared/typedPayload.ts", "src/shared/random.ts", "src/shared/presentationClock.ts", "src/shared/fixedStep.ts",
      "src/shared/math/vector3.ts", "src/shared/math/affineMatrix.ts", "src/shared/math/plane.ts", "src/shared/math/rotator.ts",
    ]));
  });

  it("imports only relative modules inside src/shared", () => {
    const outwardImports = sharedModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.resolvedModulePath === null || !sourceImport.resolvedModulePath.startsWith("src/shared/"))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(outwardImports).toEqual([]);
  });

  it.each(sharedModules)("keeps the static closure of %s inside src/shared with no packages", async modulePath => {
    const closure = await staticImportClosure(modulePath);
    expect([...closure.packages]).toEqual([]);
    expect([...closure.dynamicImportTargets]).toEqual([]);
    expect([...closure.modules].filter(closureModule => !closureModule.startsWith("src/shared/"))).toEqual([]);
  });

  it("references no DOM or browser global", () => {
    const globalReferences = sharedModules.flatMap(modulePath => readFileSync(new URL(`../../${modulePath}`, import.meta.url), "utf8").split("\n")
      .flatMap((line, lineIndex) => {
        const match = domGlobalPattern.exec(line);
        return match ? [`${modulePath}:${lineIndex + 1} ${match[1]}`] : [];
      }));
    expect(globalReferences).toEqual([]);
  });
});

describe("src/world/sourceFrame.ts", () => {
  it("imports nothing", () => {
    expect(readSourceImports("src/world/sourceFrame.ts")).toEqual([]);
  });
});

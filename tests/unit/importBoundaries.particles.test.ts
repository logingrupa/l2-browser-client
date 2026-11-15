import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { staticImportClosure } from "../support/staticImportGraph";
import { listTypeScriptModules, readSourceImports } from "../support/sourceImportSpecifiers";

const schedulerModule = "src/effects/particles/effectScheduler.ts";
const particleCoreModules = [...listTypeScriptModules("src/effects/particles/sim"), schedulerModule];
const isInsideParticleCore = (modulePath: string) => modulePath.startsWith("src/effects/particles/sim/") || modulePath === schedulerModule;
const isAllowedModule = (modulePath: string) => isInsideParticleCore(modulePath) || modulePath.startsWith("src/shared/");
const hostGlobals = [
  "window", "document", "navigator", "location", "localStorage", "sessionStorage", "requestAnimationFrame", "cancelAnimationFrame", "performance",
  "HTMLElement", "HTMLCanvasElement", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "AudioContext", "process", "Buffer", "require",
];
const hostGlobalMarker = "particle_core_host_global_";

describe("particle simulator import boundary", () => {
  it("scans every simulator module and the scheduler", () => {
    expect(particleCoreModules).toEqual(expect.arrayContaining([
      "src/effects/particles/sim/emitterRecords.ts", "src/effects/particles/sim/particleState.ts", "src/effects/particles/sim/spriteEmitter.ts",
      "src/effects/particles/sim/meshEmitter.ts", "src/effects/particles/sim/emitterActor.ts", "src/effects/particles/sim/emitterConstants.ts",
      schedulerModule,
    ]));
  });

  it("imports only relative modules inside the simulator or src/shared", () => {
    const outwardImports = particleCoreModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => sourceImport.resolvedModulePath === null || !isAllowedModule(sourceImport.resolvedModulePath))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(outwardImports).toEqual([]);
  });

  it.each(particleCoreModules)("keeps the static closure of %s free of packages, dynamic imports and outside modules", async modulePath => {
    const closure = await staticImportClosure(modulePath);
    expect([...closure.packages]).toEqual([]);
    expect([...closure.dynamicImportTargets]).toEqual([]);
    expect([...closure.modules].filter(closureModule => !isAllowedModule(closureModule))).toEqual([]);
  });

  async function hostGlobalReferences(buildInput: { entryPoints: string[] } | { stdin: { contents: string; loader: "ts" } }): Promise<string[]> {
    const result = await build({
      ...buildInput, absWorkingDir: fileURLToPath(new URL("../../", import.meta.url)), bundle: true, write: false,
      outdir: "particle-core-boundary", platform: "neutral", format: "esm", target: "es2022", logLevel: "silent",
      define: Object.fromEntries(hostGlobals.map(name => [name, `${hostGlobalMarker}${name}`])),
    });
    return result.outputFiles.flatMap(outputFile => [...outputFile.text.matchAll(new RegExp(`${hostGlobalMarker}([A-Za-z]+)`, "g"))].map(match => match[1]!));
  }

  it("detects a free host global and ignores locals and properties of the same name", async () => {
    const probe = "export const free = () => location.href; export const local = (location: { x: number }) => location.x; export const owner = { location: 1 }.location;";
    expect(await hostGlobalReferences({ stdin: { contents: probe, loader: "ts" } })).toEqual(["location"]);
  });

  it("references no DOM or Node global as a free identifier", async () => {
    expect(await hostGlobalReferences({ entryPoints: particleCoreModules })).toEqual([]);
  });
});

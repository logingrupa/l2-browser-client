import { fileURLToPath } from "node:url";
import { build, type Metafile } from "esbuild";

export interface StaticImportClosure {
  modules: ReadonlySet<string>;
  packages: ReadonlySet<string>;
  dynamicImportTargets: ReadonlySet<string>;
}

const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));

export async function staticImportClosure(entryPoint: string): Promise<StaticImportClosure> {
  const result = await build({
    entryPoints: [entryPoint],
    absWorkingDir: projectDirectory,
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    platform: "browser",
    format: "esm",
    target: "es2022",
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  return walkStaticImports(result.metafile, entryPoint);
}

function walkStaticImports(metafile: Metafile, entryPoint: string): StaticImportClosure {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const dynamicImportTargets = new Set<string>();
  const pendingModules = [entryPoint];
  while (pendingModules.length > 0) {
    const modulePath = pendingModules.pop()!;
    if (modules.has(modulePath)) continue;
    const input = metafile.inputs[modulePath];
    if (input === undefined) throw new Error(`Static import graph has no input for ${modulePath}`);
    modules.add(modulePath);
    for (const importRecord of input.imports) {
      if (importRecord.kind === "dynamic-import") {
        dynamicImportTargets.add(importRecord.path);
      } else if (importRecord.kind !== "import-statement") {
        continue;
      } else if (importRecord.external === true) {
        packages.add(importRecord.path);
      } else {
        pendingModules.push(importRecord.path);
      }
    }
  }
  return { modules, packages, dynamicImportTargets };
}

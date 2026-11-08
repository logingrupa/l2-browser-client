import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface SourceImport {
  readonly specifier: string;
  readonly resolvedModulePath: string | null;
}

const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
const staticSpecifierPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
const dynamicSpecifierPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

export function listTypeScriptModules(projectFolder: string): string[] {
  return readdirSync(path.join(projectDirectory, projectFolder), { recursive: true, encoding: "utf8" })
    .filter(relativePath => relativePath.endsWith(".ts"))
    .map(relativePath => path.posix.join(projectFolder, relativePath.split(path.sep).join("/")))
    .sort();
}

export function readSourceImports(modulePath: string): SourceImport[] {
  const sourceText = readFileSync(path.join(projectDirectory, modulePath), "utf8");
  const specifiers = [...sourceText.matchAll(staticSpecifierPattern), ...sourceText.matchAll(dynamicSpecifierPattern)]
    .map(match => match[1]!);
  return specifiers.map(specifier => ({ specifier, resolvedModulePath: resolveRelativeSpecifier(modulePath, specifier) }));
}

function resolveRelativeSpecifier(modulePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const joinedPath = path.posix.normalize(path.posix.join(path.posix.dirname(modulePath), specifier));
  const candidatePaths = [joinedPath, `${joinedPath}.ts`, `${joinedPath}/index.ts`];
  const existingPath = candidatePaths.find(candidatePath => candidatePath.endsWith(".ts") && existsSync(path.join(projectDirectory, candidatePath)));
  return existingPath ?? joinedPath;
}

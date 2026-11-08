import { beforeAll, describe, expect, it } from "vitest";
import { staticImportClosure, type StaticImportClosure } from "../support/staticImportGraph";

const editorPackagePrefixes = ["babylonjs-editor-tools", "babylonjs-editor-cli", "l2-editor-webgpu-compat"];
const inspectorPackagePrefixes = ["@babylonjs/inspector", "react", "react-dom", "@fluentui/", "@fluentui-contrib/"];
const inspectorModulePath = "src/scene/openBabylonInspector.ts";
const editorModulePaths = ["src/scripts.ts", "src/scene/world/loadAuthoredNativeSection.ts", "src/scene/authoredNativeWorld.ts"];
const editorModuleFolders = ["src/scripts/", "src/editor/"];

describe("default entry static import graph", () => {
  let defaultEntryClosure: StaticImportClosure;
  beforeAll(async () => {
    defaultEntryClosure = await staticImportClosure("src/main.ts");
  });

  it("reaches the code-built scene modules", () => {
    expect(defaultEntryClosure.modules).toContain("src/main.ts");
    expect(defaultEntryClosure.modules).toContain("src/scene/loadEnvironment.ts");
  });

  it("imports no Editor package", () => {
    const editorPackages = [...defaultEntryClosure.packages].filter(packagePath =>
      editorPackagePrefixes.some(prefix => packagePath === prefix || packagePath.startsWith(`${prefix}/`)));
    expect(editorPackages).toEqual([]);
  });

  it("imports no Editor-generated scripts, Editor capture modules or authored world modules", () => {
    const editorModules = [...defaultEntryClosure.modules].filter(modulePath =>
      editorModulePaths.includes(modulePath) || editorModuleFolders.some(folder => modulePath.startsWith(folder)));
    expect(editorModules).toEqual([]);
  });

  it("reaches the authored native world only through a dynamic import", () => {
    expect(defaultEntryClosure.dynamicImportTargets).toContain("src/scene/authoredNativeWorld.ts");
  });

  it("reaches the Babylon Inspector only through a dynamic import", () => {
    expect(defaultEntryClosure.dynamicImportTargets).toContain(inspectorModulePath);
    expect(defaultEntryClosure.modules).not.toContain(inspectorModulePath);
    const inspectorPackages = [...defaultEntryClosure.packages].filter(packagePath =>
      inspectorPackagePrefixes.some(prefix => prefix.endsWith("/") ? packagePath.startsWith(prefix) : packagePath === prefix || packagePath.startsWith(`${prefix}/`)));
    expect(inspectorPackages).toEqual([]);
  });
});

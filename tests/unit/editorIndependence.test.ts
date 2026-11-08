import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import defaultVitestConfiguration from "../../vitest.config";
import editorVitestConfiguration from "../../vitest.editor.config";

const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
const readProjectFile = (relativePath: string): string => readFileSync(`${projectDirectory}${relativePath}`, "utf8");
const packageScripts = (JSON.parse(readProjectFile("package.json")) as { scripts: Record<string, string> }).scripts;
const editorBuildSteps = [
  "babylonjs-editor-cli", "ensure-webgpu-project", "validate-editor-materials", "preserve-native-editor-uv2",
  "preserve-native-editor-fog", "share-native-terrain-export-materials", "generate:editor",
];
const optionalEditorScripts = ["generate:editor", "assets:editor"];
const editorReferenceMarkers = ["babylonjs-editor-tools", "babylonjs-editor-cli", "l2-editor-webgpu-compat", "src/scripts\"", "src/editor/", "authoredNativeWorld"];
const editorGuardTestFiles = ["editorIndependence.test.ts", "defaultEntryImportGraph.test.ts"];

describe("Editor independence of the default build and process", () => {
  it.each(["dev", "build"])("runs %s with the WebGPU compiler staging and no Editor step", scriptName => {
    const command = packageScripts[scriptName] ?? "";
    expect(command).toContain("stage-webgpu-compilers");
    expect(editorBuildSteps.filter(step => command.includes(step))).toEqual([]);
  });

  it("keeps the Editor steps available as optional scripts beside the Editor project", () => {
    expect(packageScripts["generate:editor"]).toContain("babylonjs-editor-cli pack");
    expect(packageScripts["assets:editor"]).toBeDefined();
    expect(existsSync(`${projectDirectory}project.bjseditor`)).toBe(true);
  });

  it.each([".planning/lanes.json", "STATUS.md"])("keeps %s free of the optional Editor scripts", processFile => {
    const contents = readProjectFile(processFile);
    expect(optionalEditorScripts.filter(scriptName => contents.includes(scriptName))).toEqual([]);
  });

  it("runs the Editor-path tests only under test:editor", () => {
    expect(packageScripts["test:editor"]).toBe("vitest run --config vitest.editor.config.ts");
    expect(defaultVitestConfiguration.test?.include).toEqual(["tests/unit/**/*.test.ts"]);
    expect(editorVitestConfiguration.test?.include).toEqual(["tests/editor/**/*.test.ts"]);
  });

  it("keeps every default unit test free of Editor packages and Editor-generated scripts", () => {
    const unitTestDirectory = `${projectDirectory}tests/unit/`;
    const unitTestsReferencingEditor = readdirSync(unitTestDirectory, { recursive: true, encoding: "utf8" })
      .filter(relativePath => relativePath.endsWith(".ts") && !editorGuardTestFiles.includes(relativePath))
      .filter(relativePath => {
        const contents = readFileSync(`${unitTestDirectory}${relativePath}`, "utf8");
        return editorReferenceMarkers.some(marker => contents.includes(marker));
      });
    expect(unitTestsReferencingEditor).toEqual([]);
  });
});

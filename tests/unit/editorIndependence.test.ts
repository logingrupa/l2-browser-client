import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
const readProjectFile = (relativePath: string): string => readFileSync(`${projectDirectory}${relativePath}`, "utf8");
const packageScripts = (JSON.parse(readProjectFile("package.json")) as { scripts: Record<string, string> }).scripts;
const editorBuildSteps = [
  "babylonjs-editor-cli", "ensure-webgpu-project", "validate-editor-materials", "preserve-native-editor-uv2",
  "preserve-native-editor-fog", "share-native-terrain-export-materials", "generate:editor",
];
const optionalEditorScripts = ["generate:editor", "assets:editor"];

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
});

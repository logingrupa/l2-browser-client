// Compiler settings adapted from BabylonJS/Editor v5.5.3 (Apache-2.0).
// https://github.com/BabylonJS/Editor/blob/v5.5.3/editor/src/tools/compile.ts
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { expect, it } from "vitest";

/**
 * Emulates the official v5.5.3 editor/src/tools/compile.ts contract.
 * This checks bundle compatibility, not desktop Editor execution.
 */
it("compiles the scene script using the Editor CJS contract without CSS or font outputs", async () => {
  const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
  const replaceImports: Plugin = {
    name: "replaceImports",
    setup(builder) {
      builder.onLoad({ filter: /.*/ }, async ({ path }) => ({
        loader: "default",
        contents: (await readFile(path, "utf8"))
          .replace(/"@babylonjs\/core\/?.*"/g, '"babylonjs"')
          .replace(/"@babylonjs\/gui\/?.*"/g, '"babylonjs-gui"')
          .replace(/"@babylonjs\/loaders\/?.*"/g, '"babylonjs-loaders"')
          .replace(/"@babylonjs\/materials\/?.*"/g, '"babylonjs-materials"')
          .replace(/"@babylonjs\/post-processes\/?.*"/g, '"babylonjs-post-process"')
          .replace(/"@babylonjs\/procedural-textures\/?.*"/g, '"babylonjs-procedural-textures"')
          .replace(/"@babylonjs\/addons\/?.*"/g, '"babylonjs-addons"')
          .replace(/import\.meta\.dirname/g, "__dirname")
          .replace(/import\("/g, 'require("'),
      }));
    },
  };

  const result = await build({
    entryPoints: [join(projectDirectory, "src/scripts.ts")],
    outfile: join(projectDirectory, ".bjseditor/play/script.cjs"),
    write: false,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    treeShaking: true,
    sourcemap: true,
    keepNames: true,
    loader: { ".ts": "ts", ".tsx": "tsx", ".node": "file" },
    // The Editor overrides these modules. Its runtime tools must be bundled.
    external: [
      "sharp", "electron", "babylonjs-editor", "babylonjs", "babylonjs-gui",
      "babylonjs-loaders", "babylonjs-materials", "babylonjs-post-process",
      "babylonjs-procedural-textures", "babylonjs-addons",
      "@recast-navigation/core", "@recast-navigation/generators",
    ],
    plugins: [replaceImports],
    supported: { decorators: true },
    tsconfig: join(projectDirectory, "tsconfig.json"),
  });

  expect(result.warnings).toEqual([]);
  expect(result.outputFiles.map(file => basename(file.path)).sort()).toEqual(["script.cjs", "script.cjs.map"]);
  const script = result.outputFiles.find(file => file.path.endsWith("script.cjs"))?.text;
  expect(script).toContain("WorldScript");
  expect(script).toContain("scripts/world.ts");
  expect(script).toContain("module.exports");
});

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { expect, it } from "vitest";

const editorCompileContractSource = "BabylonJS/Editor v5.5.3 editor/src/tools/compile.ts (Apache-2.0), https://github.com/BabylonJS/Editor/blob/v5.5.3/editor/src/tools/compile.ts";

const editorProvidedModules = [
  "sharp", "electron", "babylonjs-editor", "babylonjs", "babylonjs-gui",
  "babylonjs-loaders", "babylonjs-materials", "babylonjs-post-process",
  "babylonjs-procedural-textures", "babylonjs-addons",
  "@recast-navigation/core", "@recast-navigation/generators",
];

it("bundles the browser plugins the desktop Editor adds to a regenerated src/scripts.ts without unresolved external dependencies", async () => {
  const result = await build({
    stdin: {
      contents: [
        'import "babylonjs-editor-tools/loading/gaussian-splatting";',
        'import "babylonjs-editor-tools/loading/script/preload/plugins/gui";',
        'import "babylonjs-editor-tools/loading/script/preload/plugins/navmesh";',
      ].join("\n"),
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    },
    bundle: true, platform: "browser", format: "esm", target: "es2022",
    write: false, metafile: true,
  });
  expect(Object.keys(result.metafile!.inputs).some(path => path.endsWith("/plugins/navmesh.js"))).toBe(true);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports).filter(item => item.external)).toEqual([]);
});

it(`compiles the scene script with the CJS bundle contract of ${editorCompileContractSource}, without CSS or font outputs`, async () => {
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
    external: editorProvidedModules,
    plugins: [replaceImports],
    supported: { decorators: true },
    tsconfig: join(projectDirectory, "tsconfig.json"),
  });

  expect(result.warnings).toEqual([]);
  expect(result.outputFiles.map(file => basename(file.path)).sort()).toEqual(["script.cjs", "script.cjs.map"]);
  const script = result.outputFiles.find(file => file.path.endsWith("script.cjs"))?.text;
  expect(script).toContain("NativeParityScript");
  expect(script).toContain("scripts/nativeParity.ts");
  expect(script).not.toContain("scripts/world.ts");
  expect(script).toContain("module.exports");
});

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Serve the compilers shipped with our pinned Babylon version from the same origin. */
export async function stageWebGPUCompilers() {
  const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const coreRoot = dirname(require.resolve("@babylonjs/core/package.json"));
  const core = JSON.parse(await readFile(resolve(coreRoot, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(core.version) || project.dependencies?.["@babylonjs/core"] !== core.version) {
    throw new Error("WebGPU compiler staging requires an exact installed @babylonjs/core version matching package.json.");
  }
  const publicPath = `/vendor/babylon/${core.version}/`;
  const directory = resolve(root, "public", `.${publicPath}`);
  await mkdir(directory, { recursive: true });
  const files = new Map();
  for (const compiler of ["glslang", "twgsl"]) for (const extension of ["js", "wasm"]) {
    const filename = `${compiler}.${extension}`;
    const bytes = await readFile(resolve(coreRoot, "assets", compiler, filename));
    const target = resolve(directory, filename);
    let previous;
    try { previous = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!previous?.equals(bytes)) await writeFile(target, bytes);
    files.set(publicPath + filename, { path: target, contentType: extension === "js" ? "text/javascript" : "application/wasm" });
  }
  return { version: core.version, publicPath, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await stageWebGPUCompilers();
  console.log(`WebGPU compilers ready at ${result.publicPath}`);
}

/** Reusable local native-world authoring import. No native binaries are executed. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { stageWebGPUCompilers } from "./stage-webgpu-compilers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "artifacts/native-parity/editor/world-import");
const snapshotPath = resolve(output, "captured-world.json");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !["--snapshot-only", "--from-snapshot"].includes(flag))) throw new Error("Usage: pnpm assets:editor [--snapshot-only | --from-snapshot]");
await mkdir(output, { recursive: true });
let snapshot;
if (flags.has("--from-snapshot")) snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
else {
  const compilers = await stageWebGPUCompilers();
  const pngRoot = resolve(root, "node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs");
  const pngPackage = JSON.parse(await readFile(resolve(pngRoot, "package.json"), "utf8"));
  if (pngPackage.name !== "pngjs" || pngPackage.version !== "7.0.0") throw new Error("Pinned pngjs 7.0.0 is required.");
  const { PNG } = createRequire(import.meta.url)(pngRoot);
  const built = await build({ stdin: { contents: 'import {captureNativeWorld} from "./src/editor/captureNativeWorld"; window.captureNativeWorld=captureNativeWorld;',
    resolveDir: root }, bundle: true, platform: "browser", format: "esm", target: "es2022", write: false, logLevel: "warning" });
  const bundle = built.outputFiles[0].contents;
  const publicRoot = await realpath(resolve(root, "public"));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1"), path = decodeURIComponent(url.pathname);
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      if (path === "/capture.html") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><canvas id="world" width="800" height="600"></canvas><script type="module" src="/capture.mjs"></script>'); return; }
      if (path === "/capture.mjs") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle); return; }
      const compiler = compilers.files.get(path);
      if (compiler) { response.setHeader("Content-Type", compiler.contentType); response.end(await readFile(compiler.path)); return; }
      if (!path.startsWith("/l2/") || path.includes("\\") || path.includes("\0")) { response.writeHead(404).end(); return; }
      const target = await realpath(resolve(publicRoot, `.${path}`));
      if (!target.startsWith(publicRoot + sep)) throw new Error("Resource escapes public root.");
      response.setHeader("Content-Type", ({ ".json": "application/json", ".png": "image/png", ".glb": "model/gltf-binary" })[extname(target)] ?? "application/octet-stream");
      response.end(await readFile(target));
    } catch { response.writeHead(404).end("Unavailable native resource."); }
  });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  let browser;
  const messages = [], textureEvidence = [];
  try {
    browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--enable-unsafe-swiftshader", "--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"] });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    page.on("pageerror", error => messages.push({ type: "pageerror", message: String(error) }));
    page.on("console", message => { if (message.type() === "error") messages.push({ type: "console", message: message.text() }); });
    await page.exposeFunction("encodeNativeEditorTexture", async input => {
      if (!/^[a-f0-9]{64}$/.test(input.manifestSha256) || !["png", "rgba"].includes(input.kind) ||
        !Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 4096 || input.height > 4096) throw new Error("Invalid authoring texture request.");
      const original = Buffer.from(input.base64, "base64");
      const bytes = input.kind === "png" ? original : PNG.sync.write({ width: input.width, height: input.height, data: original }, { colorType: 6, inputColorType: 6, bitDepth: 8 });
      const decoded = PNG.sync.read(bytes, { checkCRC: true });
      if (decoded.width !== input.width || decoded.height !== input.height || decoded.data.length !== input.width * input.height * 4 ||
        input.kind === "rgba" && !decoded.data.equals(original)) throw new Error("PNG authoring derivative changed pixel bytes.");
      const hash = sha(bytes), path = `assets/native-generated/${input.manifestSha256}/${hash}.png`;
      textureEvidence.push({ name: input.name, path, width: input.width, height: input.height, kind: input.kind,
        sha256: hash, rgbaSha256: sha(decoded.data), sourceBytesUnchanged: input.kind === "png", rawPixelsUnchanged: input.kind === "rgba" });
      return { path, sha256: hash, bytes: bytes.length, base64: bytes.toString("base64") };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/capture.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.captureNativeWorld === "function");
    console.log("Loading verified world and capturing editable geometry/materials...");
    snapshot = await page.evaluate(() => window.captureNativeWorld(document.getElementById("world"), window.encodeNativeEditorTexture));
    if (messages.length) throw new Error(`Authoring export browser errors: ${JSON.stringify(messages)}`);
    snapshot.textureEvidence = textureEvidence;
    snapshot.tools = { babylon: "9.27.1", editor: "5.5.3", pngjs: pngPackage.version, captureImplementationSha256: sha(await readFile(resolve(root, "src/editor/captureNativeWorld.ts"))),
      commandImplementationSha256: sha(await readFile(fileURLToPath(import.meta.url))), lockfileSha256: sha(await readFile(resolve(root, "pnpm-lock.yaml"))) };
    await writeFile(snapshotPath, JSON.stringify(snapshot));
    console.log(`Captured ${snapshot.nodes.length} transform nodes, ${snapshot.meshes.length} mesh records, ${snapshot.textures.length} PNG resources.`);
  } finally {
    await browser?.close();
    await new Promise(accept => server.close(accept));
    await writeFile(resolve(output, "capture-diagnostics.json"), JSON.stringify({ messages, textureEvidence }, null, 2) + "\n");
  }
}
if (!flags.has("--snapshot-only")) {
  const { writeNativeEditorScene } = await import("./native_editor_scene.mjs");
  console.log(JSON.stringify(await writeNativeEditorScene({ projectRoot: root, snapshot }), null, 2));
}

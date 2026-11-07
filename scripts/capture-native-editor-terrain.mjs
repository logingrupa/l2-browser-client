import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { stageWebGPUCompilers } from './stage-webgpu-compilers.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--manifest', '--base', '--output'].includes(key) || !value || Object.hasOwn(options, key)) throw Error('Use --manifest <new manifest> --base <old manifest SHA256> --output <new snapshot>');
  options[key] = value;
}
if (!options['--manifest'] || !/^[a-f0-9]{64}$/.test(options['--base'] ?? '') || !options['--output']) throw Error('Incomplete capture arguments.');
const root = await realpath(process.cwd()), manifestPath = await realpath(resolve(root, options['--manifest']));
const output = resolve(root, options['--output']), sha = data => createHash('sha256').update(data).digest('hex');
if (!manifestPath.startsWith(root + sep) || !output.startsWith(root + sep)) throw Error('Capture paths must remain in the project.');
const manifestBytes = await readFile(manifestPath), manifest = JSON.parse(manifestBytes);
if (manifest.kind !== 'native-map-section-runtime' || !Array.isArray(manifest.terrainPatches) || manifest.terrainPatches.length !== 1) throw Error('Missing bounded terrain patch.');
const patch = manifest.terrainPatches[0];
const terrainRoot = await realpath(resolve(dirname(manifestPath), manifest.resourceRoots.terrain));
if (!terrainRoot.startsWith(dirname(dirname(manifestPath)) + sep)) throw Error('Terrain root escapes source bundle.');
const modelPath = await realpath(resolve(terrainRoot, patch.model.file)), sourcePath = await realpath(resolve(terrainRoot, patch.source.file));
if (!modelPath.startsWith(terrainRoot + sep) || !sourcePath.startsWith(terrainRoot + sep)) throw Error('Patch resources escape source root.');
const bytes = await readFile(modelPath), sourceBytes = await readFile(sourcePath);
if (sha(bytes) !== patch.model.sha256 || bytes.length !== patch.model.bytes || sha(sourceBytes) !== patch.source.sha256 || sourceBytes.length !== patch.source.bytes) throw Error('Patch resources differ from manifest.');
const compilers = await stageWebGPUCompilers();
const compiled = await build({ stdin: { contents: 'import{captureNativeTerrain}from"./src/editor/captureNativeTerrain";window.captureNativeTerrain=captureNativeTerrain;', resolveDir: root },
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, logLevel: 'warning' });
const browser = await chromium.launch({ channel: 'chromium', headless: true }), errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/vendor/babylon/**', async route => {
    const compiler = compilers.files.get(new URL(route.request().url()).pathname);
    if (!compiler || route.request().method() !== 'GET') { await route.fulfill({ status: 404, body: 'Unknown compiler resource.' }); return; }
    await route.fulfill({ contentType: compiler.contentType, body: await readFile(compiler.path) });
  });
  await page.route('**/__native-terrain-capture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="capture" width="800" height="600"></canvas>' }));
  await page.goto('http://127.0.0.1:5184/__native-terrain-capture__');
  await page.addScriptTag({ type: 'module', content: compiled.outputFiles[0].text });
  await page.waitForFunction(() => typeof window.captureNativeTerrain === 'function');
  const snapshot = await page.evaluate(input => window.captureNativeTerrain(document.getElementById('capture'), input),
    { baseManifestSha256: options['--base'], nativeTerrainPatch: patch, modelBase64: bytes.toString('base64') });
  if (errors.length) throw Error(`Terrain capture errors: ${JSON.stringify(errors)}`);
  snapshot.capture = { ...snapshot.capture, nextManifestSha256: sha(manifestBytes),
    implementationSha256: sha(await readFile(resolve(root, 'src/editor/captureNativeTerrain.ts'))),
    commandSha256: sha(await readFile(resolve(root, 'scripts/capture-native-editor-terrain.mjs'))) };
  const encoded = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, encoded, { flag: 'wx' });
  console.log(JSON.stringify({ path: output, bytes: encoded.length, sha256: sha(encoded), errors }));
} finally { await browser.close(); }

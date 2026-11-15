/** Inspect decoded PNG channels without premultiplication, gamma correction,
 * resizing, channel selection or pixel edits. Uses the existing lockfile pin. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pngRoot = resolve(project, "node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs");
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(resolve(pngRoot, "package.json"), "utf8"));
if (manifest.name !== "pngjs" || manifest.version !== "7.0.0") throw new Error("Pinned pngjs 7.0.0 is required.");
const { PNG } = require(pngRoot);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export function inspectPNG(bytes) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid PNG signature.");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw new Error("PNG dimensions exceed the bounded terrain case.");
  if (bytes[24] !== 8) throw new Error("Channel audit accepts source PNG bit depth 8 only; no precision reduction.");
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) throw new Error("Decoded PNG dimensions differ.");
  const channels = {}, pixels = width * height;
  for (const [index, name] of ["R", "G", "B", "A"].entries()) {
    const values = Buffer.allocUnsafe(pixels), histogram = Array(256).fill(0);
    for (let pixel = 0; pixel < pixels; pixel++) { const value = decoded.data[pixel * 4 + index]; values[pixel] = value; histogram[value]++; }
    const used = histogram.flatMap((count, value) => count ? [value] : []);
    channels[name] = { sha256: sha(values), bytes: pixels, min: used[0], max: used.at(-1), distinctValues: used.length, histogram };
  }
  let rgbDifferentPixels = 0, transparentNonzeroRGBPixels = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 4, r = decoded.data[offset], g = decoded.data[offset + 1], b = decoded.data[offset + 2], a = decoded.data[offset + 3];
    if (r !== g || r !== b) rgbDifferentPixels++;
    if (a === 0 && (r || g || b)) transparentNonzeroRGBPixels++;
  }
  return { width, height, pngBytes: bytes.length, pngSha256: sha(bytes), sourceBitDepth: bytes[24], sourceColorType: bytes[25],
    rgbaBytes: decoded.data.length, rgbaSha256: sha(decoded.data), channels, rgbDifferentPixels, transparentNonzeroRGBPixels,
    decoding: { package: "pngjs", version: "7.0.0", output: "row-major RGBA8; source row order", gammaCorrectionApplied: false,
      premultiplied: false, channelSelected: null, sourceGamma: decoded.gamma ?? null } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requests = JSON.parse(readFileSync(0, "utf8"));
  if (!Array.isArray(requests) || requests.length > 64) throw new Error("Expected at most 64 PNG audit requests.");
  process.stdout.write(JSON.stringify({ schemaVersion: 1, tool: { name: manifest.name, version: manifest.version,
    implementationSha256: sha(readFileSync(fileURLToPath(import.meta.url))), lockfileSha256: sha(readFileSync(resolve(project, "pnpm-lock.yaml"))),
    decoderFiles: Object.fromEntries(["png.js", "png-sync.js", "parser-sync.js", "parser.js", "bitmapper.js", "format-normaliser.js"].map(name => [name, sha(readFileSync(resolve(pngRoot, "lib", name)))])) },
    results: requests.map(({ id, file }) => ({ id, ...inspectPNG(readFileSync(file)) })) }));
}

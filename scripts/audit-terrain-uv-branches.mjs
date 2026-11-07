/** Read pinned source masks; write only isolated UV sensitivity evidence.
 * No native process, source conversion, GPU, material edit or performance test. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = resolve(project, "artifacts/native-parity/research/terrain-uv-reference-20261106/source-mask-comparison");
const auditPath = "artifacts/native-parity/research/terrain-browser-20261106/terrain-uv-inputs-v2.json";
const auditSha = "cd6e8fb6f0fe5b14b9a7f94e17d19bb7697494f28365348191cd5e9d905781dc";
const catalogPath = "public/l2/catalog.json";
const catalogSha = "badd513db9a6226615a78ad7b3c58733aff5eed7cac412991c4b469b5b55a5fb";
const [minX, maxX, minY, maxY, terrainSize, samplesPerGrid] = [64, 112, 208, 255, 256, 4];
const outputWidth = (maxX - minX) * samplesPerGrid + 1;
const outputHeight = (maxY - minY) * samplesPerGrid + 1;
const pointCount = outputWidth * outputHeight;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(import.meta.url);
const pngRoot = resolve(project, "node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs");
const pngManifest = JSON.parse(readFileSync(resolve(pngRoot, "package.json"), "utf8"));
if (pngManifest.name !== "pngjs" || pngManifest.version !== "7.0.0") throw new Error("Pinned pngjs 7.0.0 is required.");
const { PNG } = require(pngRoot);
const assert = (condition, detail) => { if (!condition) throw new Error(detail); };
const posix = path => relative(project, path).split(sep).join("/");

function contained(root, path) {
  const value = resolve(root, path), rel = relative(root, value);
  assert(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `Path escapes scope: ${path}`);
  return value;
}
function read(path, expected = undefined) {
  const target = contained(project, path), physical = realpathSync(target);
  contained(project, physical);
  const size = statSync(physical).size;
  assert(size <= 64 * 1024 * 1024, `Input exceeds 64 MiB: ${path}`);
  const bytes = readFileSync(physical), hash = sha(bytes);
  if (expected) {
    assert(hash === expected.sha256, `Input hash differs: ${path}`);
    if (expected.bytes !== undefined) assert(bytes.length === expected.bytes, `Input size differs: ${path}`);
  }
  return { bytes, identity: { path: posix(target), bytes: bytes.length, sha256: hash } };
}
function verifiedJson(path, expected) {
  const input = read(path, expected);
  return { ...input, value: JSON.parse(input.bytes.toString("utf8").replace(/^\uFEFF/, "")) };
}

function verifyGeometry(audit) {
  const geometryInputs = Object.fromEntries(["recipe", "rawMapManifest", "terrain", "geometryManifest", "runtimeManifest", "gltf", "buffer", "glb"].map(key => {
    const pin = audit.inputs[key];
    assert(pin && typeof pin.path === "string", `Missing input pin: ${key}`);
    return [key, read(pin.path, pin)];
  }));
  const heightPin = audit.nativeHeightmap.retainedHeightPayload;
  geometryInputs.heightPayload = read(heightPin.path, heightPin);
  assert(audit.nativeHeightmap.width === terrainSize && audit.nativeHeightmap.height === terrainSize, "Heightmap dimensions changed.");
  const bounds = audit.selectedGeometry.vertexGridBoundsInclusive;
  assert(JSON.stringify(bounds) === JSON.stringify({ min: [minX, minY], max: [maxX, maxY] }), "Selected grid bounds changed.");
  const gltf = JSON.parse(geometryInputs.gltf.bytes), data = geometryInputs.buffer.bytes;
  assert(gltf.buffers.length === 1 && gltf.buffers[0].uri === "terrain.bin" && gltf.buffers[0].byteLength === data.length, "Terrain buffer declaration differs.");
  const primitive = gltf.meshes[0].primitives[0], accessor = gltf.accessors[primitive.attributes.TEXCOORD_0];
  const view = gltf.bufferViews[accessor.bufferView], stride = view.byteStride ?? 8;
  assert(accessor.componentType === 5126 && accessor.type === "VEC2" && accessor.count === 2352 && !accessor.sparse && view.buffer === 0 && stride >= 8, "Unsupported UV accessor.");
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  assert(start + (accessor.count - 1) * stride + 8 <= data.length, "UV accessor exceeds buffer.");
  let index = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++, index++) {
    assert(data.readFloatLE(start + index * stride) === (x + .5) / terrainSize &&
      data.readFloatLE(start + index * stride + 4) === (y + .5) / terrainSize, `Exported UV differs at grid ${x},${y}.`);
  }
  const glb = geometryInputs.glb.bytes;
  assert(glb.readUInt32LE(0) === 0x46546c67 && glb.readUInt32LE(4) === 2 && glb.readUInt32LE(8) === glb.length, "Invalid GLB header.");
  let glbJson, glbBin, offset = 12;
  while (offset + 8 <= glb.length) {
    const length = glb.readUInt32LE(offset), kind = glb.readUInt32LE(offset + 4);
    assert(offset + 8 + length <= glb.length, "GLB chunk exceeds file.");
    const chunk = glb.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) glbJson = JSON.parse(chunk.toString("utf8"));
    if (kind === 0x004e4942) glbBin = chunk;
    offset += 8 + length;
  }
  assert(offset === glb.length && glbBin && glbJson && glbBin.subarray(0, data.length).equals(data), "GLB binary does not match retained glTF buffer.");
  assert(JSON.stringify(glbJson.accessors[primitive.attributes.TEXCOORD_0]) === JSON.stringify(accessor), "GLB UV accessor differs.");
  const runtime = JSON.parse(geometryInputs.runtimeManifest.bytes);
  assert(JSON.stringify(runtime).includes(geometryInputs.glb.identity.sha256), "Runtime manifest does not reference the verified terrain GLB hash.");
  const layers = gltf.meshes[0].extras.nativeLayers;
  assert(Array.isArray(layers) && layers.length === 9 && layers.every((layer, i) => layer.index === i && typeof layer.alphaMap === "string"), "Retained mask layer inventory differs.");
  return { layers, inputs: Object.fromEntries(Object.entries(geometryInputs).map(([key, input]) => [key, input.identity])),
    checks: { verticesChecked: index, exportedOrdinaryUvExactlyMatches: true, glbBinaryAndAccessorMatch: true, runtimeContainsTerrainHash: true } };
}

function coordinate(grid, branch) {
  const ordinary = (grid + .5) / terrainSize;
  return Math.fround(branch === "ordinary" ? ordinary : ordinary - Math.max(grid - 240, 0) / 4096);
}
function sampleAlpha(pixels, width, height, u, v, filter) {
  const get = (x, y) => pixels[(Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4 + 3];
  if (filter === "nearest") return get(Math.floor(u * width), Math.floor(v * height));
  const px = u * width - .5, py = v * height - .5, x0 = Math.floor(px), y0 = Math.floor(py);
  const fx = px - x0, fy = py - y0;
  return (get(x0, y0) * (1 - fx) + get(x0 + 1, y0) * fx) * (1 - fy) +
    (get(x0, y0 + 1) * (1 - fx) + get(x0 + 1, y0 + 1) * fx) * fy;
}
function metrics(values) {
  assert(values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0 && value <= 255), "Invalid alpha differences.");
  const sorted = [...values].sort((a, b) => a - b), sum = values.reduce((total, value) => total + value, 0);
  return { points: values.length, changedPoints: values.filter(value => value !== 0).length,
    minAbsoluteAlphaByteDifference: sorted[0], maxAbsoluteAlphaByteDifference: sorted.at(-1),
    meanAbsoluteAlphaByteDifference: sum / values.length,
    p95AbsoluteAlphaByteDifference: sorted[Math.ceil(.95 * sorted.length) - 1] };
}
function selfCheck() {
  const fixtures = [
    [240, .939453125, .939453125], [241, .943359375, .943115234375], [255, .998046875, .994384765625],
  ];
  for (const [grid, ordinary, corrected] of fixtures) assert(coordinate(grid, "ordinary") === ordinary && coordinate(grid, "corrected") === corrected, `Coordinate self-check failed at ${grid}.`);
  const alpha = Buffer.from([0, 9, 19, 0, 88, 1, 7, 255]);
  assert(sampleAlpha(alpha, 2, 1, .5, .5, "nearest") === 255 && sampleAlpha(alpha, 2, 1, .5, .5, "bilinear") === 127.5, "Filter/channel self-check failed.");
  assert(sampleAlpha(alpha, 2, 1, -1, .5, "bilinear") === 0 && sampleAlpha(alpha, 2, 1, 2, .5, "nearest") === 255, "Clamp self-check failed.");
  return { coordinates: fixtures.length, samplingChecks: 4, passed: true };
}

function writeGrayscale(output, name, values) {
  const png = new PNG({ width: outputWidth, height: outputHeight });
  for (let i = 0; i < values.length; i++) {
    const value = Math.round(values[i]);
    png.data.set([value, value, value, 255], i * 4);
  }
  const bytes = PNG.sync.write(png, { colorType: 6, bitDepth: 8, inputColorType: 6, inputHasAlpha: true });
  const path = contained(output, name); writeFileSync(path, bytes);
  return { path: posix(path), bytes: bytes.length, sha256: sha(bytes), width: outputWidth, height: outputHeight };
}

function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === "--output"), "Usage: node scripts/audit-terrain-uv-branches.mjs [--output <nested evidence folder>]");
  const output = args.length ? contained(evidenceRoot, resolve(project, args[1])) : evidenceRoot;
  const checks = selfCheck();
  const auditInput = verifiedJson(auditPath, { sha256: auditSha }), catalogInput = verifiedJson(catalogPath, { sha256: catalogSha });
  const audit = auditInput.value, catalog = catalogInput.value, geometry = verifyGeometry(audit);
  assert(catalog.schemaVersion === 1 && Array.isArray(catalog.textures), "Texture catalog is unsupported.");
  const records = new Map(catalog.textures.map(record => [record.assetId.toLowerCase(), record]));
  assert(records.size === catalog.textures.length, "Duplicate source texture IDs.");
  mkdirSync(output, { recursive: true });
  assert(contained(evidenceRoot, realpathSync(output)) === realpathSync(output), "Resolved output scope differs.");
  const results = [], artifacts = [];
  for (const layer of geometry.layers) {
    const id = `interlude:${layer.alphaMap}`, record = records.get(id.toLowerCase());
    assert(record && /^[a-f0-9]{64}$/.test(record.archiveSha256) && record.image === `/l2/${record.archiveSha256}/texture.png`, `Unsupported staged mask path: ${id}`);
    const input = read(`public${record.image}`, { bytes: record.imageBytes, sha256: record.imageSha256 });
    const archive = read(`public${record.archive}`, { sha256: record.archiveSha256 });
    const bytes = input.bytes;
    assert(bytes.length >= 33 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && bytes[24] === 8 && [2, 6].includes(bytes[25]), `Unsupported mask PNG: ${id}`);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), expectedSize = layer.index === 0 ? 256 : layer.index === 6 ? 512 : 1024;
    assert(width === expectedSize && height === expectedSize, `Mask extent differs: ${id}`);
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    assert(decoded.width === width && decoded.height === height && decoded.data.length === width * height * 4, `Decoded mask extent differs: ${id}`);
    for (let i = 0; i < decoded.data.length; i += 4) assert(decoded.data[i] === decoded.data[i + 1] && decoded.data[i] === decoded.data[i + 2] && decoded.data[i] === decoded.data[i + 3], `Mask channels differ: ${id}`);
    const samplers = [];
    for (const filter of ["nearest", "bilinear"]) {
      const ordinary = [], corrected = [], difference = [], edgeDifference = [], unaffectedDifference = [];
      let maximumAt = null, maxDifference = -1;
      for (let iy = 0; iy < outputHeight; iy++) for (let ix = 0; ix < outputWidth; ix++) {
        const x = minX + ix / samplesPerGrid, y = minY + iy / samplesPerGrid;
        const old = sampleAlpha(decoded.data, width, height, coordinate(x, "ordinary"), coordinate(y, "ordinary"), filter);
        const alternative = sampleAlpha(decoded.data, width, height, coordinate(x, "corrected"), coordinate(y, "corrected"), filter);
        const delta = Math.abs(old - alternative);
        ordinary.push(old); corrected.push(alternative); difference.push(delta);
        (y > 240 ? edgeDifference : unaffectedDifference).push(delta);
        if (delta > maxDifference) { maxDifference = delta; maximumAt = { gridX: x, gridY: y, ordinaryAlphaByte: old, correctedAlphaByte: alternative }; }
      }
      assert(difference.length === pointCount && unaffectedDifference.every(value => value === 0), "Comparison changed outside the conditional edge.");
      const names = { ordinary: `layer-${layer.index}-${filter}-ordinary.png`, corrected: `layer-${layer.index}-${filter}-corrected.png`, absoluteDifference: `layer-${layer.index}-${filter}-absolute-difference.png` };
      const images = Object.fromEntries(Object.entries(names).map(([kind, name]) => [kind, writeGrayscale(output, name, kind === "ordinary" ? ordinary : kind === "corrected" ? corrected : difference)]));
      artifacts.push(...Object.values(images));
      samplers.push({ filter, assumptions: { address: "clamp-to-edge", mip: 0 }, wholeRectangle: metrics(difference),
        correctedEdgeOnly: { gridYGreaterThan: 240, ...metrics(edgeDifference) }, unchangedRegion: { gridYAtMost: 240, ...metrics(unaffectedDifference) },
        maximumAt, images });
    }
    results.push({ layer: layer.index, assetId: record.assetId, source: record.source,
      representation: "retained source PNG derivative; no compressed/GPU/native sampler execution", originalFormatLabelFromReviewedInventory: layer.index === 6 ? "P8" : "DXT1",
      png: input.identity, archive: archive.identity, decoded: { width, height, rgbaBytes: decoded.data.length, rgbaSha256: sha(decoded.data),
        equalRgbaChannelsVerified: true, sampledChannel: "alpha under explicit successful legacy bitmap assumption" }, samplers });
  }
  const reportPaths = [
    "artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/COORDINATE_BINDING_ADDENDUM.md",
    "artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/native/UV_PRODUCER.md",
  ];
  const outputReport = {
    schemaVersion: 1, kind: "source-mask-conditional-uv-sensitivity", nativeParity: "unverified", sourceFilesModified: false,
    tools: { node: process.version, script: read(posix(fileURLToPath(import.meta.url))).identity, pngjs: { name: pngManifest.name, version: pngManifest.version,
      implementationFiles: ["png.js", "png-sync.js", "parser-sync.js", "parser.js", "bitmapper.js", "format-normaliser.js"].map(name => read(posix(resolve(pngRoot, "lib", name))).identity) },
      lockfile: read("pnpm-lock.yaml").identity },
    inputs: { priorUvAudit: auditInput.identity, catalog: catalogInput.identity, geometry: geometry.inputs, nativeReports: reportPaths.map(path => read(path).identity) },
    source: audit.nativeSource, geometryChecks: geometry.checks, selfCheck: checks,
    sampling: { gridBoundsInclusive: { min: [minX, minY], max: [maxX, maxY] }, heightmapDimensions: [terrainSize, terrainSize],
      stepInGridUnits: 1 / samplesPerGrid, dimensions: [outputWidth, outputHeight], samplesPerMaskAndSampler: pointCount,
      outputOrientation: "left-to-right increasing grid X; top-to-bottom increasing grid Y; original PNG row order; no row flip",
      ordinaryFormula: "(grid + 0.5) / 256", correctedFormula: "(grid + 0.5) / 256 - max(grid - 240, 0) / 4096",
      formulaPrecision: "JavaScript binary64 expression then Math.fround per UV component. These quarter-grid/power-of-two values are exact binary fractions; no native x87 state inferred.",
      nearest: "floor(u*width), floor(v*height), clamp texel indices",
      bilinear: "texel position=(u*width-0.5,v*height-0.5); interpolate four clamped alpha bytes with binary64 arithmetic",
      comparison: "absolute difference of unrounded sampled alpha bytes; changed means nonzero; percentile is nearest-rank ceil(0.95*n)-1",
      pixelMetricScope: "source-grid sensitivity only; not rasterized camera/frame pixels or native execution" },
    visualization: { output: "8-bit opaque grayscale PNG", ordinaryAndCorrectedScale: "0..255 sampled alpha, round only for PNG representation",
      differenceScale: "absolute sampled-alpha difference 0..255 mapped directly to grayscale; no amplification, auto-normalization, threshold or mismatch masking",
      gammaCorrectionApplied: false, sourcePremultiplied: false, metricValuesRounded: false },
    results,
    limits: ["Neither branch is selected for the actual native draw; generation-time/effective state and bound resource identity remain unobserved.",
      "No native GetLayerAlpha, geometry-pruning reconstruction, BC1 decoding, P8 palette mutation, mip/format upload or shader/lighting/framebuffer simulation.",
      "Mip0 clamp nearest/bilinear are explicit alternatives, not claims about native sampler state.",
      "The rectangular grid includes source coordinates regardless of visible triangles/occlusion; no visibility masks or camera-dependent area weighting are applied.",
      "Equal input channels do not prove native semantic channel selection. Alpha is used only under the conditional legacy bitmap rule.",
      "This is not a native visual acceptance, performance measurement, screen-error result or supported production correction.",
      "No source, authored Editor material, native file, service, acceptance tolerance or browser production behavior is changed."],
  };
  const jsonBytes = Buffer.from(JSON.stringify(outputReport, null, 2) + "\n");
  writeFileSync(contained(output, "comparison.json"), jsonBytes);
  artifacts.push({ path: posix(contained(output, "comparison.json")), bytes: jsonBytes.length, sha256: sha(jsonBytes) });
  writeFileSync(contained(output, "SHA256-MANIFEST.json"), JSON.stringify({ schemaVersion: 1, artifacts }, null, 2) + "\n");
  const summary = results.map(result => ({ layer: result.layer, assetId: result.assetId, samplers: result.samplers.map(value => ({ filter: value.filter, ...value.wholeRectangle })) }));
  process.stdout.write(JSON.stringify({ output: posix(output), pointsPerMaskAndSampler: pointCount, masks: results.length, pngs: artifacts.length - 1, summary }, null, 2) + "\n");
}

main();

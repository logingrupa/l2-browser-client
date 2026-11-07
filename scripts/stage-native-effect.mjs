/** Stage verified retained effect products. No conversion, catalog or playback policy. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile), scriptsDir = dirname(fileURLToPath(import.meta.url));
const plans = new WeakMap(), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const require = (condition, message) => { if (!condition) throw Error(`Native effect stage: ${message}`); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encode = value => Buffer.from(JSON.stringify(canonical(value)) + "\n");
const inside = (root, child) => { const name = relative(root, child); return !name || !isAbsolute(name) && name !== ".." && !name.startsWith(`..${sep}`); };
function safeRelative(value) {
  require(typeof value === "string" && value && !isAbsolute(value) && !value.includes("\\") && value.split("/").every(part =>
    part && part !== "." && part !== ".." && !/[:\x00-\x1f]/.test(part) && !/[. ]$/.test(part) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)), "unsafe relative path");
  return value;
}
async function checkedPath(value, existingDirectory = false) {
  require(typeof value === "string" && value.length > 0, "explicit input/output path required");
  const absolute = resolve(value), chain = [];
  for (let path = absolute; dirname(path) !== path; path = dirname(path)) chain.unshift(path);
  let leaf;
  for (const path of chain) {
    try {
      const stat = await fs.lstat(path);
      require(!stat.isSymbolicLink() && (path === absolute || stat.isDirectory()), `symlink/junction or invalid ancestor: ${path}`);
      if (path === absolute) leaf = stat;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  require(!existingDirectory || leaf?.isDirectory(), "bundle directory must exist");
  return { absolute, stat: leaf };
}
async function readPinned(root, spec) {
  const rel = safeRelative(spec.file);
  require(Number.isSafeInteger(spec.bytes) && spec.bytes >= 0 && spec.bytes <= 128 * 1024 * 1024 && hash(spec.sha256), `invalid file pin: ${rel}`);
  const checked = await checkedPath(join(root, rel));
  require(inside(root, checked.absolute) && checked.stat?.isFile() && checked.stat.size === spec.bytes, `missing/changed file: ${rel}`);
  const bytes = await fs.readFile(checked.absolute), after = await fs.stat(checked.absolute);
  require(bytes.length === spec.bytes && sha(bytes) === spec.sha256 && after.mtimeMs === checked.stat.mtimeMs && after.size === checked.stat.size,
    `file identity changed: ${rel}`);
  return bytes;
}
const describe = (file, bytes) => ({ file, bytes: bytes.length, sha256: sha(bytes) });
function deepFreeze(value) { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }

/** Reuse the dedicated inspector: it hashes all declared retained payloads,
 * validates graph/asset identities and joins GLB primitive images. No originals
 * are opened; no converter or native tool is invoked. */
async function inspect(bundleDir, python) {
  const code = "import sys; sys.path.insert(0,sys.argv[1]); from native_assets_lib.effect_readiness import inspect; from native_assets_lib.gltf import json_bytes; report,bundle=inspect(sys.argv[2]); bundle.unchanged(); sys.stdout.buffer.write(json_bytes(report)+b'\\n')";
  try {
    const { stdout } = await execute(python, ["-B", "-c", code, scriptsDir, bundleDir], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    return { report: JSON.parse(stdout.toString("utf8")), bytes: stdout };
  } catch (error) { throw Error(`Native effect stage: retained bundle inspection failed: ${String(error.stderr || error.message).slice(-4000)}`); }
}

/** Plan is read-only. Output is an immutable content-addressed directory. */
export async function planNativeEffectStage(options = {}) {
  const bundleDir = (await checkedPath(options.bundleDir, true)).absolute;
  const outputDir = (await checkedPath(options.outputDir)).absolute;
  require(!inside(bundleDir, outputDir) && !inside(outputDir, bundleDir), "input/output directories overlap");
  const manifestPath = await checkedPath(join(bundleDir, "manifest.json"));
  require(manifestPath.stat?.isFile() && manifestPath.stat.size <= 32 * 1024 * 1024, "missing/oversized source manifest");
  const sourceBytes = await fs.readFile(manifestPath.absolute), sourcePin = describe("manifest.json", sourceBytes);
  if (options.expectedManifestSha256 !== undefined) require(hash(options.expectedManifestSha256) && options.expectedManifestSha256 === sourcePin.sha256,
    "source manifest differs from expected identity");
  const source = JSON.parse(sourceBytes.toString("utf8"));
  const { report, bytes: reportBytes } = await inspect(bundleDir, options.python || "python");
  require(report.kind === "native-effect-resource-readiness" && report.schemaVersion === 1 && report.bundleId === source.id &&
    report.inputs.manifest.sha256 === sourcePin.sha256 && report.inputs.declaredFilesVerified === source.files.length, "inspection/source identity mismatch");
  const inputPins = [sourcePin, ...source.files], byFile = new Map(source.files.map(row => [row.file, row]));
  const assets = new Map(report.assets.map(asset => [asset.id, asset]));
  const byObject = new Map(report.assets.map(asset => [asset.object.toLowerCase(), asset]));
  const textures = new Map(report.textureGraph.map(texture => [texture.object.toLowerCase(), texture]));
  const selected = new Set(), unresolved = [];
  function select(asset, expectedKind, reason) {
    if (!asset || asset.kind !== expectedKind) { unresolved.push({ reason, object: asset?.object ?? null }); return null; }
    selected.add(asset.id); return asset.id;
  }
  const routes = report.components.map(component => {
    const meshEmitter = component.class.toLowerCase() === "engine.meshemitter";
    const spriteEmitter = component.class.toLowerCase() === "engine.spriteemitter";
    const properties = component.effectiveProperties;
    const mesh = meshEmitter ? select(byObject.get(properties.StaticMesh?.object?.toLowerCase()), "model", `${component.object}: StaticMesh`) : null;
    const texture = spriteEmitter ? select(byObject.get(properties.Texture?.object?.toLowerCase()), "texture", `${component.object}: Texture`) : null;
    const primitiveMaterials = component.primitiveMaterials.map(primitive => {
      const textureResourceKey = primitive.textureIdentityStatus === "exact-converted-image-bytes" ?
        select(assets.get(primitive.convertedTextureId), "texture", `${component.object}: primitive texture`) : null;
      return { ...primitive, textureResourceKey };
    });
    return { mesh, texture, primitiveMaterials };
  });
  // Follow only explicit AnimNext links. Never infer a loop or turn retained
  // DefaultMaterial/Engine.S_Emitter into a sampled mesh material.
  const visited = new Set();
  for (const id of selected) {
    const asset = assets.get(id); if (asset.kind !== "texture" || visited.has(id)) continue;
    visited.add(id);
    const next = textures.get(asset.object.toLowerCase())?.animationProperties?.AnimNext?.object;
    if (next) select(byObject.get(next.toLowerCase()), "texture", `${asset.object}: AnimNext ${next}`);
  }
  const resourceEntries = [], payloads = new Map();
  for (const asset of report.assets.filter(asset => selected.has(asset.id))) {
    const spec = byFile.get(asset.primary);
    require(spec && spec.sha256 === asset.primarySha256, `primary identity mismatch: ${asset.object}`);
    const bytes = await readPinned(bundleDir, spec), extension = asset.kind === "model" ? "glb" : "png";
    if (extension === "png") require(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR", `invalid PNG: ${asset.object}`);
    else require(bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "glTF" && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, `invalid GLB: ${asset.object}`);
    const file = `resources/${spec.sha256}.${extension}`;
    payloads.set(file, bytes);
    resourceEntries.push([asset.id, { assetId: asset.id, object: asset.object, kind: asset.kind, source: asset.source, sourceFile: asset.primary,
      sourceManifest: asset.manifest, ...describe(file, bytes), limitations: asset.limitations }]);
  }
  const resources = Object.fromEntries(resourceEntries);
  const stageBindings = actor => (report.sourceDispatch?.bindings || []).flatMap((binding, index) => binding.effectObject.toLowerCase() === actor.object.toLowerCase() ?
    [{ ...binding, sourcePointer: `/sourceDispatch/bindings/${index}`, identityJoin: { actorObject: actor.object, bindingEffectObject: binding.effectObject,
      comparison: actor.object === binding.effectObject ? "exact-full-object" : "case-insensitive-full-object" } }] : []);
  const actors = report.actors.map(actor => ({ ...actor, stageBindings: stageBindings(actor),
    dispatchStages: report.associations.filter(association => association.effectObject === actor.object).flatMap(association => association.dispatchStages || []),
    componentObjects: report.components.filter(component => component.actor === actor.object).map(component => component.object) }));
  const components = report.components.map((component, index) => ({ ...component, primitiveMaterials: undefined,
    bindings: { mesh: resources[routes[index].mesh] ?? null, texture: resources[routes[index].texture] ?? null, primitiveMaterials: routes[index].primitiveMaterials },
    unresolvedBehavior: component.unimplementedEffectiveFields, runtimePlayable: false }));
  const textureGraph = report.textureGraph.filter(texture => selected.has(texture.convertedAssetId)).map(texture => ({ ...texture,
    resourceKey: texture.convertedAssetId,
    nextResourceKey: byObject.get(texture.animationProperties?.AnimNext?.object?.toLowerCase())?.id ?? null }));
  const runtime = { schemaVersion: 1, kind: "native-effect-components", id: source.id, skillId: source.skillId, level: source.level,
    sourceBundle: { manifest: sourcePin, graph: report.inputs.sourceGraph, readinessSha256: sha(reportBytes), declaredFilesVerified: source.files.length },
    sourceFiles: report.sourceFiles, actors, components, resources, textureGraph, classEnums: report.classEnums,
    associations: report.associations, sourceDispatch: report.sourceDispatch, stages: report.stages,
    stageOrderPolicy: "Source actor/emitter order retained; dispatch labels are evidence, not a playback sequence.",
    unresolved: { dependencies: [...report.unresolvedDependencies, ...unresolved], bundleGaps: report.bundleGaps,
      behavior: ["particle simulation", "stage/animation timing", "attachment and spawn transforms", "random distributions", "blend/depth equations",
        "native texture animation/atlas selection", "lifetime overrides and cleanup", "audio lookup and playback"],
      excludedAudioAssets: report.assets.filter(asset => asset.kind === "audio").map(asset => ({ assetId: asset.id, object: asset.object, reason: "No runtime audio policy selected; payload not staged." })) },
    limits: report.limits };
  const runtimeBytes = encode(runtime), manifestSha256 = sha(runtimeBytes), destination = join(outputDir, manifestSha256);
  payloads.set("manifest.json", runtimeBytes);
  const summary = { actors: actors.length, components: components.length, resources: resourceEntries.length,
    models: resourceEntries.filter(([, resource]) => resource.kind === "model").length,
    textures: resourceEntries.filter(([, resource]) => resource.kind === "texture").length,
    payloadFiles: payloads.size - 1, payloadBytes: [...payloads.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    excludedAudioAssets: runtime.unresolved.excludedAudioAssets.length };
  const plan = deepFreeze({ kind: "native-effect-stage-plan", sourceManifestSha256: sourcePin.sha256, manifestSha256,
    outputDirectory: destination, manifestFile: join(destination, "manifest.json"), summary, manifest: JSON.parse(runtimeBytes.toString("utf8")) });
  plans.set(plan, { bundleDir, outputDir, destination, inputPins, payloads });
  // Rehash all retained inputs after projection; no native/original paths used.
  for (const spec of inputPins) await readPinned(bundleDir, spec);
  return plan;
}

async function outputFiles(root) {
  const files = [];
  async function visit(path, prefix) {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      const rel = safeRelative(prefix + entry.name);
      require(!entry.isSymbolicLink(), `output symlink/junction: ${rel}`);
      if (entry.isDirectory()) await visit(join(root, rel), rel + "/");
      else { require(entry.isFile(), `non-file output: ${rel}`); files.push(rel); }
    }
  }
  await visit(root, ""); return files.sort();
}
async function verifyOutput(destination, payloads) {
  const actual = await outputFiles(destination), expected = [...payloads.keys()].sort();
  require(JSON.stringify(actual) === JSON.stringify(expected), "existing output file set differs; preserved");
  for (const [file, bytes] of payloads) await readPinned(destination, describe(file, bytes));
}
export async function applyNativeEffectStage(plan, options = {}) {
  const state = plans.get(plan); require(state, "plan must come from this module's read-only planner");
  for (const spec of state.inputPins) await readPinned(state.bundleDir, spec);
  const output = await checkedPath(state.destination);
  if (output.stat) {
    require(output.stat.isDirectory(), "existing output is not a directory");
    await verifyOutput(state.destination, state.payloads);
    return { status: options.verifyOnly ? "verified" : "preserved", manifestSha256: plan.manifestSha256, manifestFile: plan.manifestFile,
      outputDirectory: plan.outputDirectory, summary: plan.summary };
  }
  require(!options.verifyOnly, "verify requires existing output");
  await checkedPath(state.outputDir); await fs.mkdir(state.outputDir, { recursive: true }); await checkedPath(state.outputDir, true);
  // Reserve a new immutable directory; never replace or repair an existing one.
  await fs.mkdir(state.destination); await checkedPath(state.destination, true);
  await fs.mkdir(join(state.destination, "resources"));
  for (const [file, bytes] of state.payloads) await fs.writeFile(join(state.destination, file), bytes, { flag: "wx" });
  await verifyOutput(state.destination, state.payloads);
  return { status: "produced", manifestSha256: plan.manifestSha256, manifestFile: plan.manifestFile,
    outputDirectory: plan.outputDirectory, summary: plan.summary };
}
export async function stageNativeEffect(options) {
  const plan = await planNativeEffectStage(options);
  return options.planOnly ? { status: "planned", manifestSha256: plan.manifestSha256, manifestFile: plan.manifestFile,
    outputDirectory: plan.outputDirectory, summary: plan.summary } : applyNativeEffectStage(plan, { verifyOnly: options.verifyOnly });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  try {
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === "--plan") options.planOnly = true;
      else if (key === "--verify") options.verifyOnly = true;
      else {
        const field = { "--bundle": "bundleDir", "--output": "outputDir", "--expected-manifest": "expectedManifestSha256", "--python": "python" }[key];
        require(field && args[index + 1] && !args[index + 1].startsWith("--") && options[field] === undefined, `unknown/duplicate/missing option: ${key}`);
        options[field] = args[++index];
      }
    }
    require(!(options.planOnly && options.verifyOnly), "choose --plan or --verify, not both");
    console.log(JSON.stringify(await stageNativeEffect(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

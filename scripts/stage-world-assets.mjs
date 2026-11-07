import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Deliberately pin the audited outputs, rather than following changing current.json pointers.
const sourceVersion = "feeee654b2804b11fe7df871d912251cf65d6210";
const terrainHash = "9deb41bc2e7d5e0289bfed51fe45d6ac850eb5c8c153600e44fb687bb9ee5920";
const terrainManifestHash = "3f43ee1444deebc823273abfa845b9135b9ac7faea00530bc7209690415f5421";
const bundles = {
  "world-models": {
    path: "world-models/20261103T113334577064Z-brushes/instances.json",
    sha256: "cfdb7b561b26ee9ea72612778a3ded183fd36ea8ac333141cff9b7e76e3bda6f",
  },
  surfaces: {
    path: "surfaces/20261103T111823Z-runtime/manifest.json",
    sha256: "0258a92e316692473f9e78893885959c3fe4622a5be8db9a5e48cf461cd82c4a",
  },
  locations: {
    path: "locations/runs/b154620b79ef07d9bedfa2bbfc942cd68efca66138c8f40afe1f54758faa26cb/manifest.json",
    sha256: "1d284ac39658ce6cbc7558f9ea5051851bb5514e9ebaa52af913c343b2fbb7ce",
  },
};
const filenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:glb|png|jpg|jpeg|json|jsonl|md)$/;
const hashPattern = /^[a-f0-9]{64}$/;
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(workspace, "public/assets/world");
const args = process.argv.slice(2);
const verifyOnly = args.includes("--verify");
const positional = args.filter((argument) => !argument.startsWith("--"));
if (positional.length > 1 || args.some((argument) => argument.startsWith("--") && argument !== "--verify")) {
  throw new Error("Usage: node scripts/stage-world-assets.mjs [lineagen-workspace] [--verify]");
}
const source = resolve(positional[0] ?? "C:/laragon/www/lineagen", ".assets/talking-island");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertContained(root, target, allowRoot = false) {
  const within = relative(root, target);
  if ((!within && !allowRoot) || isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) {
    throw new Error(`Asset path escaped its directory: ${target}`);
  }
  return target;
}

async function readContained(root, name, expected) {
  const canonicalRoot = await realpath(root);
  const path = assertContained(canonicalRoot, await realpath(resolve(root, name)));
  const bytes = await readFile(path);
  if (hash(bytes) !== expected) throw new Error(`SHA-256 mismatch: ${path}`);
  return { path, bytes };
}

async function collectFiles(root, local) {
  const plan = [];
  const add = async (input, output, expected, expectedBytes) => {
    if (!hashPattern.test(expected)) throw new Error(`Invalid hash for ${input}`);
    const { path, bytes } = await readContained(root, input, expected);
    if (expectedBytes !== undefined && bytes.length !== expectedBytes) throw new Error(`Byte count mismatch: ${path}`);
    plan.push({ name: output, source: path, bytes: bytes.length, sha256: expected });
    return bytes;
  };
  const terrain = JSON.parse(await add(local ? "terrain-manifest.json" : "preview-manifest.json", "terrain-manifest.json", terrainManifestHash));
  if (terrain.schemaVersion !== 1 || terrain.sourceRoute !== "unity-reference" || terrain.sha256 !== terrainHash) {
    throw new Error("The terrain metadata does not describe the pinned Unity-reference geometry.");
  }
  await add(local ? "terrain.glb" : `source/${terrain.combinedGlb}`, "terrain.glb", terrainHash);
  for (const [name, bundle] of Object.entries(bundles)) {
    const manifestPath = local ? `${name}/manifest.json` : bundle.path;
    const manifest = JSON.parse(await add(manifestPath, `${name}/manifest.json`, bundle.sha256));
    if (manifest.schemaVersion !== 1 || manifest.sourceRoute !== "unity-reference" || manifest.sourceVersion !== sourceVersion || !Array.isArray(manifest.files)) {
      throw new Error(`Incompatible world bundle: ${name}`);
    }
    const seen = new Set();
    for (const file of manifest.files) {
      if (!filenamePattern.test(file.file) || seen.has(file.file) || file.file === "manifest.json") throw new Error(`Invalid output allowlist: ${name}`);
      seen.add(file.file);
      await add(`${dirname(manifestPath)}/${file.file}`, `${name}/${file.file}`, file.sha256, file.bytes);
    }
  }
  return { plan, terrain };
}

async function verifyDestination() {
  const { plan } = await collectFiles(destination, true);
  const inventory = JSON.parse(await readFile(resolve(destination, "manifest.json"), "utf8"));
  if (inventory.schemaVersion !== 1 || inventory.sourceRoute !== "unity-reference" || inventory.sourceVersion !== sourceVersion ||
      inventory.terrain?.sha256 !== terrainHash || inventory.terrain?.url !== "/assets/world/terrain.glb" ||
      inventory.terrain?.manifestSha256 !== terrainManifestHash || inventory.terrain?.manifestUrl !== "/assets/world/terrain-manifest.json" ||
      !Array.isArray(inventory.files) || inventory.files.length !== plan.length) {
    throw new Error("Local world inventory does not match the pinned dataset.");
  }
  for (const [name, bundle] of Object.entries(bundles)) {
    if (inventory.bundles?.[name]?.manifestSha256 !== bundle.sha256 || inventory.bundles[name].manifestUrl !== `/assets/world/${name}/manifest.json`) {
      throw new Error(`Local inventory has an incompatible ${name} bundle.`);
    }
  }
  const listed = new Map(inventory.files.map((file) => [file.name, file]));
  if (listed.size !== plan.length) throw new Error("Local world inventory has duplicate files.");
  for (const file of plan) {
    const record = listed.get(file.name);
    if (record?.sha256 !== file.sha256 || record?.bytes !== file.bytes) throw new Error(`Local inventory mismatch: ${file.name}`);
  }
  return { files: plan.length, bytes: plan.reduce((total, file) => total + file.bytes, 0) };
}

if (!verifyOnly) {
  // Validate every source before writing anything. A new/partial conversion cannot silently replace this dataset.
  const { plan, terrain } = await collectFiles(source, false);
  await mkdir(destination, { recursive: true });
  const canonicalDestination = assertContained(await realpath(workspace), await realpath(destination));
  for (const file of plan) {
    const target = assertContained(canonicalDestination, resolve(destination, file.name));
    await mkdir(dirname(target), { recursive: true });
    assertContained(canonicalDestination, await realpath(dirname(target)), true);
    // Refuse existing symlinks/junctions that redirect writes outside our local asset directory.
    try { assertContained(canonicalDestination, await realpath(target)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const bytes = await readFile(file.source);
    if (hash(bytes) !== file.sha256) throw new Error(`Source changed while staging: ${file.source}`);
    await writeFile(target, bytes);
    if (hash(await readFile(target)) !== file.sha256) throw new Error(`Staged asset verification failed: ${file.name}`);
  }
  const inventoryPath = resolve(destination, "manifest.json");
  try { assertContained(canonicalDestination, await realpath(inventoryPath)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // Published last: this entry is the runtime's presence/readiness indicator.
  await writeFile(inventoryPath, `${JSON.stringify({
    schemaVersion: 1,
    stagedAt: new Date().toISOString(),
    sourceRoot: source,
    sourceRoute: "unity-reference",
    sourceVersion,
    rightsStatus: terrain.rightsStatus,
    terrain: {
      url: "/assets/world/terrain.glb", sha256: terrainHash,
      manifestUrl: "/assets/world/terrain-manifest.json", manifestSha256: terrainManifestHash,
      sourceVersion: terrain.sourceVersion, archiveSha256: terrain.archiveSha256,
    },
    bundles: Object.fromEntries(Object.entries(bundles).map(([name, bundle]) => [name, {
      manifestUrl: `/assets/world/${name}/manifest.json`, manifestSha256: bundle.sha256, sourceManifest: bundle.path,
    }])),
    runtimePolicies: {
      cameraRelativeRendering: true,
      foliageCutouts: "Four audited materials in two unchanged, hash-pinned models; apply runtime MASK/.5/two-sided repair before instancing.",
      terrainSurfaces: "source-layers-v2; opaque RGB masks; reconstruct source UVs and validate GPU blend probes; explicit baked fallback.",
    },
    files: plan,
  }, null, 2)}\n`);
}
const verified = await verifyDestination();
console.log(`${verifyOnly ? "Verified" : "Staged and verified"} ${verified.files} unchanged world files (${verified.bytes} bytes) in ${destination}.`);
console.log("Local use only; provenance and SHA-256 inventory: public/assets/world/manifest.json");

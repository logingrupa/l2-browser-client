/** Read-only source/export/reference census. Writes diagnostic JSON/Markdown only.
 * Reuses the existing UE2 package reader and actual browser package validator. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { transformSync, version as esbuildVersion } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(root, "artifacts/native-parity/research/audio-world-20261106");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output")) throw Error("Usage: node scripts/audit-native-audio-coverage.mjs [--output <descendant of audio-world-20261106>]");
const output = args.length ? resolve(root, args[1]) : resolve(evidence, "inventory");
function within(base, path) { const rel = relative(base, path); if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Path escapes scope: ${path}`); return path; }
within(evidence, output); mkdirSync(output, { recursive: true }); within(realpathSync(evidence), realpathSync(output));
const posix = value => value.split(sep).join("/");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inputs = new Map();
function read(path) { const absolute = within(root, resolve(root, path)), bytes = readFileSync(absolute); inputs.set(posix(relative(root, absolute)), { path: posix(relative(root, absolute)), bytes: bytes.length, sha256: hash(bytes) }); return bytes; }
function json(path) { return JSON.parse(read(path).toString("utf8").replace(/^\uFEFF/, "")); }
function failUnless(value, message) { if (!value) throw Error(message); }
function tally(values) { const result = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))); }
function strings(value, path = "") { if (typeof value === "string") return [{ path, value }]; if (!value || typeof value !== "object") return []; return Object.entries(value).flatMap(([key, entry]) => strings(entry, `${path}/${key}`)); }

const sourceLockPath = "recipes/native-inputs.lock.json", sourceLock = json(sourceLockPath);
const migrationRoot = "artifacts/native-parity/migration", migration = json(`${migrationRoot}/inventory.json`);
const products = json(`${migrationRoot}/products.json`), catalog = json("public/l2/catalog.json");
failUnless(hash(read(sourceLockPath)) === catalog.sourceManifestSha256, "Active catalog source manifest differs.");
const nativeRoot = "artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/inventory";
const nativeTree = json(`${nativeRoot}/client-file-inventory.json`), nativeReceipt = json(`${nativeRoot}/client-native-inventory-complete.json`);
const historicalAudit = json("artifacts/native-audio/native-audio-audit.json");
read("pnpm-lock.yaml"); read("scripts/native_catalog/ue2.py"); read("scripts/audit-native-audio-coverage.mjs");

// Existing reviewed table parser only. No native execution, export tool or mutation.
const python = String.raw`import sys,json,pathlib,hashlib
sys.path.insert(0,str(pathlib.Path('scripts').resolve()))
from native_catalog.ue2 import Package
lock=json.loads(pathlib.Path('recipes/native-inputs.lock.json').read_text(encoding='utf-8-sig'))
rows=[]
for item in lock['files']:
 if not item['relativePath'].lower().endswith('.uax'): continue
 path=pathlib.Path('artifacts/native-parity/inputs/IMPORTA-PC')/item['relativePath']
 data=path.read_bytes()
 if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']: raise ValueError('Pinned UAX mismatch: '+str(path))
 package=Package(data,path.name)
 sounds=[]
 for export in package.exports:
  if export['className']!='Sound': continue
  payload=package.data[export['offset']:export['offset']+export['size']]
  sounds.append({'object':export['object'],'exportIndex':export['exportIndex'],'offsetUnwrapped':export['offset'],'bytes':export['size'],'serializedPayloadSha256':hashlib.sha256(payload).hexdigest()})
 rows.append({'relativePath':item['relativePath'],'sourceHost':lock['sourceHost'],'sourcePath':lock['sourceRoot']+'/'+item['relativePath'],'bytes':len(data),'sha256':package.source_hash,'format':package.summary,'sounds':sounds})
print(json.dumps({'pythonVersion':sys.version.split()[0],'packages':rows},sort_keys=True))`;
const parsed = spawnSync("python", ["-B", "-c", python], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
if (parsed.status !== 0) throw Error(parsed.stderr || `Source package reader failed: ${parsed.status}`);
const sourcePackages = JSON.parse(parsed.stdout);
for (const pkg of sourcePackages.packages) {
  const earlier = migration.files.find(row => row.relativePath.toLowerCase() === pkg.relativePath.toLowerCase());
  failUnless(earlier?.sha256 === pkg.sha256 && earlier?.exportClasses?.Sound === pkg.sounds.length, `Source census differs from pinned migration: ${pkg.relativePath}`);
  inputs.set(`artifacts/native-parity/inputs/IMPORTA-PC/${pkg.relativePath}`, { path: `artifacts/native-parity/inputs/IMPORTA-PC/${pkg.relativePath}`, bytes: pkg.bytes, sha256: pkg.sha256 });
}
const stagedNames = new Set(sourceLock.files.map(row => row.relativePath.toLowerCase()));
const nativeAudioFiles = nativeTree.filter(row => /\.(uax|ogg|wav|mp3)$/i.test(row.path)).map(row => ({ ...row, path: row.path.replaceAll("\\", "/"), localPinned: stagedNames.has(row.path.replaceAll("\\", "/").toLowerCase()), contentHashAvailable: false }));
const soundLookup = new Map(sourcePackages.packages.flatMap(pkg => pkg.sounds.map(row => [row.object.toLowerCase(), {
  ...row, sourceHost: pkg.sourceHost, sourcePath: pkg.sourcePath, sourcePackageSha256: pkg.sha256,
  stableId: `${pkg.sourceHost}:${pkg.sha256}:${row.exportIndex}`,
}])));

const sourceReader = read("src/assets/package/readAssetPackage.ts");
const { code } = transformSync(sourceReader.toString("utf8"), { loader: "ts", format: "esm", target: "es2022" });
const { readAssetPackage } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const packageRows = [], eventRows = [], payloadRows = [];
const activeArchiveHashes = new Set(catalog.models.map(row => row.archiveSha256));
const archives = Object.entries(products).filter(([path]) => path.endsWith(".l2asset"));
for (const [path, expectedHash] of archives) {
  const archivePath = `${migrationRoot}/${path}`, bytes = read(archivePath);
  failUnless(hash(bytes) === expectedHash, `Migration product hash mismatch: ${path}`);
  // The browser reader expects Uint8Array.slice to copy, not Node Buffer.slice.
  let asset;
  try { asset = await readAssetPackage(Uint8Array.from(bytes)); }
  catch (error) { throw Error(`Archive validation failed (${archivePath}): ${error instanceof Error ? error.message : String(error)}`); }
  const audio = asset.manifest.files.filter(row => row.mime.startsWith("audio/"));
  const events = asset.manifest.animationEvents ?? [];
  const active = activeArchiveHashes.has(expectedHash);
  if (active) {
    const published = catalog.models.find(row => row.archiveSha256 === expectedHash);
    failUnless(hash(read(`public${published.archive}`)) === expectedHash, `Published catalog archive mismatch: ${published.id}`);
  }
  if (!audio.length && !events.length && asset.manifest.kind !== "audio") continue;
  const direct = events.filter(event => typeof event.sound === "string" && event.sound !== "None");
  const resolved = direct.filter(event => audio.some(file => file.path === event.resolvedFile));
  const provenanceBytes = asset.files.get("provenance.json");
  failUnless(provenanceBytes, `Audio-bearing archive lacks converter provenance: ${archivePath}`);
  const provenance = JSON.parse(new TextDecoder().decode(provenanceBytes));
  failUnless(provenance.source?.sha256 === asset.manifest.source.sha256 && provenance.source?.object === asset.manifest.source.object,
    `Archive source and converter provenance differ: ${archivePath}`);
  packageRows.push({ assetId: asset.manifest.id, kind: asset.manifest.kind, source: asset.manifest.source, archivePath, archiveSha256: expectedHash,
    activeWorldCatalog: active, audioPayloads: audio.length, notificationRows: events.length, directSoundRows: direct.length, resolvedDirectSoundRows: resolved.length,
    notificationTypes: tally(events.map(event => event.type ?? "unknown")), limitations: asset.manifest.limitations });
  for (const file of audio) {
    const references = [...new Set(events.filter(event => event.resolvedFile === file.path).map(event => event.sound))].filter(Boolean);
    if (asset.manifest.kind === "audio") references.push(asset.manifest.source.object);
    const sourceObjectMatches = references.map(reference => {
      const exactSourceObject = soundLookup.get(reference.toLowerCase()) ?? null;
      const source = asset.manifest.kind === "audio" ? { sourceSha256: provenance.source.sha256, sourceObject: provenance.source.object, file: asset.manifest.audio?.file }
        : provenance.metadata?.eventAudio?.[reference];
      failUnless(source && source.file === file.path, `Audio reference lacks exact converter payload binding: ${reference}`);
      // A name match alone does not establish which native package supplied the
      // payload. Require the converter's recorded package hash/object binding.
      if (exactSourceObject) failUnless(source.sourceSha256 === exactSourceObject.sourcePackageSha256 &&
        source.sourceObject?.toLowerCase() === exactSourceObject.object.toLowerCase(), `Native audio source identity differs: ${reference}`);
      return { reference, exactSourceObject, converterSource: source,
        pinnedSourceProvenanceVerified: exactSourceObject !== null };
    });
    payloadRows.push({ assetId: asset.manifest.id, archiveSha256: expectedHash, ...file, declaredSoundReferences: references,
      sourceObjectMatches,
      source: asset.manifest.source, activeWorldCatalog: active, exportedAndHashVerified: true, connectedWorldPlayback: "not-established-by-static-inventory", nativeBehaviorVerified: false });
  }
  for (const event of events) eventRows.push({ assetId: asset.manifest.id, archiveSha256: expectedHash, activeWorldCatalog: active, ...event,
    exportedDirectPayload: audio.some(file => file.path === event.resolvedFile), nativeTriggerVerified: false });
}

const rawMap = `${migrationRoot}/maps/map-20-20`;
const mapManifest = json(`${rawMap}/manifest.json`), mapExports = json(`${rawMap}/exports.json`), mapActors = json(`${rawMap}/actors.json`);
const audioClasses = new Set(["AmbientSoundObject", "AmbientSound", "MusicVolume"]);
const mapAudioDeclarations = mapExports.exports.filter(row => audioClasses.has(row.className));
const mapAudioActors = mapActors.filter(row => audioClasses.has(row.class)).map(row => ({ id: row.id, object: row.object, class: row.class, exportIndex: row.exportIndex, properties: row.properties, sourceTransform: row.sourceTransform ?? null }));
const activeSection = json(`public${catalog.sections[0].manifest}`);
failUnless(hash(read(`public${catalog.sections[0].manifest}`)) === catalog.sections[0].manifestSha256, "Active map-section manifest mismatch.");
const effectRoot = `${migrationRoot}/effects/power-strike-source-dispatch`;
const effect = json(`${effectRoot}/effect-source.json`), effectManifest = json(`${effectRoot}/manifest.json`);
const effectSoundDependencies = effect.dependencies.filter(row => row.class === "Sound");

// A complete lexical inventory of the present src tree is an audit aid, not a
// proof of execution/reachability. Runtime acceptance requires observed playback.
function walk(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]); }
const runtimeMentions = [];
for (const file of walk(resolve(root, "src")).filter(path => path.endsWith(".ts"))) {
  const path = posix(relative(root, file)), body = read(path).toString("utf8");
  const mentions = body.split(/\r?\n/).flatMap((line, index) => /AudioContext|createNativeEventAudio|nativeEventAudio|new Audio\(|\.decodeAudioData\(|audio\/(wav|ogg)|audioEngine|createBufferSource/.test(line) ? [{ line: index + 1, text: line.trim() }] : []);
  if (mentions.length) runtimeMentions.push({ path, mentions });
}

const audioReferencePattern = /^(?:StepSound|ChrSound\d*|MonSound\d*|ItemSound\d*|SkillSound\d*|AmbSound\d*|InterfaceSound|EtcSound|MessengerSound)\./i;
const propertyReferences = eventRows.flatMap(row => strings(row.properties).filter(entry => audioReferencePattern.test(entry.value)).map(entry => ({ assetId: row.assetId, eventObject: row.object, clip: row.clip, field: entry.path, reference: entry.value, activeWorldCatalog: row.activeWorldCatalog })));
const worldCatalogPayloads = payloadRows.filter(row => row.activeWorldCatalog);
const soundReferenceSet = [...new Set(propertyReferences.map(row => row.reference))].sort();
const referencedSourceMatches = soundReferenceSet.map(reference => ({ reference, exactSourceObjectInPinnedUax: soundLookup.has(reference.toLowerCase()), exactSourceObject: soundLookup.get(reference.toLowerCase()) ?? null }));
const categoryRows = [
  { category: "background-region-music", source: "250 music Ogg names in retained remote file inventory; two decoded 20_20 MusicVolume declarations", export: "Historical Ogg decode audit only; no pinned music Ogg in current migration closure", remaining: "Stage/hash authoritative source, join music IDs 202001/202002 to files, establish region conditions, transitions/looping, volume and native capture" },
  { category: "environment-positioned-looping-ambience", source: "Two staged ambient UAX packages; 2622 AmbientSoundObject exports in raw 20_20", export: "AmbientSoundObject properties absent from decoded actor list and active section; audio payload export coverage not established", remaining: "Decode actual emitter declarations/defaults and references, spatial/loop/activation rules, export dependencies, verify listener and audible world behavior" },
  { category: "surface-footsteps", source: "93 StepSound objects; notifications preserve surface arrays and original fields", export: "Direct notification files only; array membership is not established selection or complete export", remaining: "Native surface/class selector, walk/run/water cases, random policy, event timing, listener and attenuation" },
  { category: "character-npc-monster-voices-actions", source: "Fighter/Musveren notification sets; 45 voice Ogg names; character/monster UAX objects", export: "63 fighter and 12 Musveren payloads in active model archives", remaining: "Conditional notification dispatch, Random field semantics, voice priorities/loops, native timing/spatial behavior; broader NPC/character export" },
  { category: "combat-weapon-skill-cast-impact", source: "Notification subtypes and source-backed Power Strike cast/shot sound row", export: "Two exact Power Strike standalone archives in current migration", remaining: "Verify complete attack/skill sequencing, cast-impact trigger/target attachment, Volume/Radius interpretation and native audible evidence" },
  { category: "ui", source: "interfacesound and voice/systemmsg_e UAX listed remotely but absent from pinned closure", export: "Not established", remaining: "Stage/hash source, inventory exact UI event bindings and conditions, export and verify actual UI playback" },
];
const summary = { retainedNativeAudioFiles: nativeAudioFiles.length, retainedNativeUax: nativeAudioFiles.filter(row => row.path.toLowerCase().endsWith(".uax")).length,
  retainedNativeOgg: nativeAudioFiles.filter(row => row.path.toLowerCase().endsWith(".ogg")).length, stagedPinnedUax: sourcePackages.packages.length,
  indexedSoundObjects: sourcePackages.packages.reduce((sum, pkg) => sum + pkg.sounds.length, 0), unstagedUax: nativeAudioFiles.filter(row => row.path.toLowerCase().endsWith(".uax") && !row.localPinned).length,
  currentMigrationArchivesValidated: archives.length, audioBearingArchives: packageRows.filter(row => row.audioPayloads > 0).length, exportedAudioPayloadOccurrences: payloadRows.length,
  uniqueExportedAudioPayloadHashes: new Set(payloadRows.map(row => row.sha256)).size, activeWorldCatalogPayloads: worldCatalogPayloads.length,
  activeWorldCatalogNotificationRows: eventRows.filter(row => row.activeWorldCatalog).length, activeWorldCatalogDirectResolvedRows: eventRows.filter(row => row.activeWorldCatalog && row.exportedDirectPayload).length,
  distinctNativeNotificationRowsInWorldCatalog: new Set(eventRows.filter(row => row.activeWorldCatalog).map(row => JSON.stringify([row.animationSet, row.clip, row.object, row.normalizedTime]))).size,
  mapAmbientSoundObjectDeclarations: mapAudioDeclarations.filter(row => row.className === "AmbientSoundObject").length, mapDecodedAmbientSoundObjects: mapAudioActors.filter(row => row.class === "AmbientSoundObject").length,
  mapMusicVolumeDeclarations: mapAudioDeclarations.filter(row => row.className === "MusicVolume").length, nativeParityPassed: false, observedWorldPlaybackCases: 0 };

const coverage = { schemaVersion: 1, classification: "read-only-bounded-source-export-reference-inventory-not-playback-acceptance",
  sourceAuthority: { sourceHost: sourceLock.sourceHost, sourceRoot: sourceLock.sourceRoot, sourceManifestSha256: hash(read(sourceLockPath)), editionLabel: "interlude", editionCaution: "Exact host/path/hashes govern identity. Similar names, prior E:/ sources or H5 assets are not substitutions. Remote file-list names carry no content hashes.", scope: sourceLock.scope },
  tools: { node: process.version, python: sourcePackages.pythonVersion, esbuild: esbuildVersion, packageReader: "scripts/native_catalog/ue2.py", archiveValidator: "src/assets/package/readAssetPackage.ts" },
  summary, universe: { completeNativeAudioObjectUniverse: false, completeRuntimeCoverage: false, remoteFileInventoryTime: nativeReceipt.finished_at_riga,
    caveat: "Full retained remote filesystem enumeration is a dated name/size census, not audio package object decoding, content hash proof or reachable playback universe. Embedded resources outside UAX/Ogg may also exist.", nativeAudioFiles },
  sourcePackages: sourcePackages.packages, exportPackages: packageRows, exportedPayloads: payloadRows, animationNotifications: eventRows, propertyReferences, referencedSourceMatches,
  sourceMap: { sourcePackageSha256: mapManifest.sourcePackageSha256, rawDeclarationScope: "entire 20_20 map; not necessarily current visible section", declarations: mapAudioDeclarations, decodedAudioActors: mapAudioActors,
    activeSectionAudioFieldPaths: strings(activeSection).filter(row => /sound|music|audio/i.test(row.path)), activeSectionKeys: Object.keys(activeSection) },
  powerStrike: { skillId: 3, sourceFiles: effectManifest.sourceFiles, tableSources: effect.tableSources, soundRow: effect.soundRow, soundDependencies: effectSoundDependencies,
    interpretation: "Original numeric fields and references only; 250/40 are not automatically WebAudio gain/distance. Native trigger mapping, timing, attenuation and selection remain unverified." },
  historicalOggAudit: { files: historicalAudit.files, passed: historicalAudit.passed, failed: historicalAudit.failed, byTopDirectory: tally(historicalAudit.rows.map(row => row.source.split(/[\\/]/)[0])), rows: historicalAudit.rows,
    caveat: "Retained historical wrapper/CRC/encoded-payload validation. This audit does not reread those originals or assert their current IMPORTA identity; source hashes must be joined before reuse. No audible-world or complete export claim." },
  runtime: { lexicalMentions: runtimeMentions, executablePlaybackVerified: false, observedWorldPlaybackCases: [], nativeReferenceComparisons: [],
    caveat: "Source scan records integration candidates at these hashes; it cannot prove playback/reachability. Existing PackagePreview/nativeEventAudio is diagnostic and explicitly omits native conditional/spatial policies. No browser or native runtime was run by this command." },
  categories: categoryRows,
  acceptance: { includesAudio: true, requirements: ["source identity", "native trigger/timing/conditions", "random-selection semantics", "loop/transition behavior", "volume/attenuation/spatial/listener behavior", "browser gesture unlock and usable controls", "actual world playback and event timing", "native-reference differences"],
    statuses: "discovered, pinned, indexed, referenced, exported, runtime-connected, audibly-observed and native-verified are independent; none imply the next", current: "incomplete; silent world or inspector-only playback cannot satisfy 1:1" },
  inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path)) };
// Compare every inspected current migration product with its existing receipt.
for (const entry of coverage.inputs.filter(row => row.path.startsWith(`${migrationRoot}/`))) {
  const productPath = entry.path.slice(migrationRoot.length + 1);
  if (products[productPath]) failUnless(products[productPath] === entry.sha256, `Recorded migration product changed: ${entry.path}`);
}

const report = `# Native audio coverage census — 2026-11-06\n\nAudio is required for 1:1. This report inventories retained source and exports; it does not pass audible playback or native behavior.\n\nRun: \`pnpm exec node scripts/audit-native-audio-coverage.mjs\`. Use \`--output artifacts/native-parity/research/audio-world-20261106/inventory-rerun\` to preserve an earlier run. Source files are read only; outputs stay under the stated evidence root. No browser/native runtime, services, conversion or deployment runs.\n\n## Measured bounds\n\n| Layer | Result |\n| --- | --- |\n| Retained IMPORTA filesystem list | ${summary.retainedNativeUax} UAX and ${summary.retainedNativeOgg} Ogg names; ${nativeReceipt.finished_at_riga}. These names/sizes are not content-hash verification. |\n| Locally pinned UAX | ${summary.stagedPinnedUax} packages, ${summary.indexedSoundObjects} Sound export objects; package hashes, object names/indices/spans/payload hashes rechecked. ${summary.unstagedUax} remotely listed UAX are unstaged. |\n| Current migration | ${summary.currentMigrationArchivesValidated} archives validated through the existing browser validator; ${summary.exportedAudioPayloadOccurrences} audio payload occurrences, ${summary.uniqueExportedAudioPayloadHashes} unique payload hashes. |\n| Active world model catalog | ${summary.activeWorldCatalogPayloads} payloads retained inside model archives; this is availability, not playback. |\n| Full raw 20_20 | ${summary.mapAmbientSoundObjectDeclarations} AmbientSoundObject exports, ${summary.mapDecodedAmbientSoundObjects} decoded ambient actors; ${summary.mapMusicVolumeDeclarations} MusicVolume declarations. |\n| Native audio acceptance | Unverified. No audible world or native comparison was executed. |\n\nMusicVolume0 retains nMusicID 202001; MusicVolume1 retains nMusicID 202002 and bForcePlayMusic=true. Region/file joins and playback behavior remain unresolved. Power Strike retains exact cast/shot sounds and authored volume/radius values; their native interpretation is not inferred.\n\n## Category gaps\n\n${categoryRows.map(row => `- **${row.category}:** ${row.source}. ${row.export}. Next: ${row.remaining}.`).join("\n")}\n\n## Provenance and limits\n\n\`coverage.json\` contains all indexed source objects, exported payload identities, notification rows/properties, exact map declarations, Power Strike source fields, source lexical references and input hashes. The archive source edition label is not permission to substitute older/H5 files. The historical 295-file audit validates Ogg wrappers/CRCs, not this source closure or world playback.\n\nNotification times and properties are serialized evidence, not proof of native dispatch. Random, Surface, Volume, Radius, direct sounds, specialized notification classes and frame timing need separate behavior evidence. The map declaration count is for the full map, not 2,622 audible emitters in the visible section. AmbientVector/Brightness are lighting and excluded from audio classification.\n\nThe source/runtime scan is lexical, not a reachability proof. Keep all categories incomplete until actual behavior is observed. No audio timing tolerances are invented here. Preserve existing visual acceptance and authoring/source protection.\n`;
const files = [];
for (const [name, bytes] of [["coverage.json", JSON.stringify(coverage, null, 2) + "\n"], ["README.md", report]]) { const data = Buffer.from(bytes); writeFileSync(resolve(output, name), data); files.push({ path: name, bytes: data.length, sha256: hash(data) }); }
writeFileSync(resolve(output, "SHA256-MANIFEST.json"), JSON.stringify({ schemaVersion: 1, files }, null, 2) + "\n");
console.log(JSON.stringify({ output: posix(relative(root, output)), summary, files }, null, 2));

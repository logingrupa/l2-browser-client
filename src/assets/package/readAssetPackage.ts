export interface AssetPackageFile { path: string; sha256: string; bytes: number; mime: string }
export interface AssetPackageManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  kind: "model" | "audio" | "texture";
  source: { edition: "interlude"; package: string; object: string; sha256: string; [key: string]: unknown };
  model?: { file: string; unit: "metre"; sourceUnitsPerMetre: number; sourceToGltf: number[] };
  audio?: { file: string };
  image?: { file: string };
  files: AssetPackageFile[];
  limitations: string[];
  animationEvents?: unknown[];
}
export interface AssetPackage { manifest: AssetPackageManifest; files: ReadonlyMap<string, Uint8Array> }
export const assetPackageLimits = { archiveBytes: 128 * 1024 * 1024, fileBytes: 96 * 1024 * 1024, entries: 256 } as const;
const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = crcTable[(crc ^ value) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
function fail(message: string): never { throw new Error(message); }
function safePath(path: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) && path.length <= 240 && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
function storedZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > assetPackageLimits.archiveBytes) fail("This package exceeds the 128 MiB import limit.");
  if (bytes.length < 22) fail("This is not a complete .l2asset package.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The converter writes no ZIP comment. A strict end record also rejects
  // appended content and avoids guessing which of several archives to use.
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) !== 0) fail("Expected a ZIP_STORED .l2asset package from the conversion tool.");
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directory = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || !count || count > assetPackageLimits.entries || directory + directorySize !== end) fail("Split, ZIP64, or oversized archives are unsupported.");
  const files = new Map<string, Uint8Array>(), names = new Set<string>(), spans: [number, number][] = [];
  let cursor = directory;
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail("The package directory is damaged.");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), crc = view.getUint32(cursor + 16, true);
    const packed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameSize = view.getUint16(cursor + 28, true), extraSize = view.getUint16(cursor + 30, true), commentSize = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true), unixType = (view.getUint32(cursor + 38, true) >>> 16) & 0xf000;
    if (view.getUint16(cursor + 6, true) > 20 || flags & ~0x800 || method !== 0 || packed !== size || size > assetPackageLimits.fileBytes || view.getUint16(cursor + 34, true) !== 0 || (unixType !== 0 && unixType !== 0x8000)) fail("Only unencrypted regular ZIP_STORED files up to 96 MiB are supported.");
    if (!nameSize || cursor + 46 + nameSize + extraSize + commentSize > end) fail("A package filename or directory entry is damaged.");
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
    if (!safePath(name) || names.has(name.toLowerCase())) fail("The package contains an unsafe or duplicate file path.");
    names.add(name.toLowerCase());
    if (local + 30 > directory || view.getUint32(local, true) !== 0x04034b50) fail("A package file header is damaged.");
    const localNameSize = view.getUint16(local + 26, true), localExtraSize = view.getUint16(local + 28, true);
    const start = local + 30 + localNameSize + localExtraSize, finish = start + size;
    if (finish > directory || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
      view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== size || view.getUint32(local + 22, true) !== size ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize)) !== name) fail("A package file does not match its directory record.");
    const content = bytes.subarray(start, finish);
    if (crc32(content) !== crc) fail(`The file ${name} failed its ZIP integrity check. Rebuild the package.`);
    files.set(name, content);
    spans.push([local, finish]);
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (cursor !== end) fail("The package directory has unexpected data.");
  spans.sort((a, b) => a[0] - b[0]);
  let next = 0;
  for (const span of spans) { if (span[0] !== next) fail("The package contains overlapping or unlisted archive data."); next = span[1]; }
  if (next !== directory) fail("The package contains unlisted archive data.");
  return files;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 4096; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function validateManifest(input: unknown): AssetPackageManifest {
  if (!record(input) || input.schemaVersion !== 1 || !text(input.id) || !text(input.name) || !["model", "audio", "texture"].includes(String(input.kind))) fail("asset.json has an unsupported schema or asset kind.");
  const source = input.source;
  if (!record(source) || source.edition !== "interlude" || !text(source.package) || !text(source.object) || !hash(source.sha256)) fail("This inspector expects an Interlude package with recorded source identity.");
  if (!Array.isArray(input.files) || !input.files.length || input.files.length >= assetPackageLimits.entries || !input.files.every(file => record(file) && typeof file.path === "string" && safePath(file.path) && file.path.toLowerCase() !== "asset.json" && hash(file.sha256) && Number.isSafeInteger(file.bytes) && Number(file.bytes) >= 0 && Number(file.bytes) <= assetPackageLimits.fileBytes && text(file.mime))) fail("asset.json has an invalid file inventory.");
  if (!Array.isArray(input.limitations) || !input.limitations.every(value => typeof value === "string") || (input.animationEvents !== undefined && !Array.isArray(input.animationEvents))) fail("asset.json has invalid limitation or animation-event metadata.");
  const entry = input.kind === "model" ? input.model : input.kind === "audio" ? input.audio : input.image;
  if (!record(entry) || typeof entry.file !== "string" || !safePath(entry.file)) fail("asset.json does not identify the asset file.");
  if (input.kind === "model" && (entry.unit !== "metre" || typeof entry.sourceUnitsPerMetre !== "number" || !Number.isFinite(entry.sourceUnitsPerMetre) || entry.sourceUnitsPerMetre <= 0 || !Array.isArray(entry.sourceToGltf) || entry.sourceToGltf.length !== 16 || !entry.sourceToGltf.every(Number.isFinite))) fail("The model needs its metre unit and source transform recorded by the converter.");
  return input as unknown as AssetPackageManifest;
}

/** Verify every file before creating Babylon, image, or audio resources. */
export async function readAssetPackage(input: ArrayBuffer | Uint8Array): Promise<AssetPackage> {
  const files = storedZip(input instanceof Uint8Array ? input : new Uint8Array(input));
  const descriptor = files.get("asset.json");
  if (!descriptor || descriptor.length > 1024 * 1024) fail("The package needs a root asset.json smaller than 1 MiB.");
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(descriptor)); } catch { fail("asset.json is not valid UTF-8 JSON."); }
  const manifest = validateManifest(parsed), listed = new Set<string>();
  for (const file of manifest.files) {
    if (listed.has(file.path.toLowerCase())) fail("asset.json lists the same file more than once.");
    listed.add(file.path.toLowerCase());
    const content = files.get(file.path);
    if (!content || content.length !== file.bytes || await sha256(content) !== file.sha256) fail(`The file ${file.path} failed its SHA-256 check. Rebuild the package.`);
  }
  if (files.size !== manifest.files.length + 1) fail("The package contains files absent from its verified inventory.");
  const main = manifest.kind === "model" ? manifest.model!.file : manifest.kind === "audio" ? manifest.audio!.file : manifest.image!.file;
  if (!files.has(main) || !listed.has(main.toLowerCase())) fail("The asset file is missing from the verified inventory.");
  files.delete("asset.json");
  return { manifest, files };
}

/** A self-contained GLB prevents dropped content from requesting other files or remote URLs. */
export interface PackageModelInfo {
  animations: { name: string | null; nativeDurationSeconds: number | null }[];
  meshes: { name: string | null; primitives: number }[];
}
export function validatePackageModel(bytes: Uint8Array): PackageModelInfo {
  if (bytes.length < 20) fail("The model is not a complete binary glTF file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a) fail("The model must be a glTF 2 binary (.glb).");
  const jsonSize = view.getUint32(12, true);
  if (jsonSize > 32 * 1024 * 1024 || 20 + jsonSize > bytes.length) fail("The model JSON chunk is damaged or too large.");
  let json: unknown;
  try { json = JSON.parse(decoder.decode(bytes.subarray(20, 20 + jsonSize))); } catch { fail("The model JSON chunk is damaged."); }
  if (!record(json) || !record(json.asset) || json.asset.version !== "2.0") fail("The model has no valid glTF 2 asset record.");
  const stack: unknown[] = [json];
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) { for (const child of item) if (typeof child === "object" && child !== null) stack.push(child); }
    else if (record(item)) for (const [key, value] of Object.entries(item)) {
      if (key === "uri" && (typeof value !== "string" || !value.startsWith("data:"))) fail("The GLB references external content. Rebuild it with all buffers and textures embedded.");
      if (typeof value === "object" && value !== null) stack.push(value);
    }
  }
  const animations: PackageModelInfo["animations"] = [];
  if (json.animations !== undefined && !Array.isArray(json.animations)) fail("The model animation list is invalid.");
  for (const animation of (json.animations ?? []) as unknown[]) {
    if (!record(animation)) fail("The model contains an invalid animation.");
    const duration = record(animation.extras) ? animation.extras.nativeDurationSeconds : undefined;
    if (duration !== undefined && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0)) fail("The model contains an invalid native clip duration.");
    animations.push({ name: typeof animation.name === "string" ? animation.name : null, nativeDurationSeconds: typeof duration === "number" ? duration : null });
  }
  if (json.meshes !== undefined && !Array.isArray(json.meshes)) fail("The model mesh list is invalid.");
  const meshes = ((json.meshes ?? []) as unknown[]).map(mesh => {
    if (!record(mesh) || !Array.isArray(mesh.primitives)) fail("The model contains an invalid mesh.");
    return { name: typeof mesh.name === "string" ? mesh.name : null, primitives: mesh.primitives.length };
  });
  return { animations, meshes };
}

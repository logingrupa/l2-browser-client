import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { _DDSTextureLoader } from "@babylonjs/core/Materials/Textures/Loaders/ddsTextureLoader";
import { registerTextureLoader } from "@babylonjs/core/Materials/Textures/Loaders/textureLoaderManager";

interface FileEntry { path: string; bytes: number; sha256: string; }
interface AssetManifest { id: string; kind: string; image?: { file: string }; files: FileEntry[]; }
interface DDSManifest {
  file: string; sha256: string; bytes: number; width: number; height: number; mipCount: number; completeTo1x1: boolean;
  source: { object: string; package: string; packageSha256: string; sourceExportSha256: string };
  mips: { level: number; width: number; height: number; bytes: number; sourceSha256: string }[];
  consumer: { headerParserCompatible: boolean; mipUploadPolicy: string };
}
interface MigrationCoverage { jobs: { id: string; path: string; support: string; adapter?: string; recipe?: string }[]; }
interface EffectBundle { assets: { archive: string }[]; }
interface TextureResult {
  id: string; assetManifestURL: string; ddsManifestSha256: string; ddsSha256: string; verifiedBytes: number;
  width: number; height: number; mipCount: number; completeTo1x1: boolean; consumerPolicy: string;
  source: DDSManifest["source"]; expectedMips: DDSManifest["mips"]; ready: boolean; mipmapSamplingEnabled: boolean;
}
function element<T extends HTMLElement>(id: string, kind: { new(): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof kind)) throw new Error(`Missing ${id}.`);
  return value;
}
const canvas = element("texture-canvas", HTMLCanvasElement), status = element("texture-status", HTMLParagraphElement);
const renderer = element("renderer", HTMLParagraphElement);
const engine = new Engine(canvas, false, { preserveDrawingBuffer: true, stencil: false });
engine.setHardwareScalingLevel(1);
const gl = engine._gl;
const glErrors: { stage: string; error: number }[] = [];
function checkGl(stage: string) {
  for (let count = 0; count < 16; count++) {
    const error = gl.getError();
    if (error === gl.NO_ERROR) break;
    glErrors.push({ stage, error });
  }
}
const uploads: { url: string; format: number; width: number; height: number; face: number; level: number; bytes: number; sha256: string }[] = [];
const pendingHashes: Promise<void>[] = [];
async function sha(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
}
const upload = engine._uploadCompressedDataToTextureDirectly.bind(engine);
engine._uploadCompressedDataToTextureDirectly = (...args) => {
  const [texture, format, width, height, bytes, face, level] = args;
  const copy = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
  pendingHashes.push(sha(copy.buffer).then(hash => { uploads.push({ url: texture.url ?? "", format, width, height,
    face: face ?? 0, level: level ?? 0, bytes: copy.byteLength, sha256: hash }); }));
  upload(...args);
  checkGl(`upload:${texture.url}:${level ?? 0}`);
};
registerTextureLoader(".dds", () => new _DDSTextureLoader());
const scene = new Scene(engine);
scene.clearColor = new Color4(.08, .11, .14, 1);
const camera = new FreeCamera("DDS inspection camera", new Vector3(0, 0, -5), scene);
camera.setTarget(Vector3.Zero()); camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
camera.minZ = .1; camera.maxZ = 20;
function resize() {
  engine.resize();
  camera.orthoLeft = -2.6; camera.orthoRight = 2.6;
  camera.orthoTop = 2.6 * engine.getRenderHeight() / engine.getRenderWidth();
  camera.orthoBottom = -camera.orthoTop;
}
resize(); window.addEventListener("resize", resize);
let ready = false, failure: string | null = null, renders = 0;
const textures: TextureResult[] = [];
engine.runRenderLoop(() => { scene.render(); renders++; if (renders <= 20) checkGl("render"); });
window.addEventListener("pagehide", () => { scene.dispose(); engine.dispose(); }, { once: true });
const capabilities = { s3tc: Boolean(engine.getCaps().s3tc), webGLVersion: engine.webGLVersion, ...engine.getGlInfo() };
renderer.textContent = `${capabilities.renderer} · WebGL ${capabilities.webGLVersion} · S3TC ${capabilities.s3tc ? "available" : "unavailable"}`;
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load ${url}: ${response.status}`);
  return await response.json() as T;
}
async function verified(url: string, entry: Pick<FileEntry, "bytes" | "sha256">): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== entry.bytes || await sha(bytes) !== entry.sha256) throw new Error(`Hash/length mismatch: ${url}`);
  return bytes;
}
function file(asset: AssetManifest, path: string): FileEntry {
  const row = asset.files.find(candidate => candidate.path === path);
  if (!row) throw new Error(`${asset.id} has no ${path}; rerun pnpm assets:migrate.`);
  return row;
}
async function findAssets(root: URL): Promise<Map<string, { asset: AssetManifest; url: string }>> {
  const coverage = await json<MigrationCoverage>(new URL("coverage.json", root).href);
  const urls: URL[] = [];
  for (const job of coverage.jobs) {
    if (job.support === "failed") continue;
    if (job.path.endsWith("/asset.l2asset")) urls.push(new URL("asset.json", new URL(job.path, root)));
    else if (job.recipe === "recipes/native-power-strike.json") {
      const bundleUrl = new URL(job.path, root);
      const bundle = await json<EffectBundle>(bundleUrl.href);
      for (const entry of bundle.assets) urls.push(new URL("asset.json", new URL(entry.archive, bundleUrl)));
    }
  }
  const result = new Map<string, { asset: AssetManifest; url: string }>();
  for (const url of urls) {
    const asset = await json<AssetManifest>(url.href);
    if (result.has(asset.id)) throw new Error(`Duplicate active asset: ${asset.id}`);
    result.set(asset.id, { asset, url: url.href });
  }
  return result;
}
async function drawTexture(asset: AssetManifest, url: string, x: number): Promise<void> {
  if (asset.image?.file !== "texture.png") throw new Error("Editable PNG must remain the asset primary.");
  const source = file(asset, "native-texture-dds.json");
  const metadata = JSON.parse(new TextDecoder().decode(await verified(new URL(source.path, url).href, source))) as DDSManifest;
  if (!metadata.consumer.headerParserCompatible) throw new Error("Pinned Babylon DDS header parser cannot read this file.");
  const ddsFile = file(asset, metadata.file);
  const bytes = await verified(new URL(metadata.file, url).href, ddsFile);
  if (metadata.sha256 !== ddsFile.sha256 || metadata.bytes !== bytes.byteLength) throw new Error("DDS metadata disagrees with asset manifest.");
  const texture = await new Promise<Texture>((resolve, reject) => {
    const loaded = new Texture(`data:${asset.id}.dds`, scene, {
      noMipmap: false, invertY: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
      buffer: new Uint8Array(bytes), forcedExtension: ".dds",
      onLoad: () => resolve(loaded), onError: message => reject(new Error(message ?? "DDS load failed")),
    });
  });
  const material = new StandardMaterial(asset.id, scene);
  material.disableLighting = true; material.emissiveColor = Color3.Black(); material.emissiveTexture = texture;
  material.diffuseColor = Color3.Black(); material.specularColor = Color3.Black(); material.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane(asset.id, { width: 2, height: 2 * metadata.height / metadata.width }, scene);
  plane.position.x = x; plane.material = material;
  textures.push({ id: asset.id, assetManifestURL: url, ddsManifestSha256: source.sha256, ddsSha256: ddsFile.sha256,
    verifiedBytes: bytes.byteLength, width: metadata.width, height: metadata.height, mipCount: metadata.mipCount,
    completeTo1x1: metadata.completeTo1x1, consumerPolicy: metadata.consumer.mipUploadPolicy,
    source: metadata.source, expectedMips: metadata.completeTo1x1 ? metadata.mips : metadata.mips.slice(0, 1),
    ready: texture.isReady(), mipmapSamplingEnabled: texture.getInternalTexture()?.generateMipMaps ?? false });
}
async function framebufferSamples() {
  scene.render(); checkGl("before-readback");
  const result = [];
  for (const center of [-1.25, 1.25]) {
    const x = Math.round((center + 2.6) / 5.2 * engine.getRenderWidth()) - 32;
    const y = Math.round(engine.getRenderHeight() / 2) - 32;
    const pixels = await engine.readPixels(x, y, 64, 64);
    const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice();
    const colors = new Set<number>();
    for (let index = 0; index < bytes.length; index += 4) colors.add((bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!);
    result.push({ x, y, width: 64, height: 64, distinctRGB: colors.size, sha256: await sha(bytes.buffer) });
  }
  checkGl("after-readback"); return result;
}
function snapshot() {
  return { ready, failure, renders, capabilities, glErrors, textures, uploads, userAgent: navigator.userAgent,
    camera: { position: camera.position.asArray(), target: camera.getTarget().asArray(), mode: "orthographic",
      left: camera.orthoLeft, right: camera.orthoRight, top: camera.orthoTop, bottom: camera.orthoBottom, minZ: camera.minZ, maxZ: camera.maxZ },
    viewport: { width: engine.getRenderWidth(), height: engine.getRenderHeight(), dpr: window.devicePixelRatio },
    presentation: { material: "unlit emissive", textureInvertY: false, alphaUsed: false, nativeParity: "unverified" },
    benchmark: false };
}
declare global { interface Window { __nativeTexture?: { snapshot: typeof snapshot; framebufferSamples: typeof framebufferSamples }; } }
window.__nativeTexture = { snapshot, framebufferSamples };
export type NativeTextureSnapshot = ReturnType<typeof snapshot>;
void (async () => {
  if (!capabilities.s3tc) throw new Error("S3TC unavailable; compressed DDS cannot be tested on this renderer.");
  const migration = new URL(new URLSearchParams(location.search).get("migration") ?? "/artifacts/native-parity/migration/", location.href);
  if (migration.origin !== location.origin) throw new Error("Migration fixtures must be same-origin local outputs.");
  const assets = await findAssets(migration);
  const choices = [["interlude:t_oren.OST_10", -1.25, "complete-label"],
    ["interlude:LineageEffectsTextures.Spark.fx_m_t0042", 1.25, "partial-label"]] as const;
  for (const [id, x, label] of choices) {
    const entry = assets.get(id);
    if (!entry) throw new Error(`Missing active migration asset: ${id}`);
    await drawTexture(entry.asset, entry.url, x);
    const result = textures[textures.length - 1]!;
    element(label, HTMLSpanElement).textContent = `${id} · ${result.mipCount} authored mips · ${result.consumerPolicy}`;
  }
  await scene.whenReadyAsync(); await Promise.all(pendingHashes); checkGl("ready");
  ready = true; status.textContent = "Two original DDS textures ready · exact source hashes verified · native material parity unverified";
})().catch(error => { failure = String(error); status.textContent = failure; console.error(error); });

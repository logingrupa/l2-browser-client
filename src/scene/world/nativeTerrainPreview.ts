import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { sha256 } from "../../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { terrainMaterialBindingKey } from "./nativeTerrainPatch";

interface Layer { index: number; texture: string; alphaMap: string; worldToTextureRowMajor: number[][]; }
interface TextureRecord { assetId: string; image: string; imageSha256: string; imageBytes: number; archiveSha256: string; }
export interface NativePreviewPixels { width: number; height: number; rgba: Uint8Array<ArrayBuffer>; }
export interface NativeTerrainPreview {
  readonly status: "candidate-source-textures";
  readonly samplerCount: number;
  readonly details: readonly string[];
  setEnabled(enabled: boolean): void;
  dispose(): void;
}
const HASH = /^[a-f0-9]{64}$/;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, length: number): value is number[] => Array.isArray(value) && value.length === length && value.every(item => typeof item === "number" && Number.isFinite(item));

/** Decode this exporter's RGB/RGBA8 PNGs directly. Canvas/ImageBitmap drawing
 * would premultiply partially transparent mask channels before readback. */
export async function decodeNativePreviewPng(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<NativePreviewPixels> {
  signal.throwIfAborted();
  if (bytes.length < 45 || bytes.length > 32 * 1024 * 1024 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((value, i) => bytes[i] !== value)) throw new Error("Native preview texture is not a bounded PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), blocks: Uint8Array<ArrayBuffer>[] = [];
  let width = 0, height = 0, channels = 0, offset = 8, ended = false, idatEnded = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (length > bytes.length - offset - 12) throw new Error("Native preview PNG chunk exceeds file.");
    const begin = offset + 8, end = begin + length;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) throw new Error("Native preview PNG header order is invalid.");
      width = view.getUint32(begin); height = view.getUint32(begin + 4);
      channels = bytes[begin + 9] === 2 ? 3 : bytes[begin + 9] === 6 ? 4 : 0;
      if (!channels || width < 1 || height < 1 || width > 1024 || height > 1024 || bytes[begin + 8] !== 8 ||
        bytes[begin + 10] !== 0 || bytes[begin + 11] !== 0 || bytes[begin + 12] !== 0) throw new Error("Native preview supports only noninterlaced RGB/RGBA8 PNGs up to 1024 pixels.");
    } else if (type === "IDAT") {
      if (!width || idatEnded) throw new Error("Native preview PNG data order is invalid.");
      blocks.push(bytes.slice(begin, end));
    } else {
      if (blocks.length) idatEnded = true;
      if (type === "IEND") { if (length || end + 4 !== bytes.length) throw new Error("Native preview PNG has trailing data."); ended = true; break; }
      if (type === "tRNS" || (type.charCodeAt(0) & 32) === 0) throw new Error(`Native preview PNG chunk is unsupported: ${type}`);
    }
    offset = end + 4;
  }
  if (!ended || !blocks.length || !channels) throw new Error("Native preview PNG is incomplete.");
  // Hash verification at the fetch boundary covers PNG CRC/chunk bytes. Bound
  // decompression separately rather than trusting a compressed allocation size.
  const stride = width * channels, expected = (stride + 1) * height, packed = new Uint8Array(expected);
  const reader = new Blob(blocks).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let used = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      if (used + part.value.length > expected) throw new Error("Native preview PNG decompressed size exceeds dimensions.");
      packed.set(part.value, used); used += part.value.length;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  signal.throwIfAborted();
  if (used !== expected) throw new Error("Native preview PNG decompressed size differs from dimensions.");
  const scan = new Uint8Array(stride * height), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)]!;
    if (filter > 4) throw new Error("Native preview PNG filter is invalid.");
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? scan[y * stride + x - channels]! : 0;
      const above = y ? scan[(y - 1) * stride + x]! : 0;
      const upperLeft = y && x >= channels ? scan[(y - 1) * stride + x - channels]! : 0;
      const p = left + above - upperLeft, a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - upperLeft);
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : a <= b && a <= c ? left : b <= c ? above : upperLeft;
      scan[y * stride + x] = packed[y * (stride + 1) + 1 + x]! + prediction;
    }
  }
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = scan[pixel * channels]!; rgba[pixel * 4 + 1] = scan[pixel * channels + 1]!;
    rgba[pixel * 4 + 2] = scan[pixel * channels + 2]!; rgba[pixel * 4 + 3] = channels === 4 ? scan[pixel * channels + 3]! : 255;
  }
  return { width, height, rgba };
}

export function packNativePreviewMasks(masks: readonly NativePreviewPixels[]): NativePreviewPixels {
  const first = masks[0];
  if (!first || masks.length > 4 || masks.some(mask => mask.width !== first.width || mask.height !== first.height || mask.rgba.length !== first.width * first.height * 4)) {
    throw new Error("Native preview masks must have matching dimensions and one to four channels.");
  }
  const rgba = new Uint8Array(first.width * first.height * 4);
  for (const [channel, mask] of masks.entries()) for (let pixel = 0; pixel < first.width * first.height; pixel++) {
    const start = pixel * 4, value = mask.rgba[start]!;
    if (mask.rgba[start + 1] !== value || mask.rgba[start + 2] !== value || mask.rgba[start + 3] !== value) {
      throw new Error("Native preview mask RGBA channels differ; scalar channel semantics require review.");
    }
    rgba[start + channel] = value;
  }
  return { width: first.width, height: first.height, rgba };
}

function layersFor(mesh: AbstractMesh): Layer[] {
  const metadata: unknown = mesh.metadata;
  const extras = isObject(metadata) && isObject(metadata.gltf) ? metadata.gltf.extras : null;
  const layers = isObject(extras) ? extras.nativeLayers : null;
  if (!Array.isArray(layers) || layers.length !== 9 || !mesh.isVerticesDataPresent("uv")) throw new Error("Native preview requires the nine retained terrain layers and mask UVs.");
  for (const [index, layer] of layers.entries()) {
    if (!isObject(layer) || layer.index !== index || typeof layer.texture !== "string" || typeof layer.alphaMap !== "string" ||
      !Array.isArray(layer.worldToTextureRowMajor) || layer.worldToTextureRowMajor.length !== 4 || !layer.worldToTextureRowMajor.every(row => finite(row, 4))) {
      throw new Error("Native preview layer identity or source UV matrix is invalid.");
    }
  }
  return layers as Layer[];
}

function textureRecords(catalog: unknown): Map<string, TextureRecord> {
  if (!isObject(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.textures)) throw new Error("Native preview textures are not staged.");
  const records = new Map<string, TextureRecord>();
  for (const record of catalog.textures as unknown[]) {
    if (!isObject(record) || typeof record.assetId !== "string" || !record.assetId.startsWith("interlude:") ||
      typeof record.archiveSha256 !== "string" || !HASH.test(record.archiveSha256) || typeof record.imageSha256 !== "string" || !HASH.test(record.imageSha256) ||
      typeof record.image !== "string" || !new RegExp(`^/l2/${record.archiveSha256}/[A-Za-z0-9._-]+\\.png$`).test(record.image) ||
      !Number.isSafeInteger(record.imageBytes) || typeof record.imageBytes !== "number" || record.imageBytes <= 0 || record.imageBytes > 32 * 1024 * 1024 ||
      records.has(record.assetId.toLowerCase())) throw new Error("Native preview texture catalog identity/hash/path is invalid.");
    records.set(record.assetId.toLowerCase(), record as unknown as TextureRecord);
  }
  return records;
}

/** Optional, explicitly unverified source-texture visualization. Nothing changes
 * until all inputs and the shader are ready; callers retain neutral fallback. */
export async function applyNativeTerrainPreview(scene: Scene, meshes: readonly AbstractMesh[], catalog: unknown, signal: AbortSignal): Promise<NativeTerrainPreview> {
  signal.throwIfAborted();
  if (!meshes.length || scene.isDisposed || !scene.useRightHandedSystem) throw new Error("Native preview requires live right-handed terrain.");
  const layers = layersFor(meshes[0]!);
  // Provenance differs between separately qualified sectors. Sharing is safe
  // only when every field consumed by this shader is identical; keep metadata.
  if (meshes.some(mesh => terrainMaterialBindingKey(layersFor(mesh)) !== terrainMaterialBindingKey(layers))) throw new Error("Native preview terrain layer bindings differ between meshes.");
  if (scene.getEngine().getCaps().maxTexturesImageUnits < 12) throw new Error("Native preview requires 12 fragment texture samplers.");
  const records = textureRecords(catalog), textures: RawTexture[] = [], original = meshes.map(mesh => ({ mesh, material: mesh.material }));
  const lifetime = new AbortController();
  let material: ShaderMaterial | undefined, disposed = false, committed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort();
    signal.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(observer);
    for (const entry of original) if (!entry.mesh.isDisposed() && entry.mesh.material === material) entry.mesh.material = entry.material;
    material?.dispose(false, false); textures.forEach(texture => texture.dispose());
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  const alive = () => { signal.throwIfAborted(); if (disposed || scene.isDisposed) throw new Error("Native preview was disposed during loading."); };
  const compile = async (candidate: ShaderMaterial, mesh: AbstractMesh) => {
    alive();
    let cancel!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("Native preview compilation was aborted.", "AbortError"));
      lifetime.signal.addEventListener("abort", cancel, { once: true });
    });
    try { await Promise.race([candidate.forceCompilationAsync(mesh), aborted]); alive(); }
    finally { lifetime.signal.removeEventListener("abort", cancel); }
  };
  const decoded = new Map<string, NativePreviewPixels>();
  const load = async (reference: string) => {
    const key = `interlude:${reference}`.toLowerCase(), existing = decoded.get(key);
    if (existing) return existing;
    const record = records.get(key);
    if (!record) throw new Error(`Native preview texture is unstaged: ${reference}`);
    const response = await fetch(nativeResourceUrl(record.image), { signal: lifetime.signal });
    if (!response.ok) throw new Error(`Native preview texture returned HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer()); alive();
    if (bytes.length !== record.imageBytes || await sha256(bytes) !== record.imageSha256) throw new Error(`Native preview texture hash/length differs: ${reference}`);
    const pixels = await decodeNativePreviewPng(bytes, lifetime.signal); alive(); decoded.set(key, pixels); return pixels;
  };
  const texture = (pixels: NativePreviewPixels, name: string, wrap: boolean) => {
    alive();
    const value = RawTexture.CreateRGBATexture(pixels.rgba, pixels.width, pixels.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    value.name = name; value.gammaSpace = false; value.wrapU = value.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
    textures.push(value); return value;
  };
  try {
    const diffuse: NativePreviewPixels[] = [], masks: NativePreviewPixels[] = [];
    for (const layer of layers) { diffuse.push(await load(layer.texture)); masks.push(await load(layer.alphaMap)); }
    if (diffuse.some(image => image.width !== 256 || image.height !== 256) || masks.some((image, index) => image.width !== (index === 0 ? 256 : index === 6 ? 512 : 1024) || image.height !== image.width)) {
      throw new Error("Native preview texture dimensions differ from the reviewed map layers.");
    }
    if (masks[0]!.rgba.some(value => value !== 255)) throw new Error("Native preview base mask is not constant white.");
    const groups = [[1, 2, 3, 4], [5, 7, 8], [6]], packed = groups.map(group => packNativePreviewMasks(group.map(index => masks[index]!)));
    const f = (value: number) => Number.isInteger(value) ? `${value}.0` : value.toPrecision(17);
    const uv = (layer: Layer) => [0, 1].map(axis => `dot(nativePoint,vec4(${layer.worldToTextureRowMajor.map(row => f(row[axis]!)).join(",")}))`).join(",");
    const weight = (index: number) => { const group = groups.findIndex(indices => indices.includes(index)); return `texture2D(mask${group},vMaskUV).${"rgba"[groups[group]!.indexOf(index)]}`; };
    const vertexSource = `precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection;
varying vec3 vNativePosition; varying vec2 vMaskUV;
void main(){vNativePosition=position.xzy*100.0;vMaskUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;
    const fragmentSource = `precision highp float; varying vec3 vNativePosition; varying vec2 vMaskUV;
${layers.map(layer => `uniform sampler2D layer${layer.index};`).join("\n")}
uniform sampler2D mask0;uniform sampler2D mask1;uniform sampler2D mask2;
void main(){vec4 nativePoint=vec4(vNativePosition,1.0);vec3 color=texture2D(layer0,vec2(${uv(layers[0]!)})).rgb;
${layers.slice(1).map(layer => `color=mix(color,texture2D(layer${layer.index},vec2(${uv(layer)})).rgb,${weight(layer.index)});`).join("\n")}
gl_FragColor=vec4(color,1.0);}`;
    material = new ShaderMaterial("Native terrain source-texture candidate · unverified blending", scene, { vertexSource, fragmentSource }, {
      attributes: ["position", "uv"], uniforms: ["worldViewProjection"], samplers: [...layers.map(layer => `layer${layer.index}`), "mask0", "mask1", "mask2"],
    });
    for (const layer of layers) material.setTexture(`layer${layer.index}`, texture(diffuse[layer.index]!, layer.texture, true));
    for (const [index, pixels] of packed.entries()) material.setTexture(`mask${index}`, texture(pixels, `native-mask-byte-pack-${index}`, false));
    for (const mesh of meshes) await compile(material, mesh);
    const setEnabled = (enabled: boolean) => {
      if (disposed || !committed) return;
      for (const entry of original) if (!entry.mesh.isDisposed()) {
        if (enabled && entry.mesh.material === entry.material) entry.mesh.material = material!;
        else if (!enabled && entry.mesh.material === material) entry.mesh.material = entry.material;
      }
    };
    committed = true; setEnabled(true);
    return { status: "candidate-source-textures", samplerCount: 12, details: [
      "Exact source diffuse UV matrices and PNG pixel bytes; no geometry edits or resampling.",
      "Candidate ordered overwrite blend, geometry mask UV, unlit encoded-color output and bilinear mip0 sampling; native rendering remains unverified.",
      "Equal RGBA mask channels are byte-packed into same-size GPU textures; original textures remain unchanged.",
    ], setEnabled, dispose };
  } catch (error) { dispose(); throw error; }
}

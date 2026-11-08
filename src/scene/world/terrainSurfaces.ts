import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Materials/Textures/renderTargetTexture';


const SOURCE = 'feeee654b2804b11fe7df871d912251cf65d6210';
const SHA256 = /^[a-f0-9]{64}$/;
const TILES = ['16_24', '16_25', '17_24', '17_25'];

interface Landmark { sourceVertex: number; canonicalWorld: [number, number, number]; sourceUV0: [number, number]; }
interface SourceLayer { layer: number; file: string; width: number; height: number; repeat: number[]; offset: number[]; }
interface SourceMask { file: string; width: number; height: number; channels: (number | null)[]; }
interface BlendSample { uv: number[]; linearRGB: number[]; srgbRGBBytes: number[]; }
interface RuntimeSurface {
  method: string;
  maskPacking?: string;
  layers: SourceLayer[];
  masks: SourceMask[];
  samplers: number;
  samples: BlendSample[];
}
interface Tile {
  tile: string;
  texture: string;
  size: number;
  detailLayers: number;
  sourceUnityOrigin: [number, number, number];
  sourceUnityScale: [number, number, number];
  landmarks: Landmark[];
  limitation: string | null;
  runtime?: RuntimeSurface;
}
export interface SurfaceManifest {
  schemaVersion: number;
  sourceRoute: string;
  sourceVersion: string;
  tiles: Tile[];
  files: { file: string; sha256: string }[];
  limitations: string[];
}
export interface SurfaceInspection {
  ready: boolean;
  sourceVersion: string;
  texturedTiles: number;
  method: 'source-layers' | 'baked-diffuse' | 'mixed';
  tiles: { tile: string; vertices: number; detailLayers: number; texture: string; landmarkErrors: number[]; limitation: string | null;
    method: 'source-layers' | 'baked-diffuse'; samplers: number; blendPixelErrors: number[]; fallbackReason?: string | undefined }[];
  limitations: string[];
}

const finite = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(Number.isFinite);

const vertexSource = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float probeMode;
varying vec2 vUV;
varying vec3 vNormal;
void main(void) {
  vUV = uv;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = probeMode > 0.5 ? vec4(position.xy, 0.0, 1.0) : worldViewProjection * vec4(position, 1.0);
}`;

function decodeBeforeInterpolationMaskFunction(maskIndex: number): string {
  return `vec4 sourceMask${maskIndex}(vec2 sourceUV, vec2 size) {
  vec2 p = vec2(sourceUV.y, 1.0 - sourceUV.x) * size - 0.5;
  vec2 base = (floor(p) + 0.5) / size;
  vec2 t = fract(p);
  vec4 a = decodeSRGB(texture2D(masks${maskIndex}, base));
  vec4 b = decodeSRGB(texture2D(masks${maskIndex}, base + vec2(1.0, 0.0) / size));
  vec4 c = decodeSRGB(texture2D(masks${maskIndex}, base + vec2(0.0, 1.0) / size));
  vec4 d = decodeSRGB(texture2D(masks${maskIndex}, base + vec2(1.0, 1.0) / size));
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}`;
}

export function sourceLayerDiffuseFragmentSource(runtime: RuntimeSurface): string {
  const f = (value: number) => value.toFixed(12);
  const sampleLayer = (layer: SourceLayer) => `texture2D(layer${layer.layer}, sourceUV * vec2(${layer.repeat.map(f).join(',')}) + vec2(${layer.offset.map(f).join(',')})).rgb`;
  const weightFor = (layer: SourceLayer) => {
    const index = runtime.masks.findIndex(mask => mask.channels.includes(layer.layer));
    return `weights${index}.${'rgba'[runtime.masks[index]!.channels.indexOf(layer.layer)]}`;
  };
  return `
precision highp float;
varying vec2 vUV;
varying vec3 vNormal;
uniform float probeMode;
uniform vec2 probeUV;
uniform vec3 lightDirection;
${runtime.layers.map(layer => `uniform sampler2D layer${layer.layer};`).join('\n')}
${runtime.masks.map((_, index) => `uniform sampler2D masks${index};`).join('\n')}
vec4 decodeSRGB(vec4 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec4(2.4)), step(vec4(0.04045), c));
}
vec3 encodeSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
${runtime.masks.map((_, index) => decodeBeforeInterpolationMaskFunction(index)).join('\n')}
void main(void) {
  vec2 sourceUV = probeMode > 0.5 ? probeUV : vUV;
  ${runtime.masks.map((mask, index) => `vec4 weights${index} = sourceMask${index}(sourceUV, vec2(${f(mask.width)},${f(mask.height)}));`).join('\n')}
  vec3 color = ${sampleLayer(runtime.layers[0]!)};
  ${runtime.layers.slice(1).map(layer => `color = mix(color, ${sampleLayer(layer)}, ${weightFor(layer)});`).join('\n')}
  float light = probeMode > 0.5 ? 1.0 : 0.45 + 0.55 * max(dot(normalize(vNormal), normalize(lightDirection)), 0.0);
  gl_FragColor = vec4(encodeSRGB(color * light), 1.0);
}`;
}

function validateRuntime(runtime: RuntimeSurface): void {
  const channels = runtime.method === 'source-layers-v2' && runtime.maskPacking === 'opaque-rgb' ? 3 : 4;
  if (!(runtime.method === 'source-layers-v1' || (runtime.method === 'source-layers-v2' && channels === 3)) ||
      !Array.isArray(runtime.layers) || !Array.isArray(runtime.masks) ||
      !Array.isArray(runtime.samples) || runtime.samples.length < 3 || runtime.samples.length > 12 || runtime.layers[0]?.layer !== 0 ||
      runtime.samplers !== runtime.layers.length + runtime.masks.length || runtime.samplers > 13 || runtime.masks.length > 3) {
    throw new Error('Invalid terrain runtime layer or sampler budget.');
  }
  const layers = new Set<number>();
  for (const layer of runtime.layers) {
    if (!Number.isInteger(layer.layer) || layer.layer < 0 || layer.layer > 9 || layers.has(layer.layer) ||
        !finite(layer.repeat, 2) || !finite(layer.offset, 2) || !Number.isInteger(layer.width) || !Number.isInteger(layer.height) ||
        layer.width <= 0 || layer.width > 1024 || layer.height <= 0 || layer.height > 1024) throw new Error('Invalid terrain runtime diffuse layer.');
    layers.add(layer.layer);
    if (layer.layer && runtime.masks[Math.floor((layer.layer - 1) / channels)]?.channels[(layer.layer - 1) % channels] !== layer.layer) {
      throw new Error('Terrain mask channel does not match its source layer.');
    }
  }
  if (runtime.layers.some((layer, index) => index > 0 && layer.layer <= runtime.layers[index - 1]!.layer)) {
    throw new Error('Terrain layers must retain source blend order.');
  }
  for (const mask of runtime.masks) {
    if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 1 || mask.height < 1 ||
        mask.width > 1024 || mask.height > 1024 || mask.channels.length !== channels) throw new Error('Invalid terrain runtime mask dimensions.');
  }
}

async function verifyBlendPixelsByGpuReadback(scene: Scene, material: ShaderMaterial, samples: BlendSample[]): Promise<number[]> {
  const plane = CreatePlane('surface-blend-probe', { size: 2 }, scene);
  plane.material = material; plane.isPickable = false; plane.isVisible = false; plane.alwaysSelectAsActiveMesh = true;
  const target = new RenderTargetTexture('surface-blend-probe', 1, scene, { generateMipMaps: false, generateDepthBuffer: false });
  target.renderList = [plane]; target.clearColor = new Color4(0, 0, 0, 0); target.ignoreCameraViewport = true;
  const errors: number[] = [];
  const culling = material.backFaceCulling;
  try {
    await material.forceCompilationAsync(plane);
    for (const sample of samples) {
      if (!finite(sample.uv, 2) || !finite(sample.srgbRGBBytes, 3)) throw new Error('Invalid terrain blend validation point.');
      material.setFloat('probeMode', 1); material.setVector2('probeUV', Vector2.FromArray(sample.uv));
      material.backFaceCulling = false; plane.isVisible = true;
      try { target.render(false); } finally { plane.isVisible = false; material.setFloat('probeMode', 0); material.backFaceCulling = culling; }
      const result = await target.readPixels();
      if (!(result instanceof Uint8Array) || result[3] !== 255) throw new Error('Terrain GPU blend probe returned no valid pixel.');
      const error = Math.max(...sample.srgbRGBBytes.map((expected, index) => Math.abs(expected - result[index]!)));
      errors.push(error);
      if (error > 4) throw new Error(`Terrain GPU/source blend differs by ${error}/255 at UV ${sample.uv.join(',')} (expected ${sample.srgbRGBBytes.join(',')}; received ${Array.from(result.slice(0, 3)).join(',')}); refusing this runtime surface.`);
    }
    return errors;
  } finally {
    material.setFloat('probeMode', 0); material.backFaceCulling = culling;
    plane.dispose(false, false); target.dispose();
  }
}

export async function applyTerrainSurfaces(scene: Scene, meshes: AbstractMesh[], manifest: SurfaceManifest, onReady?: (dispose: () => void) => void): Promise<SurfaceInspection> {
  if (manifest.schemaVersion !== 1 || manifest.sourceRoute !== 'unity-reference' || manifest.sourceVersion !== SOURCE ||
      manifest.tiles?.length !== 4 || !Array.isArray(manifest.files)) throw new Error('Terrain surface source version does not match.');
  const prepared: { tile: Tile; mesh: Mesh; uv: Float32Array; landmarkErrors: number[]; material: Material;
    method: 'source-layers' | 'baked-diffuse'; samplers: number; blendPixelErrors: number[]; fallbackReason?: string | undefined }[] = [];
  const resources: Material[] = [];
  const textures = new Map<string, Promise<Texture>>();
  const loadedTextures: Texture[] = [];
  const bitmaps: ImageBitmap[] = [];
  const caps = scene.getEngine().getCaps();
  const loadTexture = (file: string, kind: 'source' | 'mask' | 'baked'): Promise<Texture> => {
    const key = `${kind}:${file}`;
    const cached = textures.get(key);
    if (cached) return cached;
    const loading = (async () => {
      const entry = manifest.files.find(candidate => candidate.file === file);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(file) || !entry || !SHA256.test(entry.sha256)) throw new Error('Terrain texture is not hash allowlisted.');
      const imageResponse = await fetch(`/assets/world/surfaces/${file}`);
      if (!imageResponse.ok) throw new Error(`Terrain texture download failed: ${file}`);
      const bytes = await imageResponse.arrayBuffer();
      const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (actual !== entry.sha256) throw new Error(`Terrain texture hash mismatch: ${file}`);
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = kind === 'baked' ? undefined : await createImageBitmap(blob, {
        imageOrientation: kind === 'source' ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      });
      if (bitmap) bitmaps.push(bitmap);
      const url = URL.createObjectURL(blob);
      try {
        const texture = await new Promise<Texture>((resolve, reject) => {
          const item = new Texture(url, scene, {
            noMipmap: kind === 'mask', invertY: false, useSRGBBuffer: kind === 'source',
            samplingMode: kind === 'mask' ? Texture.NEAREST_SAMPLINGMODE : Texture.TRILINEAR_SAMPLINGMODE,
            ...(bitmap ? { buffer: bitmap } : {}), forcedExtension: '.png',
            onLoad: () => queueMicrotask(() => resolve(item)),
            onError: message => queueMicrotask(() => { item.dispose(); reject(new Error(message ?? 'Terrain texture decoding failed.')); }),
          });
        });
        loadedTextures.push(texture);
        if (kind === 'source' && !texture.getInternalTexture()?._useSRGBBuffer) throw new Error('Terrain runtime requires hardware sRGB texture filtering.');
        texture.name = file;
        texture.gammaSpace = kind !== 'mask';
        texture.wrapU = texture.wrapV = kind === 'baked' ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
        texture.anisotropicFilteringLevel = kind === 'source' ? 4 : 1;
        return texture;
      } finally { URL.revokeObjectURL(url); }
    })();
    textures.set(key, loading);
    return loading;
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resources.forEach(material => material.dispose(false, false));
    loadedTextures.forEach(texture => texture.dispose()); bitmaps.forEach(bitmap => bitmap.close());
  };
  try {
    for (const name of TILES) {
      const tile = manifest.tiles.find(candidate => candidate.tile === name);
      const matched = meshes.filter(mesh => mesh.name.startsWith(`${name} terrain`));
      if (!tile || matched.length !== 1 || !(matched[0] instanceof Mesh) ||
          !finite(tile.sourceUnityOrigin, 3) || !finite(tile.sourceUnityScale, 3) || tile.sourceUnityScale.some(v => v <= 0) ||
          !/^[0-9]{2}_[0-9]{2}-diffuse-(1024|2048|4096)\.png$/.test(tile.texture) || !Array.isArray(tile.landmarks) || tile.landmarks.length !== 3) {
        throw new Error(`Terrain surface/mesh descriptor mismatch: ${name}`);
      }
      const file = manifest.files.find(candidate => candidate.file === tile.texture);
      if (!file || !SHA256.test(file.sha256)) throw new Error(`Terrain texture hash is missing: ${name}`);
      const mesh = matched[0];
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) throw new Error(`Terrain positions are missing: ${name}`);
      const world = mesh.computeWorldMatrix(true);
      const uv = new Float32Array(mesh.getTotalVertices() * 2);
      const [ox, , oz] = tile.sourceUnityOrigin;
      const [sx, , sz] = tile.sourceUnityScale;
      const point = new Vector3();
      for (let vertex = 0; vertex < mesh.getTotalVertices(); vertex++) {
        Vector3.TransformCoordinatesFromFloatsToRef(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!, world, point);
        const x = scene.useRightHandedSystem ? point.x : -point.x;
        const u = (x - ox) / sx, v = (-point.z - oz) / sz;
        if (!Number.isFinite(u + v) || u < -0.00001 || u > 1.00001 || v < -0.00001 || v > 1.00001) {
          throw new Error(`Terrain surface coordinates escaped ${name}; refusing a guessed transform.`);
        }
        uv[vertex * 2] = u;
        uv[vertex * 2 + 1] = v;
      }
      const landmarkErrorsMatchedByCanonicalWorldPosition = tile.landmarks.map(landmark => {
        if (!finite(landmark.canonicalWorld, 3) || !finite(landmark.sourceUV0, 2)) throw new Error('Invalid terrain surface landmark.');
        let nearest = Infinity, found = -1;
        for (let vertex = 0; vertex < mesh.getTotalVertices(); vertex++) {
          Vector3.TransformCoordinatesFromFloatsToRef(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!, world, point);
          const x = scene.useRightHandedSystem ? point.x : -point.x;
          const distance = Math.hypot(x - landmark.canonicalWorld[0], point.y - landmark.canonicalWorld[1], point.z - landmark.canonicalWorld[2]);
          if (distance < nearest) { nearest = distance; found = vertex; }
        }
        if (nearest > 0.002 || found < 0) throw new Error(`Terrain source landmark does not match geometry: ${name}`);
        const error = Math.max(Math.abs(uv[found * 2]! - landmark.sourceUV0[0]), Math.abs(uv[found * 2 + 1]! - landmark.sourceUV0[1]));
        if (error > 0.00001) throw new Error(`Terrain texture landmark does not match source UV0: ${name}`);
        return error;
      });
      let material: Material | undefined;
      let method: 'source-layers' | 'baked-diffuse' = 'baked-diffuse', samplers = 1;
      let blendPixelErrors: number[] = [], fallbackReason: string | undefined;
      if (tile.runtime) {
        try {
          validateRuntime(tile.runtime);
          if (!caps.supportSRGBBuffers || caps.maxTexturesImageUnits < tile.runtime.samplers || typeof createImageBitmap !== 'function') {
            throw new Error('This GPU/browser does not support the reviewed source-layer material.');
          }
          const runtime = tile.runtime;
          const sourceMaterial = new ShaderMaterial(`${name}:source-layers`, scene,
            { vertexSource, fragmentSource: sourceLayerDiffuseFragmentSource(runtime) }, {
              attributes: ['position', 'normal', 'uv'],
              uniforms: ['world', 'worldViewProjection', 'probeMode', 'probeUV', 'lightDirection'],
              samplers: [...runtime.layers.map(layer => `layer${layer.layer}`), ...runtime.masks.map((_, index) => `masks${index}`)],
            });
          resources.push(sourceMaterial);
          sourceMaterial.setFloat('probeMode', 0); sourceMaterial.setVector2('probeUV', Vector2.Zero());
          sourceMaterial.setVector3('lightDirection', new Vector3(scene.useRightHandedSystem ? .5 : -.5, 1, .4));
          for (const layer of runtime.layers) sourceMaterial.setTexture(`layer${layer.layer}`, await loadTexture(layer.file, 'source'));
          for (const [index, mask] of runtime.masks.entries()) sourceMaterial.setTexture(`masks${index}`, await loadTexture(mask.file, 'mask'));
          blendPixelErrors = await verifyBlendPixelsByGpuReadback(scene, sourceMaterial, runtime.samples);
          material = sourceMaterial; method = 'source-layers'; samplers = runtime.samplers;
        } catch (error) {
          fallbackReason = error instanceof Error ? error.message : String(error);
          console.warn(`[terrain source layers ${name}] using retained baked fallback: ${fallbackReason}`);
        }
      }
      if (!material) {
        const fallback = new StandardMaterial(`${name}:baked-source-diffuse`, scene);
        resources.push(fallback);
        fallback.diffuseColor = Color3.White(); fallback.specularColor = Color3.Black(); fallback.specularPower = 1;
        fallback.diffuseTexture = await loadTexture(tile.texture, 'baked');
        material = fallback;
      }
      prepared.push({ tile, mesh, uv, landmarkErrors: landmarkErrorsMatchedByCanonicalWorldPosition, material, method, samplers, blendPixelErrors, fallbackReason });
    }
    for (const item of prepared) {
      item.mesh.setVerticesData(VertexBuffer.UVKind, item.uv, false, 2);
      item.mesh.material = item.material;
    }
    scene.onDisposeObservable.addOnce(dispose);
    onReady?.(dispose);
    const methods = new Set(prepared.map(item => item.method));
    const inspection: SurfaceInspection = {
      ready: true, sourceVersion: SOURCE, texturedTiles: prepared.length,
      method: methods.size > 1 ? 'mixed' : prepared[0]!.method,
      tiles: prepared.map(item => ({ tile: item.tile.tile, vertices: item.mesh.getTotalVertices(), texture: item.tile.texture,
        detailLayers: item.tile.detailLayers, landmarkErrors: item.landmarkErrors, limitation: item.tile.limitation,
        method: item.method, samplers: item.samplers, blendPixelErrors: item.blendPixelErrors, fallbackReason: item.fallbackReason })),
      limitations: manifest.limitations,
    };
    return inspection;
  } catch (error) {
    dispose();
    throw error;
  }
}

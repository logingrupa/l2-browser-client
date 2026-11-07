import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { sha256 } from "../assets/package/readAssetPackage";
import { decodeNativePreviewPng } from "../scene/world/nativeTerrainPreview";

type Pair = readonly [number, number];
type RgbaBytes = readonly [number, number, number, number];
export interface NativeEffectMaterialInput {
  readonly component: { readonly object: string; readonly class: string; readonly effectiveProperties: Readonly<Record<string, unknown>> };
  /** The component/frame registry establishes this selected resource binding.
   * This adapter verifies its bytes, never a native lookup or animation rule. */
  readonly texture: { readonly object: string; readonly sha256: string; readonly bytes: number };
  readonly png: Uint8Array;
  readonly colorKey?: number | null;
  readonly uvScale?: Pair;
  readonly uvOffset?: Pair;
}

export interface NativeEffectMaterialInspection {
  readonly policy: "modern-source-component-v1";
  readonly status: "configured" | "disposed";
  readonly componentObject: string;
  readonly componentClass: string;
  readonly sourceProperties: Readonly<Record<string, unknown>>;
  readonly texture: NativeEffectMaterialInput["texture"] & { readonly width: number; readonly height: number };
  readonly sourceOpacity: number;
  readonly colorMultiplier: readonly [number, number, number];
  readonly selectedColorKey: number | null;
  readonly selectedColorRelativeTime: number | null;
  readonly selectedColorRgbaBytes: RgbaBytes;
  readonly uvScale: Pair;
  readonly uvOffset: Pair;
  readonly blend: { readonly sourceDrawStyle: 3 | 6; readonly mode: "screen" | "additive"; readonly alphaMode: number;
    readonly rgbEquation: string; readonly alphaEquation: string };
  readonly raster: { readonly backFaceCulling: boolean; readonly cullPolicy: string; readonly depthFunction: number;
    readonly depthWrite: false; readonly alphaTest: boolean; readonly alphaTestPolicy: string };
  readonly sampler: { readonly colorSpace: "encoded-rgba-no-conversion"; readonly filter: "bilinear-mip0";
    readonly address: "clamp"; readonly invertY: false; readonly generatedMipmaps: false };
  readonly appliedSourceFields: readonly string[];
  readonly validatedSourceFields: readonly string[];
  readonly retainedUnimplementedFields: readonly string[];
  readonly nativeCompositionVerified: false;
  readonly gpuExecutionVerified: false;
  readonly limitations: readonly string[];
}

export interface NativeEffectMaterial {
  readonly material: ShaderMaterial;
  setColorKey(index: number | null): void;
  setUVTransform(scale: Pair, offset: Pair): void;
  inspect(): NativeEffectMaterialInspection;
  dispose(): void;
}

const vertexSource = `precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 worldViewProjection; uniform vec4 sourceUV;
varying vec2 componentUV;
void main(){componentUV=uv*sourceUV.xy+sourceUV.zw;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragmentSource = `precision highp float;
varying vec2 componentUV; uniform sampler2D sourceTexture;
uniform vec4 selectedColor; uniform vec3 sourceMultiplier;
uniform float sourceOpacity; uniform float discardZeroAlpha;
void main(){
  vec4 texel=texture2D(sourceTexture,componentUV);
  float alpha=clamp(texel.a*selectedColor.a*sourceOpacity,0.0,1.0);
  if(discardZeroAlpha>0.5 && alpha<=0.0){discard;}
  vec3 rgb=clamp(texel.rgb*selectedColor.rgb*sourceMultiplier*alpha,0.0,1.0);
  gl_FragColor=vec4(rgb,alpha);
}`;
const LIMITATIONS = [
  "Explicit modern source-component preview. Source enum labels do not prove a selected native blend equation or precision.",
  "Screen/additive RGB uses original sampled RGB multiplied by source constant color, selected key, texture alpha and source opacity; no alpha is synthesized from brightness.",
  "Unlit encoded-color output, bilinear mip0, clamp addressing, no mip generation, gamma conversion, lighting, fog or postprocessing in this shader are preview choices.",
  "ZTest selects LEQUAL or ALWAYS; depth writes are disabled. AlphaTest discards only effective alpha <= 0. Native comparison/threshold/depth policy is not established.",
  "ColorScale is a manually selected retained key, with first key as the initial preview selection when enabled; no interpolation, repeat or time policy.",
  "Sprite culling is explicitly two-sided when RenderTwoSided is absent. UV crop is caller-selected, with no atlas padding or automatic frame progression.",
  "The caller resolves component/primitive/frame texture identity. This adapter hashes the selected PNG but does not certify the original native resource lookup.",
  "No particle spawn, motion, lifetime, fade, attachment, skill dispatch, audio or native composition is implemented. Hardware execution must be verified by the integration owner.",
] as const;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native effect material: ${message}`);
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function selectedColor(properties: Readonly<Record<string, unknown>>, index: number | null) {
  if (properties.UseColorScale !== true) {
    requireValue(index === null, "a color key requires explicit UseColorScale=true.");
    return { index: null, relativeTime: null, rgba: [255, 255, 255, 255] as RgbaBytes };
  }
  requireValue(typeof index === "number" && Number.isInteger(index) && index >= 0 && Array.isArray(properties.ColorScale), "invalid selected ColorScale key.");
  const key: unknown = properties.ColorScale[index];
  requireValue(record(key) && finite(key.RelativeTime) && record(key.Color), "selected ColorScale key is missing or undecoded.");
  const rgba = [key.Color.R, key.Color.G, key.Color.B, key.Color.A];
  requireValue(rgba.every(value => finite(value) && Number.isInteger(value) && value >= 0 && value <= 255), "selected ColorScale requires exact RGBA bytes.");
  return { index, relativeTime: key.RelativeTime, rgba: rgba as unknown as RgbaBytes };
}

function validateUV(scale: Pair, offset: Pair): void {
  requireValue(Array.isArray(scale) && Array.isArray(offset) && scale.length === 2 && offset.length === 2 &&
    scale.every((value, axis) => finite(value) && value > 0 && value <= 1 && finite(offset[axis]) && offset[axis]! >= 0 &&
      offset[axis]! + value <= 1 + 1e-12), "UV crop must fit the selected source texture.");
}

/** Owns only a new material and a new verified-RGBA texture. Mesh assignments,
 * shared GLB materials/textures and component/frame selection stay with caller. */
export async function createNativeEffectMaterial(scene: Scene, input: NativeEffectMaterialInput, signal: AbortSignal): Promise<NativeEffectMaterial> {
  signal.throwIfAborted(); requireValue(!scene.isDisposed, "scene is disposed.");
  // Snapshot mutable caller records/bytes before hash and PNG decode awaits.
  const component = structuredClone(input.component), resource = { ...input.texture }, png = input.png.slice();
  const properties = component.effectiveProperties;
  const mesh = component.class === "Engine.MeshEmitter", sprite = component.class === "Engine.SpriteEmitter";
  requireValue(typeof component.object === "string" && component.object.length > 0 && (mesh || sprite) && record(properties), "unsupported component identity/class.");
  requireValue(typeof resource.object === "string" && resource.object.length > 0 && /^[a-f0-9]{64}$/.test(resource.sha256) &&
    Number.isSafeInteger(resource.bytes) && resource.bytes === png.length && png.length > 0 && png.length <= 32 * 1024 * 1024, "invalid selected texture identity.");
  const drawStyle = properties.DrawStyle;
  requireValue(drawStyle === 3 || drawStyle === 6, "unsupported DrawStyle; no native blend equation is inferred.");
  requireValue(!mesh || properties.UseMeshBlendMode === false, "mesh preview requires explicit UseMeshBlendMode=false.");
  requireValue(typeof properties.AlphaTest === "boolean" && typeof properties.ZTest === "boolean", "missing source alpha/depth test flags.");
  requireValue(!mesh || typeof properties.RenderTwoSided === "boolean", "mesh preview requires explicit RenderTwoSided.");
  requireValue(properties.RenderTwoSided === undefined || typeof properties.RenderTwoSided === "boolean", "undecoded RenderTwoSided.");
  requireValue(properties.UseColorScale === undefined || typeof properties.UseColorScale === "boolean", "undecoded UseColorScale.");
  const opacity = properties.Opacity;
  requireValue(finite(opacity) && opacity >= 0 && opacity <= 1, "unsupported source Opacity.");
  const multiplierRange = properties.ColorMultiplierRange;
  requireValue(record(multiplierRange), "missing source ColorMultiplierRange.");
  const multiplier = ["X", "Y", "Z"].map(axis => {
    const range = multiplierRange[axis];
    requireValue(record(range) && finite(range.Min) && range.Min >= 0 && Number.isFinite(Math.fround(range.Min)) && range.Min === range.Max,
      "only constant finite nonnegative ColorMultiplierRange is supported; random selection is not inferred.");
    return range.Min;
  }) as [number, number, number];
  let color = selectedColor(properties, input.colorKey === undefined ? properties.UseColorScale === true ? 0 : null : input.colorKey);
  let uvScale: Pair = [...input.uvScale ?? [1, 1]], uvOffset: Pair = [...input.uvOffset ?? [0, 0]];
  validateUV(uvScale, uvOffset);
  requireValue(await sha256(png) === resource.sha256, "selected texture PNG hash differs.");
  signal.throwIfAborted();
  const pixels = await decodeNativePreviewPng(png, signal);
  signal.throwIfAborted(); requireValue(!scene.isDisposed, "scene was disposed during texture preparation.");
  const applied = ["DrawStyle", "Opacity", "ColorMultiplierRange", "AlphaTest", "ZTest"];
  if (properties.RenderTwoSided !== undefined) applied.push("RenderTwoSided");
  if (properties.UseColorScale === true) applied.push("UseColorScale", "ColorScale");
  const validated = mesh ? ["UseMeshBlendMode"] : [];
  const backFaceCulling = properties.RenderTwoSided === false;
  const alphaMode = drawStyle === 3 ? Constants.ALPHA_SCREENMODE : Constants.ALPHA_ONEONE;
  const depthFunction = properties.ZTest ? Constants.LEQUAL : Constants.ALWAYS;
  let texture: RawTexture | undefined, material: ShaderMaterial | undefined;
  try {
    texture = RawTexture.CreateRGBATexture(pixels.rgba, pixels.width, pixels.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    texture.name = `Effect source preview: ${resource.object}`;
    texture.gammaSpace = false; texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE; texture.wrapV = Texture.CLAMP_ADDRESSMODE; texture.anisotropicFilteringLevel = 1;
    material = new ShaderMaterial(`Effect source preview: ${component.object}`, scene, { vertexSource, fragmentSource }, {
      attributes: ["position", "uv"], uniforms: ["worldViewProjection", "sourceUV", "selectedColor", "sourceMultiplier", "sourceOpacity", "discardZeroAlpha"],
      samplers: ["sourceTexture"], needAlphaBlending: true, needAlphaTesting: properties.AlphaTest,
    });
    material.id = `native-effect-preview:${material.uniqueId}`; material.doNotSerialize = true;
    material.alphaMode = alphaMode; material.transparencyMode = properties.AlphaTest ? Material.MATERIAL_ALPHATESTANDBLEND : Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = backFaceCulling; material.disableDepthWrite = true; material.forceDepthWrite = false; material.depthFunction = depthFunction;
    material.setTexture("sourceTexture", texture);
    material.setColor3("sourceMultiplier", new Color3(...multiplier));
    material.setFloat("sourceOpacity", opacity); material.setFloat("discardZeroAlpha", properties.AlphaTest ? 1 : 0);
    const ownedMaterial = material, ownedTexture = texture;
    const bindColor = () => ownedMaterial.setColor4("selectedColor", new Color4(...color.rgba.map(value => value / 255) as [number, number, number, number]));
    const bindUV = () => ownedMaterial.setVector4("sourceUV", new Vector4(...uvScale, ...uvOffset));
    bindColor(); bindUV();
    let disposed = false;
    const requireActive = () => requireValue(!disposed && !scene.isDisposed, "preview material is disposed.");
    const handle: NativeEffectMaterial = {
      material: ownedMaterial,
      setColorKey(index) { requireActive(); const next = selectedColor(properties, index); color = next; bindColor(); },
      setUVTransform(scale, offset) { requireActive(); validateUV(scale, offset); uvScale = [...scale]; uvOffset = [...offset]; bindUV(); },
      inspect() {
        return { policy: "modern-source-component-v1", status: disposed ? "disposed" : "configured", componentObject: component.object, componentClass: component.class,
          sourceProperties: structuredClone(properties), texture: { ...resource, width: pixels.width, height: pixels.height }, sourceOpacity: opacity,
          colorMultiplier: [...multiplier], selectedColorKey: color.index, selectedColorRelativeTime: color.relativeTime, selectedColorRgbaBytes: [...color.rgba],
          uvScale: [...uvScale], uvOffset: [...uvOffset],
          blend: { sourceDrawStyle: drawStyle, mode: drawStyle === 3 ? "screen" : "additive", alphaMode,
            rgbEquation: drawStyle === 3 ? "src + (1 - src) * dst" : "src + dst",
            alphaEquation: drawStyle === 3 ? "srcAlpha + (1 - srcAlpha) * dstAlpha" : "dstAlpha" },
          raster: { backFaceCulling, cullPolicy: properties.RenderTwoSided === undefined ? "two-sided sprite preview" : "source RenderTwoSided",
            depthFunction, depthWrite: false, alphaTest: properties.AlphaTest as boolean, alphaTestPolicy: "discard effective alpha <= 0 when AlphaTest=true; preview threshold" },
          sampler: { colorSpace: "encoded-rgba-no-conversion", filter: "bilinear-mip0", address: "clamp", invertY: false, generatedMipmaps: false },
          appliedSourceFields: [...applied], validatedSourceFields: [...validated],
          retainedUnimplementedFields: Object.keys(properties).filter(key => !applied.includes(key) && !validated.includes(key)).sort(),
          nativeCompositionVerified: false, gpuExecutionVerified: false, limitations: [...LIMITATIONS] };
      },
      dispose() {
        if (disposed) return;
        disposed = true; signal.removeEventListener("abort", handle.dispose); scene.onDisposeObservable.remove(onSceneDispose);
        // Never dispose textures a caller may have bound later to this material.
        ownedMaterial.dispose(true, false); ownedTexture.dispose();
      },
    };
    const onSceneDispose = scene.onDisposeObservable.add(() => handle.dispose());
    signal.addEventListener("abort", handle.dispose, { once: true });
    return handle;
  } catch (error) { material?.dispose(true, false); texture?.dispose(); throw error; }
}

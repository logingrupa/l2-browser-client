import { Constants } from "@babylonjs/core/Engines/constants";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/ShadersInclude/bonesDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/bonesVertex";
import { createRandomStream, deriveStreamSeed, type RandomStream } from "../../../shared/random";
import type { ResolvedMaterialBlend } from "../model/blendTable";
import { DIAGNOSTIC_CONSTANTS } from "../model/constants/diagnosticConstants";
import { FOG_DISABLED, type FogState } from "../model/fog";
import type { MaterialLighting } from "../model/lighting";
import { colorModifierColourSourceIndices, evaluateMaterialFrame, withColourSourceRgb, type ColourUnitsRgb, type MaterialFrameState } from "../model/materialFrame";
import type { CompiledMaterialStagePlan } from "../model/stagePlan";
import { babylonBlendStateForPair, blendFactorPairKey, type BabylonBlendState } from "./blendState";
import { bindFogUniforms } from "./fogUniforms";
import { forwardViewDepthExpression } from "./fogViewDepth";
import {
  buildFragmentChain, colourSourceUniformName, lightmapCoordinatesVaryingName, lightmapSamplerName, samplerUniformName, textureCoordinateRowUName,
  textureCoordinateRowVName,
} from "./fragmentChain";
import type { LoadedNativeMaterial } from "./loadNativeMaterial";

export { particleFragmentChain, type ParticleFragmentChain } from "./particleFragmentChain";
export { selectTextureFrame } from "../model/textureFrames";
export type { MaterialLighting } from "../model/lighting";
export { evaluateFogState, FOG_DISABLED, type CameraZoneFogRecord, type FogInputs, type FogRangeRecord, type FogState } from "../model/fog";
export { loadNativeMaterial, type LoadedNativeMaterial } from "./loadNativeMaterial";

export interface NativeMaterialUniforms {
  readonly levelSeconds: number;
  readonly hour: number;
  readonly environmentType: number;
  readonly fog: FogState;
}

export interface NativeMaterialOptions {
  readonly sessionSeed: number;
  readonly lighting: MaterialLighting;
}

export interface NativeMaterialBlendInspection extends Omit<ResolvedMaterialBlend, "status"> {
  readonly babylonAlphaMode: string;
}

export interface NativeMaterialInspection {
  readonly materialId: string;
  readonly root: string;
  readonly status: "compiled" | "diagnostic";
  readonly lighting: MaterialLighting;
  readonly lightmapBound: boolean;
  readonly reasons: readonly string[];
  readonly unportedClass: string | null;
  readonly blend: NativeMaterialBlendInspection | null;
  readonly samplerCount: number;
  readonly colourSourceCount: number;
  readonly uniforms: NativeMaterialUniforms | null;
  readonly frame: MaterialFrameState | null;
}

export interface NativeMaterial {
  readonly material: ShaderMaterial;
  update(uniforms: NativeMaterialUniforms): void;
  overrideColourSourceRgb(colorModifierNode: string, rgb: ColourUnitsRgb): void;
  setLightmap(lightmap: BaseTexture): void;
  inspect(): NativeMaterialInspection;
  dispose(): void;
}

const lightmapCoordinatesAttribute = "uv2";
const vertexStageUniforms = ["world", "view", "viewProjection"];

function vertexSourceFor(scene: Scene, lighting: MaterialLighting): string {
  const lightmapped = lighting === "lightmap";
  return [
    "precision highp float;",
    "attribute vec3 position;",
    "attribute vec2 uv;",
    ...(lightmapped ? [`attribute vec2 ${lightmapCoordinatesAttribute};`, `varying vec2 ${lightmapCoordinatesVaryingName};`] : []),
    "#include<bonesDeclaration>",
    "uniform mat4 world;",
    "uniform mat4 view;",
    "uniform mat4 viewProjection;",
    "varying vec2 ue2TextureCoordinates;",
    "varying float ue2ViewDepth;",
    "void main() {",
    "  mat4 finalWorld = world;",
    "#include<bonesVertex>",
    "  vec4 ue2WorldPosition = finalWorld * vec4(position, 1.0);",
    "  ue2TextureCoordinates = uv;",
    ...(lightmapped ? [`  ${lightmapCoordinatesVaryingName} = ${lightmapCoordinatesAttribute};`] : []),
    `  ue2ViewDepth = ${forwardViewDepthExpression(scene, "view * ue2WorldPosition")};`,
    "  gl_Position = viewProjection * ue2WorldPosition;",
    "}",
  ].join("\n");
}

function vertexAttributesFor(lighting: MaterialLighting): string[] {
  return lighting === "lightmap" ? ["position", "uv", lightmapCoordinatesAttribute] : ["position", "uv"];
}

const diagnosticColourUniform = "ue2DiagnosticColour";
const diagnosticFragmentSource = [
  "precision highp float;",
  `uniform vec4 ${diagnosticColourUniform};`,
  `void main() { gl_FragColor = ${diagnosticColourUniform}; }`,
].join("\n");

export interface DiagnosticMaterialRecord {
  readonly root: string;
  readonly unportedClass: string | null;
  readonly reasons: readonly string[];
}

export interface DiagnosticMaterialMetadata {
  readonly ue2Diagnostic: DiagnosticMaterialRecord;
}

function createDiagnosticMaterial(scene: Scene, loaded: LoadedNativeMaterial, lighting: MaterialLighting, reasons: readonly string[], unportedClass: string | null): NativeMaterial {
  const diagnostic: DiagnosticMaterialRecord = { root: loaded.program.root, unportedClass, reasons: [...reasons] };
  const material = new ShaderMaterial(`UE2 diagnostic: ${diagnostic.root}`, scene, { vertexSource: vertexSourceFor(scene, "unlit"), fragmentSource: diagnosticFragmentSource }, {
    attributes: vertexAttributesFor("unlit"), uniforms: [...vertexStageUniforms, diagnosticColourUniform], samplers: [],
  });
  material.doNotSerialize = true;
  const diagnosticMetadata: DiagnosticMaterialMetadata = { ue2Diagnostic: diagnostic };
  material.metadata = diagnosticMetadata;
  material.setColor4(diagnosticColourUniform, new Color4(...DIAGNOSTIC_CONSTANTS.magenta.runtimeDefault));
  let lastUniforms: NativeMaterialUniforms | null = null;
  return {
    material,
    update: uniforms => { lastUniforms = uniforms; },
    overrideColourSourceRgb: colorModifierNode => {
      throw new Error(`UE2 diagnostic material ${diagnostic.root} has no ColorModifier colour source ${colorModifierNode}.`);
    },
    setLightmap: () => {},
    inspect: () => ({ materialId: loaded.materialId, root: diagnostic.root, status: "diagnostic", lighting, lightmapBound: false, reasons: [...diagnostic.reasons],
      unportedClass: diagnostic.unportedClass, blend: null, samplerCount: 0, colourSourceCount: 0, uniforms: lastUniforms, frame: null }),
    dispose: () => material.dispose(true, false),
  };
}

function createSamplerTextures(scene: Scene, loaded: LoadedNativeMaterial, plan: CompiledMaterialStagePlan): RawTexture[][] {
  return plan.samplers.map(sampler => sampler.frameImages.map((image, frameIndex) => {
    const pixels = loaded.texturePixels.get(image.sha256);
    if (!pixels) throw new Error(`UE2 material: texture ${image.path} was not loaded.`);
    const texture = RawTexture.CreateRGBATexture(pixels.rgba, pixels.width, pixels.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    texture.name = `UE2 texture: ${sampler.frameNodes[frameIndex]}`;
    texture.gammaSpace = false;
    texture.hasAlpha = true;
    texture.wrapU = sampler.clampU ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
    texture.wrapV = sampler.clampV ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
    return texture;
  }));
}

function applyBlendState(material: ShaderMaterial, blend: ResolvedMaterialBlend, babylonBlend: BabylonBlendState): void {
  material.alphaMode = babylonBlend.alphaMode;
  material.disableColorWrite = !babylonBlend.colourWrite;
  const blends = babylonBlend.alphaMode !== Constants.ALPHA_DISABLE;
  material.transparencyMode = blends && blend.alphaTest ? Material.MATERIAL_ALPHATESTANDBLEND : blends ? Material.MATERIAL_ALPHABLEND
    : blend.alphaTest ? Material.MATERIAL_ALPHATEST : Material.MATERIAL_OPAQUE;
  material.disableDepthWrite = !blend.depthWrite;
  material.forceDepthWrite = blends && blend.depthWrite;
  material.depthFunction = blend.depthTest ? Constants.LEQUAL : Constants.ALWAYS;
  material.backFaceCulling = !blend.twoSided;
}

function bindFrame(material: ShaderMaterial, textures: readonly RawTexture[][], frame: MaterialFrameState): void {
  textures.forEach((frames, samplerIndex) => {
    const matrix = frame.samplerMatrices[samplerIndex]!;
    material.setTexture(samplerUniformName(samplerIndex), frames[frame.samplerFrameIndices[samplerIndex]!]!);
    material.setVector3(textureCoordinateRowUName(samplerIndex), new Vector3(matrix[0], matrix[1], matrix[2]));
    material.setVector3(textureCoordinateRowVName(samplerIndex), new Vector3(matrix[3], matrix[4], matrix[5]));
  });
  frame.colourSourceValues.forEach((colour, colourSourceIndex) => material.setColor4(colourSourceUniformName(colourSourceIndex), new Color4(...colour)));
}

function createCompiledMaterial(scene: Scene, loaded: LoadedNativeMaterial, plan: CompiledMaterialStagePlan, jitterStream: RandomStream, lighting: MaterialLighting): NativeMaterial {
  const babylonBlend = babylonBlendStateForPair(plan.blend.pair);
  if (!babylonBlend) return createDiagnosticMaterial(scene, loaded, lighting, [`babylon-blend-pair-unavailable:${blendFactorPairKey(plan.blend.pair)}`], null);
  const initialFrame = evaluateMaterialFrame(loaded.program, plan, 0, jitterStream);
  if (initialFrame.status === "unported") return createDiagnosticMaterial(scene, loaded, lighting, [initialFrame.reason], null);
  const chain = buildFragmentChain(plan, lighting);
  const textures = createSamplerTextures(scene, loaded, plan);
  const material = new ShaderMaterial(`UE2 material: ${plan.root}`, scene, { vertexSource: vertexSourceFor(scene, lighting), fragmentSource: chain.fragmentSource }, {
    attributes: vertexAttributesFor(lighting), uniforms: [...vertexStageUniforms, ...chain.uniforms], samplers: [...chain.samplers],
    needAlphaBlending: babylonBlend.alphaMode !== Constants.ALPHA_DISABLE, needAlphaTesting: plan.blend.alphaTest,
  });
  material.doNotSerialize = true;
  applyBlendState(material, plan.blend, babylonBlend);
  bindFrame(material, textures, initialFrame);
  bindFogUniforms(material, plan.blend.fogFamily, FOG_DISABLED);
  let lastUniforms: NativeMaterialUniforms | null = null;
  let lastFrame: MaterialFrameState = initialFrame;
  let lightmapBound = false;
  const rgbByColourSourceIndex = new Map<number, ColourUnitsRgb>();
  const { status: _status, ...blendRecord } = plan.blend;
  return {
    material,
    update: uniforms => {
      const evaluated = evaluateMaterialFrame(loaded.program, plan, uniforms.levelSeconds, jitterStream);
      if (evaluated.status === "unported") throw new Error(`UE2 material ${plan.root}: ${evaluated.reason} appeared after creation.`);
      const frame = withColourSourceRgb(evaluated, rgbByColourSourceIndex);
      bindFrame(material, textures, frame);
      bindFogUniforms(material, plan.blend.fogFamily, uniforms.fog);
      lastUniforms = uniforms;
      lastFrame = frame;
    },
    overrideColourSourceRgb: (colorModifierNode, rgb) => {
      const indices = colorModifierColourSourceIndices(plan, colorModifierNode);
      if (indices.length === 0) throw new Error(`UE2 material ${plan.root} has no ColorModifier colour source ${colorModifierNode}.`);
      for (const index of indices) rgbByColourSourceIndex.set(index, rgb);
    },
    setLightmap: lightmap => {
      if (lighting !== "lightmap") throw new Error(`UE2 material ${plan.root} was built ${lighting} and takes no lightmap.`);
      material.setTexture(lightmapSamplerName, lightmap);
      lightmapBound = true;
    },
    inspect: () => ({
      materialId: loaded.materialId, root: plan.root, status: "compiled", lighting, lightmapBound, reasons: [], unportedClass: null,
      blend: { ...blendRecord, babylonAlphaMode: babylonBlend.alphaModeName }, samplerCount: plan.samplers.length, colourSourceCount: plan.colourSources.length,
      uniforms: lastUniforms, frame: lastFrame,
    }),
    dispose: () => {
      material.dispose(true, false);
      for (const frames of textures) for (const texture of frames) texture.dispose();
    },
  };
}

export function createNativeMaterial(scene: Scene, loaded: LoadedNativeMaterial, options: NativeMaterialOptions): NativeMaterial {
  if (loaded.plan.status === "diagnostic") return createDiagnosticMaterial(scene, loaded, options.lighting, loaded.plan.reasons, loaded.plan.unportedClass);
  const jitterStream = createRandomStream(deriveStreamSeed(options.sessionSeed, "tex-jitter", [loaded.materialId]));
  return createCompiledMaterial(scene, loaded, loaded.plan, jitterStream, options.lighting);
}

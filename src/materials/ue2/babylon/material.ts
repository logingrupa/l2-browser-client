import { Constants } from "@babylonjs/core/Engines/constants";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { createRandomStream, deriveStreamSeed, type RandomStream } from "../../../shared/random";
import type { ResolvedMaterialBlend } from "../model/blendTable";
import { DIAGNOSTIC_CONSTANTS } from "../model/constants/diagnosticConstants";
import { FOG_DISABLED, type FogState } from "../model/fog";
import type { MaterialLighting } from "../model/lighting";
import { evaluateMaterialFrame, type MaterialFrameState } from "../model/materialFrame";
import { programNode } from "../model/materialProgram";
import { textureCoordinateSourceChannel } from "../model/modifiers";
import type { CompiledMaterialStagePlan } from "../model/stagePlan";
import { babylonBlendStateForPair, blendFactorPairKey, type BabylonBlendState } from "./blendState";
import { bindFogUniforms } from "./fogUniforms";
import {
  buildFragmentChain, colourSourceUniformName, lightmapCoordinatesVaryingName, lightmapSamplerName, samplerUniformName, textureCoordinateRowUName,
  textureCoordinateRowVName,
} from "./fragmentChain";
import type { LoadedNativeMaterial } from "./loadNativeMaterial";

export { particleFragmentChain, type ParticleFragmentChain } from "./particleFragmentChain";
export { selectTextureFrame, type SelectedTextureFrame, type TextureFrameSource } from "../model/textureFrames";
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
  setLightmap(lightmap: BaseTexture): void;
  inspect(): NativeMaterialInspection;
  dispose(): void;
}

const lightmapCoordinatesAttribute = "uv2";

function vertexSourceFor(lighting: MaterialLighting): string {
  const lightmapped = lighting === "lightmap";
  return [
    "precision highp float;",
    "attribute vec3 position;",
    "attribute vec2 uv;",
    ...(lightmapped ? [`attribute vec2 ${lightmapCoordinatesAttribute};`, `varying vec2 ${lightmapCoordinatesVaryingName};`] : []),
    "uniform mat4 worldViewProjection;",
    "uniform mat4 worldView;",
    "varying vec2 ue2TextureCoordinates;",
    "varying float ue2ViewDepth;",
    "void main() {",
    "  ue2TextureCoordinates = uv;",
    ...(lightmapped ? [`  ${lightmapCoordinatesVaryingName} = ${lightmapCoordinatesAttribute};`] : []),
    "  ue2ViewDepth = (worldView * vec4(position, 1.0)).z;",
    "  gl_Position = worldViewProjection * vec4(position, 1.0);",
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

function createDiagnosticMaterial(scene: Scene, loaded: LoadedNativeMaterial, lighting: MaterialLighting, reasons: readonly string[], unportedClass: string | null): NativeMaterial {
  const material = new ShaderMaterial(`UE2 diagnostic: ${loaded.program.root}`, scene, { vertexSource: vertexSourceFor("unlit"), fragmentSource: diagnosticFragmentSource }, {
    attributes: vertexAttributesFor("unlit"), uniforms: ["worldViewProjection", "worldView", diagnosticColourUniform], samplers: [],
  });
  material.doNotSerialize = true;
  material.setColor4(diagnosticColourUniform, new Color4(...DIAGNOSTIC_CONSTANTS.magenta.runtimeDefault));
  let lastUniforms: NativeMaterialUniforms | null = null;
  return {
    material,
    update: uniforms => { lastUniforms = uniforms; },
    setLightmap: () => {},
    inspect: () => ({ materialId: loaded.materialId, root: loaded.program.root, status: "diagnostic", lighting, lightmapBound: false, reasons: [...reasons],
      unportedClass, blend: null, samplerCount: 0, colourSourceCount: 0, uniforms: lastUniforms, frame: null }),
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

function unsupportedCoordinateReason(loaded: LoadedNativeMaterial, plan: CompiledMaterialStagePlan): string | null {
  for (const modifierId of plan.samplers.flatMap(sampler => sampler.textureCoordinateModifiers)) {
    const modifier = programNode(loaded.program, modifierId);
    if (modifier.class === "Engine.TexEnvMap") return "material-feature-unported:EnvMapType";
    if (modifier.class === "Engine.TexCoordSource" && textureCoordinateSourceChannel(modifier) !== 0) return "material-feature-unported:SourceChannel";
  }
  return null;
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
  const coordinateReason = unsupportedCoordinateReason(loaded, plan);
  if (coordinateReason) return createDiagnosticMaterial(scene, loaded, lighting, [coordinateReason], null);
  const initialFrame = evaluateMaterialFrame(loaded.program, plan, 0, jitterStream);
  if (initialFrame.status === "unported") return createDiagnosticMaterial(scene, loaded, lighting, [initialFrame.reason], null);
  const chain = buildFragmentChain(plan, lighting);
  const textures = createSamplerTextures(scene, loaded, plan);
  const material = new ShaderMaterial(`UE2 material: ${plan.root}`, scene, { vertexSource: vertexSourceFor(lighting), fragmentSource: chain.fragmentSource }, {
    attributes: vertexAttributesFor(lighting), uniforms: ["worldViewProjection", "worldView", ...chain.uniforms], samplers: [...chain.samplers],
    needAlphaBlending: babylonBlend.alphaMode !== Constants.ALPHA_DISABLE, needAlphaTesting: plan.blend.alphaTest,
  });
  material.doNotSerialize = true;
  applyBlendState(material, plan.blend, babylonBlend);
  bindFrame(material, textures, initialFrame);
  bindFogUniforms(material, plan.blend.fogFamily, FOG_DISABLED);
  let lastUniforms: NativeMaterialUniforms | null = null;
  let lastFrame: MaterialFrameState = initialFrame;
  let lightmapBound = false;
  const { status: _status, ...blendRecord } = plan.blend;
  return {
    material,
    update: uniforms => {
      const frame = evaluateMaterialFrame(loaded.program, plan, uniforms.levelSeconds, jitterStream);
      if (frame.status === "unported") throw new Error(`UE2 material ${plan.root}: ${frame.reason} appeared after creation.`);
      bindFrame(material, textures, frame);
      bindFogUniforms(material, plan.blend.fogFamily, uniforms.fog);
      lastUniforms = uniforms;
      lastFrame = frame;
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

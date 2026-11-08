import { Constants } from "@babylonjs/core/Engines/constants";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { ResolvedMaterialBlend } from "../model/blendTable";
import { DIAGNOSTIC_CONSTANTS } from "../model/constants/diagnosticConstants";
import type { CompiledMaterialStagePlan } from "../model/stagePlan";
import { babylonBlendStateForPair, blendFactorPairKey, type BabylonBlendState } from "./blendState";
import { buildFragmentChain, colourSourceUniformName, fogUniformNames, samplerUniformName, textureCoordinateRowUName, textureCoordinateRowVName } from "./fragmentChain";
import type { LoadedNativeMaterial } from "./loadNativeMaterial";

export interface NativeMaterialBlendInspection extends Omit<ResolvedMaterialBlend, "status"> {
  readonly babylonAlphaMode: string;
}

export interface NativeMaterialInspection {
  readonly materialId: string;
  readonly root: string;
  readonly status: "compiled" | "diagnostic";
  readonly reasons: readonly string[];
  readonly unportedClass: string | null;
  readonly blend: NativeMaterialBlendInspection | null;
  readonly samplerCount: number;
  readonly colourSourceCount: number;
}

export interface NativeMaterial {
  readonly material: ShaderMaterial;
  inspect(): NativeMaterialInspection;
  dispose(): void;
}

const vertexSource = [
  "precision highp float;",
  "attribute vec3 position;",
  "attribute vec2 uv;",
  "uniform mat4 worldViewProjection;",
  "uniform mat4 worldView;",
  "varying vec2 ue2TextureCoordinates;",
  "varying float ue2ViewDepth;",
  "void main() {",
  "  ue2TextureCoordinates = uv;",
  "  ue2ViewDepth = (worldView * vec4(position, 1.0)).z;",
  "  gl_Position = worldViewProjection * vec4(position, 1.0);",
  "}",
].join("\n");

const diagnosticColourUniform = "ue2DiagnosticColour";
const diagnosticFragmentSource = [
  "precision highp float;",
  `uniform vec4 ${diagnosticColourUniform};`,
  `void main() { gl_FragColor = ${diagnosticColourUniform}; }`,
].join("\n");

function createDiagnosticMaterial(scene: Scene, loaded: LoadedNativeMaterial, reasons: readonly string[], unportedClass: string | null): NativeMaterial {
  const material = new ShaderMaterial(`UE2 diagnostic: ${loaded.program.root}`, scene, { vertexSource, fragmentSource: diagnosticFragmentSource }, {
    attributes: ["position", "uv"], uniforms: ["worldViewProjection", "worldView", diagnosticColourUniform], samplers: [],
  });
  material.doNotSerialize = true;
  material.setColor4(diagnosticColourUniform, new Color4(...DIAGNOSTIC_CONSTANTS.magenta.runtimeDefault));
  return {
    material,
    inspect: () => ({ materialId: loaded.materialId, root: loaded.program.root, status: "diagnostic", reasons: [...reasons], unportedClass, blend: null, samplerCount: 0, colourSourceCount: 0 }),
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

function createCompiledMaterial(scene: Scene, loaded: LoadedNativeMaterial, plan: CompiledMaterialStagePlan): NativeMaterial {
  const babylonBlend = babylonBlendStateForPair(plan.blend.pair);
  if (!babylonBlend) return createDiagnosticMaterial(scene, loaded, [`babylon-blend-pair-unavailable:${blendFactorPairKey(plan.blend.pair)}`], null);
  const chain = buildFragmentChain(plan);
  const textures = createSamplerTextures(scene, loaded, plan);
  const material = new ShaderMaterial(`UE2 material: ${plan.root}`, scene, { vertexSource, fragmentSource: chain.fragmentSource }, {
    attributes: ["position", "uv"], uniforms: ["worldViewProjection", "worldView", ...chain.uniforms], samplers: [...chain.samplers],
    needAlphaBlending: babylonBlend.alphaMode !== Constants.ALPHA_DISABLE, needAlphaTesting: plan.blend.alphaTest,
  });
  material.doNotSerialize = true;
  applyBlendState(material, plan.blend, babylonBlend);
  textures.forEach((frames, samplerIndex) => {
    material.setTexture(samplerUniformName(samplerIndex), frames[0]!);
    material.setVector3(textureCoordinateRowUName(samplerIndex), new Vector3(1, 0, 0));
    material.setVector3(textureCoordinateRowVName(samplerIndex), new Vector3(0, 1, 0));
  });
  plan.colourSources.forEach((_, colourSourceIndex) => material.setColor4(colourSourceUniformName(colourSourceIndex), new Color4(1, 1, 1, 1)));
  material.setColor4(fogUniformNames.range, new Color4(0, 0, 0, 0));
  material.setColor4(fogUniformNames.colour, new Color4(0, 0, 0, 0));
  const { status: _status, ...blendRecord } = plan.blend;
  return {
    material,
    inspect: () => ({
      materialId: loaded.materialId, root: plan.root, status: "compiled", reasons: [], unportedClass: null,
      blend: { ...blendRecord, babylonAlphaMode: babylonBlend.alphaModeName }, samplerCount: plan.samplers.length, colourSourceCount: plan.colourSources.length,
    }),
    dispose: () => {
      material.dispose(true, false);
      for (const frames of textures) for (const texture of frames) texture.dispose();
    },
  };
}

export function createNativeMaterial(scene: Scene, loaded: LoadedNativeMaterial): NativeMaterial {
  if (loaded.plan.status === "diagnostic") return createDiagnosticMaterial(scene, loaded, loaded.plan.reasons, loaded.plan.unportedClass);
  return createCompiledMaterial(scene, loaded, loaded.plan);
}

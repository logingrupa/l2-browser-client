import { Constants } from "@babylonjs/core/Engines/constants";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { particleFragmentChain, type ParticleFragmentChain } from "../../../materials/ue2/babylon/material";
import { forwardViewDepthExpression } from "../../../materials/ue2/babylon/fogViewDepth";
import { FOG_DISABLED, type FogState } from "../../../materials/ue2/model/fog";
import { PARTICLE_CONSTANTS } from "../sim/emitterConstants";
import type { ParticleEmitterRecord } from "../sim/emitterRecords";
import { meshMaterialRoute } from "../sim/meshEmitter";
import { emitterFeatureGapReason, type EmitterFeatureGapReason } from "../sim/particleEmitter";
import { PARTICLE_INSTANCE_ATTRIBUTES } from "./particleInstances";

export interface ParticleMaterialBindingInput {
  readonly record: ParticleEmitterRecord;
  readonly emitterOrdinal: number;
  readonly texture: BaseTexture;
}

export interface ParticleMaterialInspection {
  readonly emitter: string;
  readonly emitterOrdinal: number;
  readonly drawStyle: number;
  readonly blendModeName: string;
  readonly babylonAlphaMode: string;
  readonly fogFamily: string;
  readonly backFaceCulling: boolean;
  readonly depthTest: boolean;
  readonly depthWrite: boolean;
  readonly alphaTest: boolean;
  readonly textureName: string;
}

export interface ParticleMaterialBinding {
  readonly material: ShaderMaterial;
  readonly chain: ParticleFragmentChain;
  setTexture(texture: BaseTexture): void;
  setFog(fog: FogState): void;
  inspect(): ParticleMaterialInspection;
  dispose(): void;
}

export type ParticleMaterialOutcome =
  | { readonly drawn: true; readonly binding: ParticleMaterialBinding }
  | { readonly drawn: false; readonly reason: EmitterFeatureGapReason };

type ParticleMaterialRoute = { readonly drawn: true; readonly renderTwoSided: boolean } | { readonly drawn: false; readonly reason: EmitterFeatureGapReason };

export interface NativeEmitterMeshMetadata {
  readonly nativeEmitterOrdinal: number;
}

const samplerName = "particleTexture";
const alphaTestUniform = "particleAlphaTest";
const spriteDefine = "PARTICLE_SPRITE";
const alphaTestDiscardLimit = PARTICLE_CONSTANTS.particleAlphaTest.runtimeDefault;

function particleVertexSource(scene: Scene): string {
  return [
    "precision highp float;",
    "attribute vec3 position;",
    "attribute vec2 uv;",
    "#ifdef INSTANCES",
    "attribute vec4 world0;",
    "attribute vec4 world1;",
    "attribute vec4 world2;",
    "attribute vec4 world3;",
    `attribute vec4 ${PARTICLE_INSTANCE_ATTRIBUTES.colour};`,
    `attribute vec4 ${PARTICLE_INSTANCE_ATTRIBUTES.atlas};`,
    `attribute vec4 ${PARTICLE_INSTANCE_ATTRIBUTES.sprite};`,
    "#endif",
    "uniform mat4 world;",
    "uniform mat4 view;",
    "uniform mat4 viewProjection;",
    "varying vec2 particleTextureCoordinates;",
    "varying vec4 particleVertexColour;",
    "varying float particleViewDepth;",
    "void main() {",
    "#ifdef INSTANCES",
    "  mat4 particleWorld = world * mat4(world0, world1, world2, world3);",
    `  vec4 instanceColour = ${PARTICLE_INSTANCE_ATTRIBUTES.colour};`,
    `  vec4 instanceAtlas = ${PARTICLE_INSTANCE_ATTRIBUTES.atlas};`,
    `  vec4 instanceSprite = ${PARTICLE_INSTANCE_ATTRIBUTES.sprite};`,
    "#else",
    "  mat4 particleWorld = world;",
    "  vec4 instanceColour = vec4(1.0);",
    "  vec4 instanceAtlas = vec4(1.0, 1.0, 0.0, 0.0);",
    "  vec4 instanceSprite = vec4(1.0, 1.0, 0.0, 0.0);",
    "#endif",
    `#ifdef ${spriteDefine}`,
    "  vec3 spriteCentre = (particleWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;",
    "  vec3 cameraRight = vec3(view[0][0], view[1][0], view[2][0]);",
    "  vec3 cameraUp = vec3(view[0][1], view[1][1], view[2][1]);",
    "  vec2 corner = vec2(position.x * instanceSprite.x, position.y * instanceSprite.y);",
    "  float rollCosine = cos(instanceSprite.z);",
    "  float rollSine = sin(instanceSprite.z);",
    "  vec2 rolledCorner = vec2(rollCosine * corner.x - rollSine * corner.y, rollSine * corner.x + rollCosine * corner.y);",
    "  vec3 worldPosition = spriteCentre + cameraRight * rolledCorner.x + cameraUp * rolledCorner.y;",
    "#else",
    "  vec3 worldPosition = (particleWorld * vec4(position, 1.0)).xyz;",
    "#endif",
    "  particleTextureCoordinates = uv * instanceAtlas.xy + instanceAtlas.zw;",
    "  particleVertexColour = instanceColour;",
    `  particleViewDepth = ${forwardViewDepthExpression(scene, "view * vec4(worldPosition, 1.0)")};`,
    "  gl_Position = viewProjection * vec4(worldPosition, 1.0);",
    "}",
  ].join("\n");
}

function fragmentSource(chain: ParticleFragmentChain): string {
  return [
    "precision highp float;",
    `uniform sampler2D ${samplerName};`,
    `uniform float ${alphaTestUniform};`,
    "varying vec2 particleTextureCoordinates;",
    "varying vec4 particleVertexColour;",
    "varying float particleViewDepth;",
    chain.fragmentFunctionSource,
    "void main() {",
    `  vec4 sourceColour = texture2D(${samplerName}, particleTextureCoordinates) * particleVertexColour;`,
    `  if (${alphaTestUniform} > 0.5 && sourceColour.a <= ${alphaTestDiscardLimit.toFixed(1)}) { discard; }`,
    `  gl_FragColor = ${chain.fragmentFunctionName}(sourceColour, particleViewDepth);`,
    "}",
  ].join("\n");
}

function particleMaterialRoute(record: ParticleEmitterRecord): ParticleMaterialRoute {
  if (record.emitterClass === "Engine.SpriteEmitter") return { drawn: true, renderTwoSided: true };
  if (record.emitterClass !== "Engine.MeshEmitter") return { drawn: true, renderTwoSided: false };
  const route = meshMaterialRoute(record);
  return route.kind === "particle-draw-style" ? { drawn: true, renderTwoSided: route.renderTwoSided } : { drawn: false, reason: emitterFeatureGapReason("UseMeshBlendMode") };
}

export function bindParticleMaterial(scene: Scene, mesh: Mesh, input: ParticleMaterialBindingInput): ParticleMaterialOutcome {
  const { record, emitterOrdinal } = input;
  if (!Number.isSafeInteger(emitterOrdinal) || emitterOrdinal < 0) throw new RangeError(`Emitter ordinal ${emitterOrdinal} must be a non-negative integer.`);
  const route = particleMaterialRoute(record);
  if (!route.drawn) return route;
  const sprite = record.emitterClass === "Engine.SpriteEmitter";
  const chain = particleFragmentChain(record.DrawStyle);
  const material = new ShaderMaterial(`UE2 particle material: ${record.object}`, scene, { vertexSource: particleVertexSource(scene), fragmentSource: fragmentSource(chain) }, {
    attributes: ["position", "uv", ...Object.values(PARTICLE_INSTANCE_ATTRIBUTES)],
    uniforms: ["world", "view", "viewProjection", alphaTestUniform, ...chain.uniforms],
    samplers: [samplerName],
    defines: sprite ? [spriteDefine] : [],
    needAlphaBlending: chain.babylonBlend.alphaMode !== Constants.ALPHA_DISABLE,
    needAlphaTesting: record.AlphaTest,
  });
  material.doNotSerialize = true;
  material.alphaMode = chain.babylonBlend.alphaMode;
  material.disableColorWrite = !chain.babylonBlend.colourWrite;
  material.transparencyMode = record.AlphaTest ? Material.MATERIAL_ALPHATESTANDBLEND : Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = !route.renderTwoSided;
  material.disableDepthWrite = !record.ZWrite;
  material.forceDepthWrite = record.ZWrite;
  material.depthFunction = record.ZTest ? Constants.LEQUAL : Constants.ALWAYS;
  material.setFloat(alphaTestUniform, record.AlphaTest ? 1 : 0);
  let texture = input.texture;
  material.setTexture(samplerName, texture);
  chain.bindFog(material, FOG_DISABLED);
  mesh.material = material;
  const metadata: NativeEmitterMeshMetadata = { nativeEmitterOrdinal: emitterOrdinal };
  mesh.metadata = metadata;
  const binding: ParticleMaterialBinding = {
    material,
    chain,
    setTexture(next) { texture = next; material.setTexture(samplerName, next); },
    setFog(fog) { chain.bindFog(material, fog); },
    inspect: () => ({
      emitter: record.object, emitterOrdinal, drawStyle: record.DrawStyle, blendModeName: chain.blend.modeName, babylonAlphaMode: chain.babylonBlend.alphaModeName,
      fogFamily: chain.blend.fogFamily, backFaceCulling: material.backFaceCulling, depthTest: record.ZTest, depthWrite: record.ZWrite, alphaTest: record.AlphaTest,
      textureName: texture.name,
    }),
    dispose: () => material.dispose(true, false),
  };
  return { drawn: true, binding };
}

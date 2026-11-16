import { Vector4 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { NativeStorePngPixels } from "../../../assets/native/decodeNativeStorePng";
import { worldDistanceToSource } from "../../../world/sourceFrame";
import { TERRAIN_LAYER_CONSTANTS } from "../model/constants/terrainLayerConstants";
import { FOG_DISABLED, type FogState } from "../model/fog";
import { packTerrainAlphaMaps, type TerrainAlphaMap } from "../model/terrainLayers";
import { bindFogUniforms } from "./fogUniforms";
import { forwardViewDepthExpression } from "./fogViewDepth";
import {
  buildTerrainLayerFragmentChain, terrainLayerRowUName, terrainLayerRowVName, terrainLayerSamplerName, terrainMaskCoordinatesVaryingName,
  terrainMaskSamplerName, terrainNativePositionVaryingName,
} from "./fragmentChain";

export type TerrainLayerUvRow = readonly [number, number, number, number];

export interface TerrainLayerTextureInput {
  readonly pixels: NativeStorePngPixels;
  readonly clampU: boolean;
  readonly clampV: boolean;
  readonly name: string;
}

export interface TerrainLayerMaterialLayer {
  readonly texture: TerrainLayerTextureInput;
  readonly alphaMap: TerrainAlphaMap;
  readonly rowU: TerrainLayerUvRow;
  readonly rowV: TerrainLayerUvRow;
}

export interface TerrainLayerMaterial {
  readonly material: ShaderMaterial;
  readonly samplerCount: number;
  readonly constantIds: readonly string[];
  update(fog: FogState): void;
  dispose(): void;
}

const terrainFogFamily = "fog-colour";
const vertexStageUniforms = ["world", "view", "viewProjection"];

export function terrainLayerSamplerCount(layerCount: number, alphaMaps: readonly TerrainAlphaMap[]): number {
  return layerCount + packTerrainAlphaMaps(alphaMaps).maskTextures.length;
}

function terrainVertexSource(scene: Scene): string {
  return [
    "precision highp float;",
    "attribute vec3 position;",
    "attribute vec2 uv;",
    "uniform mat4 world;",
    "uniform mat4 view;",
    "uniform mat4 viewProjection;",
    `varying vec3 ${terrainNativePositionVaryingName};`,
    `varying vec2 ${terrainMaskCoordinatesVaryingName};`,
    "varying float ue2ViewDepth;",
    "void main() {",
    "  vec4 ue2WorldPosition = world * vec4(position, 1.0);",
    `  ${terrainNativePositionVaryingName} = position.xzy * ${worldDistanceToSource(1).toFixed(1)};`,
    `  ${terrainMaskCoordinatesVaryingName} = uv;`,
    `  ue2ViewDepth = ${forwardViewDepthExpression(scene, "view * ue2WorldPosition")};`,
    "  gl_Position = viewProjection * ue2WorldPosition;",
    "}",
  ].join("\n");
}

function rawTexture(scene: Scene, pixels: NativeStorePngPixels, name: string, clampU: boolean, clampV: boolean): RawTexture {
  const texture = RawTexture.CreateRGBATexture(pixels.rgba, pixels.width, pixels.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = name;
  texture.gammaSpace = false;
  texture.wrapU = clampU ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  texture.wrapV = clampV ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  return texture;
}

export function createTerrainLayerMaterial(scene: Scene, name: string, layers: readonly TerrainLayerMaterialLayer[]): TerrainLayerMaterial {
  if (layers.length === 0) throw new RangeError("A terrain layer material needs its base layer.");
  const packing = packTerrainAlphaMaps(layers.slice(1).map(layer => layer.alphaMap));
  const chain = buildTerrainLayerFragmentChain(packing.layerWeights, packing.maskTextures.length);
  const material = new ShaderMaterial(name, scene, { vertexSource: terrainVertexSource(scene), fragmentSource: chain.fragmentSource }, {
    attributes: ["position", "uv"], uniforms: [...vertexStageUniforms, ...chain.uniforms], samplers: [...chain.samplers],
  });
  material.doNotSerialize = true;
  material.backFaceCulling = true;
  const textures = [
    ...layers.map((layer, layerPosition) => {
      const texture = rawTexture(scene, layer.texture.pixels, layer.texture.name, layer.texture.clampU, layer.texture.clampV);
      material.setTexture(terrainLayerSamplerName(layerPosition), texture);
      material.setVector4(terrainLayerRowUName(layerPosition), new Vector4(...layer.rowU));
      material.setVector4(terrainLayerRowVName(layerPosition), new Vector4(...layer.rowV));
      return texture;
    }),
    ...packing.maskTextures.map((mask, maskTexture) => {
      const texture = rawTexture(scene, mask.pixels, `${name} alpha maps ${maskTexture}`, mask.clampU, mask.clampV);
      material.setTexture(terrainMaskSamplerName(maskTexture), texture);
      return texture;
    }),
  ];
  bindFogUniforms(material, terrainFogFamily, FOG_DISABLED);
  return {
    material,
    samplerCount: chain.samplers.length,
    constantIds: Object.values(TERRAIN_LAYER_CONSTANTS).map(row => row.id),
    update: fog => bindFogUniforms(material, terrainFogFamily, fog),
    dispose: () => {
      material.dispose(true, false);
      for (const texture of textures) texture.dispose();
    },
  };
}

import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { sourcePositionToWorld } from "../../../world/sourceFrame";
import type { FogFamily } from "../model/constants/blendFactorTypes";
import { fogTargetColour, type FogState } from "../model/fog";
import { fogUniformNames } from "./fragmentChain";

function sourceDistanceToMetres(sourceUnits: number): number {
  return sourcePositionToWorld({ x: sourceUnits, y: 0, z: 0 }).x;
}

export function bindFogUniforms(material: ShaderMaterial, family: FogFamily, fog: FogState): void {
  const target = fogTargetColour(family, fog);
  if (target === null) {
    material.setColor4(fogUniformNames.range, new Color4(0, 0, 0, 0));
    material.setColor4(fogUniformNames.colour, new Color4(0, 0, 0, 0));
    return;
  }
  material.setColor4(fogUniformNames.range, new Color4(sourceDistanceToMetres(fog.startSourceUnits), sourceDistanceToMetres(fog.endSourceUnits), 1, 0));
  material.setColor4(fogUniformNames.colour, new Color4(target[0], target[1], target[2], 1));
}

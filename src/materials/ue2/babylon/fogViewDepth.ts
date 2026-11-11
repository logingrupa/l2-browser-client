import type { Scene } from "@babylonjs/core/scene";

export function forwardViewDepthExpression(scene: Scene, viewSpacePositionExpression: string): string {
  return scene.useRightHandedSystem ? `-(${viewSpacePositionExpression}).z` : `(${viewSpacePositionExpression}).z`;
}

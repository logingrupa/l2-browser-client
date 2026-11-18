import type { Scene } from "@babylonjs/core/scene";
import type { WorldPosition } from "../../world/sourceFrame";
import { createSceneScopedContext } from "../sceneScopedContext";

export interface FogReferencePawn {
  position(): WorldPosition | null;
}

const fogReferencePawnContexts = createSceneScopedContext<FogReferencePawn>("fog reference pawn");
const absentFogReferencePawn: FogReferencePawn = { position: () => null };

export function provideFogReferencePawn(scene: Scene, pawn: FogReferencePawn): () => void {
  return fogReferencePawnContexts.provide(scene, pawn);
}

export function fogReferencePawnFor(scene: Scene): FogReferencePawn {
  return fogReferencePawnContexts.contextFor(scene) ?? absentFogReferencePawn;
}

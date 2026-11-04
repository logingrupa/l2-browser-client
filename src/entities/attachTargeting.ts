import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import "@babylonjs/core/Culling/ray";
import type { Scene } from "@babylonjs/core/scene";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { EntityRegistry } from "./EntityRegistry";

function readEntityIdentifier(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || !("entityId" in metadata)) return null;
  return typeof metadata.entityId === "string" ? metadata.entityId : null;
}

export function attachTargeting(scene: Scene, registry: EntityRegistry, adapter: GameWorldAdapter): () => void {
  const observer = scene.onPointerObservable.add((information) => {
    if (information.type !== PointerEventTypes.POINTERTAP || information.event.button !== 0) return;
    const picked = scene.pick(scene.pointerX, scene.pointerY);
    const identifier = readEntityIdentifier(picked?.pickedMesh?.metadata);
    if (identifier) { registry.select(identifier); return; }
    registry.select(null);
    if (picked?.pickedPoint && picked.pickedMesh?.name === "Courtyard ground") {
      adapter.dispatch({ type: "move-local", position: { x: Math.max(-10, Math.min(10, picked.pickedPoint.x)), y: 0, z: Math.max(-10, Math.min(10, picked.pickedPoint.z)) } });
    }
  });
  return () => { scene.onPointerObservable.remove(observer); };
}

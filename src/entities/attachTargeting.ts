import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import "@babylonjs/core/Culling/ray";
import type { Scene } from "@babylonjs/core/scene";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { EntityRegistry } from "./EntityRegistry";
import type { WorldNavigation } from "../world/WorldNavigation";
import type { DoorTargeting } from "../scene/world/nativeDoorInteractions";

function readEntityIdentifier(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  return "clientEntityId" in metadata && typeof metadata.clientEntityId === "string" ? metadata.clientEntityId : null;
}

export function attachTargeting(scene: Scene, registry: EntityRegistry, adapter: GameWorldAdapter, navigation?: WorldNavigation, interactions?: DoorTargeting): () => void {
  const observer = scene.onPointerObservable.add((information) => {
    if (information.type === PointerEventTypes.POINTERMOVE && interactions) {
      interactions.hover(scene.pick(scene.pointerX, scene.pointerY)?.pickedMesh ?? null); return;
    }
    if (information.type !== PointerEventTypes.POINTERTAP || information.event.button !== 0) return;
    const picked = scene.pick(scene.pointerX, scene.pointerY);
    if (interactions?.activate(picked?.pickedMesh ?? null)) { registry.select(null); return; }
    interactions?.cancel();
    const identifier = readEntityIdentifier(picked?.pickedMesh?.metadata);
    if (identifier) { registry.select(identifier); return; }
    registry.select(null);
    if (navigation && picked?.pickedPoint && picked.pickedMesh?.metadata?.worldSupportsWalking === true) {
      const normal = picked.getNormal(true);
      if (normal && Math.abs(normal.y) >= Math.cos(Math.PI / 4)) {
        const destination = navigation.destination(picked.pickedPoint);
        if (destination) adapter.dispatch({ type: "move-local", position: destination });
      }
      return;
    }
    if (picked?.pickedPoint && picked.pickedMesh?.name === "Courtyard ground") {
      adapter.dispatch({ type: "move-local", position: { x: Math.max(-10, Math.min(10, picked.pickedPoint.x)), y: 0, z: Math.max(-10, Math.min(10, picked.pickedPoint.z)) } });
    }
  });
  return () => { scene.onPointerObservable.remove(observer); };
}

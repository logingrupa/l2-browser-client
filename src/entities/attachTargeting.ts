import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import "@babylonjs/core/Culling/ray";
import type { Scene } from "@babylonjs/core/scene";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldPosition } from "../world/worldTypes";
import type { EntityRegistry } from "./EntityRegistry";
import type { DoorTargeting } from "../scene/world/nativeDoorInteractions";

export type PointerDestination = (origin: WorldPosition, direction: WorldPosition) => WorldPosition | null;

function readEntityIdentifier(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  return "clientEntityId" in metadata && typeof metadata.clientEntityId === "string" ? metadata.clientEntityId : null;
}

export function attachTargeting(scene: Scene, registry: EntityRegistry, adapter: GameWorldAdapter, destinationAlongRay?: PointerDestination, interactions?: DoorTargeting): () => void {
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
    const camera = scene.activeCamera;
    if (!destinationAlongRay || !camera) return;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, null, camera);
    const destination = destinationAlongRay({ x: ray.origin.x, y: ray.origin.y, z: ray.origin.z }, { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z });
    if (destination) adapter.dispatch({ type: "move-local", position: destination });
  });
  return () => { scene.onPointerObservable.remove(observer); };
}

import type { WorldNavigation } from "../world/WorldNavigation";
import type { WorldPosition } from "../world/worldTypes";
import type { SourceCollisionCylinder, WorldMovement } from "./worldMovementWiring";

export function createCollisionWorldNavigation(movement: Pick<WorldMovement, "groundBelow" | "isStraightWalkBlocked">, origin: WorldPosition,
  cylinder: SourceCollisionCylinder): WorldNavigation {
  const ground = (position: WorldPosition) => movement.groundBelow(position);
  return {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    ground,
    destination: ground,
    spawn: offset => ground({ x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z }),
    move(from, to) {
      const blocked = movement.isStraightWalkBlocked(from, to, cylinder);
      return { position: blocked ? from : to, blocked };
    },
  };
}

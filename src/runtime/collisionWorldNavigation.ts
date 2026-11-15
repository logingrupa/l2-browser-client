import type { WorldNavigation } from "../world/WorldNavigation";
import type { WorldPosition } from "../world/sourceFrame";
import type { SourceCollisionCylinder, WorldMovement } from "./worldMovementWiring";

export function createCollisionWorldNavigation(movement: Pick<WorldMovement, "groundBelow" | "isStraightWalkBlocked">,
  cylinder: SourceCollisionCylinder): WorldNavigation {
  return {
    destination: (position: WorldPosition) => movement.groundBelow(position),
    move(from, to) {
      const blocked = movement.isStraightWalkBlocked(from, to, cylinder);
      return { position: blocked ? from : to, blocked };
    },
  };
}

import type { WorldEntity, WorldPosition } from "./worldTypes";

export function moveTowards(
  entity: WorldEntity,
  destination: WorldPosition,
  distance: number,
): WorldEntity {
  const differenceX = destination.x - entity.position.x;
  const differenceY = destination.y - entity.position.y;
  const differenceZ = destination.z - entity.position.z;
  const remainingDistance = Math.hypot(differenceX, differenceY, differenceZ);
  const hasArrived = remainingDistance <= distance;
  const movementFraction = hasArrived ? 1 : distance / remainingDistance;
  return {
    ...entity,
    position: {
      x: entity.position.x + differenceX * movementFraction,
      y: entity.position.y + differenceY * movementFraction,
      z: entity.position.z + differenceZ * movementFraction,
    },
    orientationRadians:
      remainingDistance > 0 ? Math.atan2(differenceX, differenceZ) : entity.orientationRadians,
    animation: hasArrived ? "idle" : "run",
  };
}

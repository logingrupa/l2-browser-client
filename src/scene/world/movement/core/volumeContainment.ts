import type { Vector3 } from "../../../../shared/math/vector3";
import type { CollisionVolume } from "./collisionCell";
import { requireFiniteVector } from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import type { MovementNativeRules } from "./movementRules";
import { volumeHoldsPoint } from "./volumeTrace";

export interface ContainingVolume {
  readonly cellId: string;
  readonly volumeIndex: number;
  readonly volume: CollisionVolume;
}

export function volumesContaining(world: CollisionWorld, point: Vector3, rules: MovementNativeRules): readonly ContainingVolume[] {
  requireFiniteVector(point, "A volume containment point");
  return world.residentCells().flatMap(cell => cell.volumes.flatMap((volume, volumeIndex): ContainingVolume[] => {
    if (volume.kind !== "physics" || volume.nodes.length === 0) return [];
    return volumeHoldsPoint(volume, `cell ${cell.cellId} volume ${volumeIndex}`, point, rules) ? [{ cellId: cell.cellId, volumeIndex, volume }] : [];
  }));
}

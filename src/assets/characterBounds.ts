import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

export interface CharacterBounds {
  readonly minimum: Vector3;
  readonly maximum: Vector3;
  readonly labelHeight: number;
  readonly selectionRadius: number;
  readonly pickingHeight: number;
}

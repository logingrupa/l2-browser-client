import type { WorldPosition } from "../world/sourceFrame";

const convergencePerSecond = 12;
const teleportDistanceMetres = 8;

function validatePosition(position: WorldPosition): void {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new RangeError("World positions must contain finite coordinates.");
  }
}

export class PositionInterpolator {
  private currentPosition: WorldPosition;
  private targetPosition: WorldPosition;

  constructor(initialPosition: WorldPosition) {
    validatePosition(initialPosition);
    this.currentPosition = { ...initialPosition };
    this.targetPosition = { ...initialPosition };
  }

  get position(): WorldPosition {
    return { ...this.currentPosition };
  }

  setTarget(position: WorldPosition, shouldSnap = false): void {
    validatePosition(position);
    const distance = Math.hypot(
      position.x - this.currentPosition.x,
      position.y - this.currentPosition.y,
      position.z - this.currentPosition.z,
    );
    this.targetPosition = { ...position };
    if (shouldSnap || distance > teleportDistanceMetres) this.currentPosition = { ...position };
  }

  update(deltaTimeSeconds: number): WorldPosition {
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds < 0) {
      throw new RangeError("Interpolation elapsed time must be finite and non-negative.");
    }
    const blend = -Math.expm1(-convergencePerSecond * deltaTimeSeconds);
    this.currentPosition = {
      x: this.currentPosition.x + (this.targetPosition.x - this.currentPosition.x) * blend,
      y: this.currentPosition.y + (this.targetPosition.y - this.currentPosition.y) * blend,
      z: this.currentPosition.z + (this.targetPosition.z - this.currentPosition.z) * blend,
    };
    return this.position;
  }
}

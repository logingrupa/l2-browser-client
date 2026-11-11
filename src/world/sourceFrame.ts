export interface SourcePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface WorldPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const sourceUnitsPerMetre = 100;
const metresPerSourceUnit = 0.01;
const headingUnitsPerTurn = 65536;
const headingUnitsPerHalfTurn = 32768;

export function sourcePositionToWorld(source: SourcePosition): WorldPosition {
  return { x: source.x * metresPerSourceUnit, y: source.z * metresPerSourceUnit, z: source.y * metresPerSourceUnit };
}

export function worldPositionToSource(world: WorldPosition): SourcePosition {
  return { x: world.x * sourceUnitsPerMetre, y: world.z * sourceUnitsPerMetre, z: world.y * sourceUnitsPerMetre };
}

export function sourceDistanceToWorld(sourceDistance: number): number {
  return sourceDistance * metresPerSourceUnit;
}

export function worldDistanceToSource(worldDistance: number): number {
  return worldDistance * sourceUnitsPerMetre;
}

export function sourceHeadingToWorldYaw(sourceHeading: number): number {
  return -sourceHeading * Math.PI / headingUnitsPerHalfTurn;
}

export function worldYawToSourceHeading(worldYaw: number): number {
  return Math.round(-worldYaw * headingUnitsPerHalfTurn / Math.PI) & (headingUnitsPerTurn - 1);
}

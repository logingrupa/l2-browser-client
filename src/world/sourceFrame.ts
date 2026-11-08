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

export type RotationMatrix = readonly [number, number, number, number, number, number, number, number, number];

const sourceUnitsPerMetre = 100;
const metresPerSourceUnit = 0.01;
const headingUnitsPerTurn = 65536;
const headingUnitsPerHalfTurn = 32768;
const swappedAxisByAxis = [0, 2, 1] as const;

export function sourcePositionToWorld(source: SourcePosition): WorldPosition {
  return { x: source.x * metresPerSourceUnit, y: source.z * metresPerSourceUnit, z: source.y * metresPerSourceUnit };
}

export function worldPositionToSource(world: WorldPosition): SourcePosition {
  return { x: world.x * sourceUnitsPerMetre, y: world.z * sourceUnitsPerMetre, z: world.y * sourceUnitsPerMetre };
}

export function sourceRotationToWorld(sourceRotation: RotationMatrix): RotationMatrix {
  const element = (row: number, column: number) => sourceRotation[swappedAxisByAxis[row]! * 3 + swappedAxisByAxis[column]!]!;
  return [
    element(0, 0), element(0, 1), element(0, 2),
    element(1, 0), element(1, 1), element(1, 2),
    element(2, 0), element(2, 1), element(2, 2),
  ];
}

export function sourceHeadingToWorldYaw(sourceHeading: number): number {
  return -sourceHeading * Math.PI / headingUnitsPerHalfTurn;
}

export function worldYawToSourceHeading(worldYaw: number): number {
  return Math.round(-worldYaw * headingUnitsPerHalfTurn / Math.PI) & (headingUnitsPerTurn - 1);
}

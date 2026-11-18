import { rotatorSineFromTable, type RotatorUnits } from "../../../shared/math/rotator";
import type { NativeVector3 } from "./lightmapRebuildTypes";

type CoordinateAxes = readonly [xAxis: NativeVector3, yAxis: NativeVector3, zAxis: NativeVector3];

const quarterTurnUnits = 0x4000;
const unitCoordinatesXAxis: NativeVector3 = [1, 0, 0];

export function sineTableSine(angle: number): number {
  return rotatorSineFromTable(angle | 0);
}

export function sineTableCosine(angle: number): number {
  return rotatorSineFromTable((angle + quarterTurnUnits) | 0);
}

function transformVectorByAxes(vector: NativeVector3, axes: CoordinateAxes): NativeVector3 {
  const projectOnto = (axis: NativeVector3) => Math.fround((vector[0] * axis[0] + vector[1] * axis[1]) + vector[2] * axis[2]);
  return [projectOnto(axes[0]), projectOnto(axes[1]), projectOnto(axes[2])];
}

function rollAxes(roll: number): CoordinateAxes {
  const sine = sineTableSine(roll), cosine = sineTableCosine(roll);
  return [[1, 0, 0], [0, cosine, sine], [0, -sine, cosine]];
}

function pitchAxes(pitch: number): CoordinateAxes {
  const sine = sineTableSine(pitch), cosine = sineTableCosine(pitch);
  return [[cosine, 0, -sine], [0, 1, 0], [sine, 0, cosine]];
}

function yawAxes(yaw: number): CoordinateAxes {
  const sine = sineTableSine(yaw), cosine = sineTableCosine(yaw);
  return [[cosine, -sine, 0], [sine, cosine, 0], [0, 0, 1]];
}

export function rotatorVector(rotation: RotatorUnits): NativeVector3 {
  const afterRoll = transformVectorByAxes(unitCoordinatesXAxis, rollAxes(rotation.roll));
  const afterPitch = transformVectorByAxes(afterRoll, pitchAxes(rotation.pitch));
  return transformVectorByAxes(afterPitch, yawAxes(rotation.yaw));
}

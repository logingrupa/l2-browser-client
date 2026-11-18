import type { NativeLocalToWorldRows } from "../../../environment/model/staticMeshHourlyLighting";
import type { Vector3 } from "../../../shared/math/vector3";

export type StaticMeshPlacementNormalTransform =
  | { readonly status: "uniform-scale"; readonly rows: NativeLocalToWorldRows }
  | { readonly status: "unresolved"; readonly reason: typeof staticMeshNormalTransformUnresolvedReason };

export const staticMeshNormalTransformUnresolvedReason = "static-mesh-normal-transform-unresolved";

const sourceAxisOfSceneAxis = [0, 2, 1] as const;
const sceneMatrixRowStride = 4;
const float32PlacementRowLengthTolerance = 2 ** -20;

function nativeRow(sceneMatrix: readonly number[], nativeRowIndex: number): Vector3 {
  const start = sourceAxisOfSceneAxis[nativeRowIndex]! * sceneMatrixRowStride;
  const component = (nativeColumn: number) => sceneMatrix[start + sourceAxisOfSceneAxis[nativeColumn]!]!;
  return { x: component(0), y: component(1), z: component(2) };
}

const squaredLength = (row: Vector3) => row.x * row.x + row.y * row.y + row.z * row.z;

export function staticMeshPlacementNormalTransform(sceneMatrix: readonly number[]): StaticMeshPlacementNormalTransform {
  const rows: NativeLocalToWorldRows = [nativeRow(sceneMatrix, 0), nativeRow(sceneMatrix, 1), nativeRow(sceneMatrix, 2)];
  const lengths = rows.map(squaredLength);
  const longest = Math.max(...lengths), shortest = Math.min(...lengths);
  if (longest - shortest > longest * float32PlacementRowLengthTolerance) return { status: "unresolved", reason: staticMeshNormalTransformUnresolvedReason };
  return { status: "uniform-scale", rows };
}

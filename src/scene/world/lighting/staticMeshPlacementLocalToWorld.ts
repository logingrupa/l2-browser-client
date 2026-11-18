import type { NativeLocalToWorld, NativeLocalToWorldRows } from "../../../environment/model/staticMeshLocalToWorld";
import type { Vector3 } from "../../../shared/math/vector3";

export type StaticMeshPlacementLocalToWorld =
  | { readonly status: "uniform-scale"; readonly localToWorld: NativeLocalToWorld }
  | { readonly status: "unresolved"; readonly reason: typeof staticMeshNormalTransformUnresolvedReason };

export const staticMeshNormalTransformUnresolvedReason = "static-mesh-normal-transform-unresolved";

const matrixRowStride = 4;
const originRow = 3;
const float32PlacementRowLengthTolerance = 2 ** -20;

function matrixRow(rowMajorMatrix: Float32Array, row: number): Vector3 {
  const start = row * matrixRowStride;
  return { x: rowMajorMatrix[start]!, y: rowMajorMatrix[start + 1]!, z: rowMajorMatrix[start + 2]! };
}

const squaredLength = (row: Vector3) => row.x * row.x + row.y * row.y + row.z * row.z;

export function staticMeshPlacementLocalToWorld(rowMajorMatrix: Float32Array): StaticMeshPlacementLocalToWorld {
  const rows: NativeLocalToWorldRows = [matrixRow(rowMajorMatrix, 0), matrixRow(rowMajorMatrix, 1), matrixRow(rowMajorMatrix, 2)];
  const lengths = rows.map(squaredLength);
  const longest = Math.max(...lengths), shortest = Math.min(...lengths);
  if (longest - shortest > longest * float32PlacementRowLengthTolerance) return { status: "unresolved", reason: staticMeshNormalTransformUnresolvedReason };
  return { status: "uniform-scale", localToWorld: { rows, origin: matrixRow(rowMajorMatrix, originRow) } };
}

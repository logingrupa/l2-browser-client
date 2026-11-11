import { addVectors, type Vector3 } from "./vector3";

export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export interface AffineMatrix {
  readonly linear: Matrix3;
  readonly translation: Vector3;
}

export const IDENTITY_AFFINE_MATRIX: AffineMatrix = { linear: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: { x: 0, y: 0, z: 0 } };

export function multiplyMatrix3Vector(matrix: Matrix3, vector: Vector3): Vector3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
  };
}

function transposeMatrix3(matrix: Matrix3): Matrix3 {
  return [matrix[0], matrix[3], matrix[6], matrix[1], matrix[4], matrix[7], matrix[2], matrix[5], matrix[8]];
}

function invertMatrix3(matrix: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactor00 = e * i - f * h, cofactor01 = f * g - d * i, cofactor02 = d * h - e * g;
  const determinant = a * cofactor00 + b * cofactor01 + c * cofactor02;
  if (determinant === 0 || !Number.isFinite(determinant)) throw new RangeError("Cannot invert a singular affine matrix.");
  const inverseDeterminant = 1 / determinant;
  return [
    cofactor00 * inverseDeterminant, (c * h - b * i) * inverseDeterminant, (b * f - c * e) * inverseDeterminant,
    cofactor01 * inverseDeterminant, (a * i - c * g) * inverseDeterminant, (c * d - a * f) * inverseDeterminant,
    cofactor02 * inverseDeterminant, (b * g - a * h) * inverseDeterminant, (a * e - b * d) * inverseDeterminant,
  ];
}

export function transformPoint(matrix: AffineMatrix, point: Vector3): Vector3 {
  return addVectors(multiplyMatrix3Vector(matrix.linear, point), matrix.translation);
}

export function inverseTransposeLinear(matrix: AffineMatrix): Matrix3 {
  return transposeMatrix3(invertMatrix3(matrix.linear));
}

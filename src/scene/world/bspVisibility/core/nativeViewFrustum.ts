import { crossProduct, normalizeVector, type Vector3 } from "../../../../shared/math/vector3";

export interface ViewPose {
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly up: Vector3;
  readonly horizontalFieldOfView: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface NativeViewFrustum {
  readonly planes: Float32Array;
}

export interface NativeSceneMatrices {
  readonly eye: Float32Array;
  readonly worldToCamera: Float32Array;
  readonly cameraToScreen: Float32Array;
  readonly worldToScreen: Float32Array;
  readonly screenToWorld: Float32Array;
}

export interface NativeFrustumConstants {
  readonly nearClip: number;
  readonly farClip: number;
  readonly safeNormalThreshold: number;
}

export const nativeFrustumPlaneCount = 4;
export const frustumFlagIntersects = 1;
export const frustumFlagNotFullyInside = 2;
const planeComponentCount = 4;
const matrixSize = 4;
const nearCornerOrder = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
const sidePlaneCornerTriples = [[0, 1], [2, 0], [3, 2], [1, 3]] as const;
const f32 = Math.fround;

const at = (matrix: ArrayLike<number>, row: number, column: number) => matrix[row * matrixSize + column]!;

export function nativeMatrixDeterminant(m: ArrayLike<number>): number {
  const a = at(m, 2, 2) * at(m, 3, 3) - at(m, 3, 2) * at(m, 2, 3);
  const b = at(m, 1, 2) * at(m, 3, 3) - at(m, 1, 3) * at(m, 3, 2);
  const c = at(m, 2, 3) * at(m, 1, 2) - at(m, 1, 3) * at(m, 2, 2);
  const d = at(m, 0, 2) * at(m, 3, 3) - at(m, 3, 2) * at(m, 0, 3);
  const e = at(m, 0, 2) * at(m, 2, 3) - at(m, 2, 2) * at(m, 0, 3);
  const f = at(m, 0, 2) * at(m, 1, 3) - at(m, 1, 2) * at(m, 0, 3);
  const term0 = (at(m, 1, 1) * a - at(m, 2, 1) * b + at(m, 3, 1) * c) * at(m, 0, 0);
  const term1 = (at(m, 0, 1) * a - at(m, 2, 1) * d + at(m, 3, 1) * e) * at(m, 1, 0);
  const term2 = (at(m, 0, 1) * b - at(m, 1, 1) * d + at(m, 3, 1) * f) * at(m, 2, 0);
  const term3 = (at(m, 0, 1) * c - at(m, 1, 1) * e + at(m, 2, 1) * f) * at(m, 3, 0);
  return f32(term0 - term1 + term2 - term3);
}

export function deprojectScreenPoint(m: ArrayLike<number>, x: number, y: number, z: number, w: number): Float32Array {
  const u = f32(x * w), v = f32(y * w), t = f32(z * w);
  return Float32Array.of(
    at(m, 1, 0) * v + at(m, 0, 0) * u + at(m, 2, 0) * t + at(m, 3, 0) * w,
    at(m, 0, 1) * u + at(m, 1, 1) * v + at(m, 2, 1) * t + at(m, 3, 1) * w,
    at(m, 0, 2) * u + at(m, 1, 2) * v + at(m, 2, 2) * t + at(m, 3, 2) * w);
}

function safeNormal(x: number, y: number, z: number, threshold: number): readonly [number, number, number] {
  const squared = f32(y * y + x * x + z * z);
  if (squared < threshold) return [0, 0, 0];
  const inverse = f32(1 / f32(Math.sqrt(squared)));
  return [f32(x * inverse), f32(y * inverse), f32(z * inverse)];
}

function planeThroughPoints(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, threshold: number, planes: Float32Array, offset: number): void {
  const u0 = f32(b[0]! - a[0]!), u1 = f32(b[1]! - a[1]!), u2 = f32(b[2]! - a[2]!);
  const v0 = f32(c[0]! - a[0]!), v1 = f32(c[1]! - a[1]!), v2 = f32(c[2]! - a[2]!);
  const [nx, ny, nz] = safeNormal(f32(u1 * v2 - u2 * v1), f32(u2 * v0 - u0 * v2), f32(u0 * v1 - u1 * v0), threshold);
  planes.set([nx, ny, nz, ny * a[1]! + nx * a[0]! + nz * a[2]!], offset);
}

export function buildNativeViewFrustum(worldToScreen: ArrayLike<number>, screenToWorld: ArrayLike<number>, eye: ArrayLike<number>,
  constants: NativeFrustumConstants): NativeViewFrustum {
  const corners = nearCornerOrder.map(([x, y]) => deprojectScreenPoint(screenToWorld, x, y, 0, constants.nearClip));
  const mirrored = nativeMatrixDeterminant(worldToScreen) < 0;
  const planes = new Float32Array(nativeFrustumPlaneCount * planeComponentCount);
  sidePlaneCornerTriples.forEach(([first, second], plane) => {
    const [b, c] = mirrored ? [corners[second]!, corners[first]!] : [corners[first]!, corners[second]!];
    planeThroughPoints(eye, b, c, constants.safeNormalThreshold, planes, plane * planeComponentCount);
  });
  return { planes };
}

export function planeDistanceSse(frustum: NativeViewFrustum, plane: number, x: number, y: number, z: number): number {
  const p = frustum.planes, offset = plane * planeComponentCount;
  return f32(f32(f32(f32(p[offset + 1]! * y) + f32(p[offset]! * x)) + f32(p[offset + 2]! * z)) - p[offset + 3]!);
}

function groupCheckFlags(frustum: NativeViewFrustum, x: number, y: number, z: number, radiusOfPlane: (plane: number) => number): number {
  let flags = frustumFlagIntersects, crossing = false, outside = false;
  for (let plane = 0; plane < nativeFrustumPlaneCount; plane++) {
    const distance = planeDistanceSse(frustum, plane, x, y, z), radius = radiusOfPlane(plane);
    if (distance > -radius) crossing = true;
    if (distance > radius) outside = true;
  }
  if (crossing) flags |= frustumFlagNotFullyInside;
  if (crossing && outside) flags &= ~frustumFlagIntersects;
  return flags;
}

export function sphereCheckFlags(frustum: NativeViewFrustum, x: number, y: number, z: number, radius: number): number {
  const storedRadius = f32(radius);
  return groupCheckFlags(frustum, x, y, z, () => storedRadius);
}

export function boxCheckFlags(frustum: NativeViewFrustum, box: ArrayLike<number>): number {
  const centre = [0, 1, 2].map(axis => f32(f32(box[axis]! + box[axis + 3]!) * 0.5));
  const extent = [0, 1, 2].map(axis => f32(box[axis + 3]! - centre[axis]!));
  const p = frustum.planes;
  return groupCheckFlags(frustum, centre[0]!, centre[1]!, centre[2]!, plane => {
    const offset = plane * planeComponentCount;
    return f32(f32(Math.abs(f32(p[offset + 1]! * extent[1]!)) + Math.abs(f32(p[offset]! * extent[0]!))) + Math.abs(f32(p[offset + 2]! * extent[2]!)));
  });
}

function multiplyMatrices(left: ArrayLike<number>, right: ArrayLike<number>): Float32Array {
  const product = new Float32Array(matrixSize * matrixSize);
  for (let row = 0; row < matrixSize; row++) for (let column = 0; column < matrixSize; column++) {
    let sum = 0;
    for (let inner = 0; inner < matrixSize; inner++) sum += at(left, row, inner) * at(right, inner, column);
    product[row * matrixSize + column] = sum;
  }
  return product;
}

function invertMatrix(m: ArrayLike<number>): Float32Array {
  const augmented = Array.from({ length: matrixSize }, (_, row) => [...Array.from({ length: matrixSize }, (__, column) => at(m, row, column)),
    ...Array.from({ length: matrixSize }, (__, column) => (row === column ? 1 : 0))]);
  for (let column = 0; column < matrixSize; column++) {
    let pivot = column;
    for (let row = column + 1; row < matrixSize; row++) if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    if (augmented[pivot]![column] === 0) throw new RangeError("The world-to-screen matrix is singular.");
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const pivotRow = augmented[column]!, pivotValue = pivotRow[column]!;
    for (let index = 0; index < 2 * matrixSize; index++) pivotRow[index] = pivotRow[index]! / pivotValue;
    for (let row = 0; row < matrixSize; row++) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let index = 0; index < 2 * matrixSize; index++) augmented[row]![index] = augmented[row]![index]! - factor * pivotRow[index]!;
    }
  }
  return Float32Array.from(augmented.flatMap(row => row.slice(matrixSize)));
}

function perspectiveCameraToScreen(pose: ViewPose, nearClip: number, farClip: number): Float32Array {
  const horizontalScale = 1 / Math.tan(pose.horizontalFieldOfView / 2), depthScale = farClip / (farClip - nearClip);
  return Float32Array.of(horizontalScale, 0, 0, 0, 0, horizontalScale * pose.viewportWidth / pose.viewportHeight, 0, 0, 0, 0, depthScale, 1,
    0, 0, -nearClip * depthScale, 0);
}

function sceneMatricesOf(eye: Float32Array, worldToCamera: Float32Array, cameraToScreen: Float32Array): NativeSceneMatrices {
  return { eye, worldToCamera, cameraToScreen, worldToScreen: multiplyMatrices(worldToCamera, cameraToScreen),
    screenToWorld: multiplyMatrices(invertMatrix(cameraToScreen), invertMatrix(worldToCamera)) };
}

export function nativeSceneMatrices(pose: ViewPose, nearClip: number, farClip: number): NativeSceneMatrices {
  const eye = Float32Array.of(pose.position.x, pose.position.y, pose.position.z);
  const forward = normalizeVector(pose.forward), up = normalizeVector(pose.up), right = normalizeVector(crossProduct(up, forward));
  const axes = [right, up, forward], dot = (axis: Vector3) => axis.x * eye[0]! + axis.y * eye[1]! + axis.z * eye[2]!;
  const worldToCamera = Float32Array.of(right.x, up.x, forward.x, 0, right.y, up.y, forward.y, 0, right.z, up.z, forward.z, 0,
    ...axes.map(axis => -dot(axis)), 1);
  return sceneMatricesOf(eye, worldToCamera, perspectiveCameraToScreen(pose, nearClip, farClip));
}

export function nativeSkySceneMatrices(parent: NativeSceneMatrices, skyLocation: Vector3): NativeSceneMatrices {
  const eye = Float32Array.of(skyLocation.x, skyLocation.y, skyLocation.z);
  const offset = [0, 1, 2].map(axis => parent.eye[axis]! - eye[axis]!);
  const worldToCamera = Float32Array.from(parent.worldToCamera);
  for (let column = 0; column < matrixSize; column++) {
    worldToCamera[3 * matrixSize + column] = offset[0]! * at(parent.worldToCamera, 0, column) + offset[1]! * at(parent.worldToCamera, 1, column)
      + offset[2]! * at(parent.worldToCamera, 2, column) + at(parent.worldToCamera, 3, column);
  }
  return sceneMatricesOf(eye, worldToCamera, parent.cameraToScreen);
}

export function nativeFrustumOfScene(scene: NativeSceneMatrices, constants: NativeFrustumConstants): NativeViewFrustum {
  return buildNativeViewFrustum(scene.worldToScreen, scene.screenToWorld, scene.eye, constants);
}

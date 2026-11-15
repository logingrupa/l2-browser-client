import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";

export interface NativeSliceCameraPose {
  readonly target: readonly number[];
  readonly alpha: number;
  readonly beta: number;
  readonly radius: number;
}

export type NativeSliceCameraPoseCamera = Pick<ArcRotateCamera, "alpha" | "beta" | "radius" | "lowerRadiusLimit" | "upperRadiusLimit" |
  "lowerBetaLimit" | "upperBetaLimit" | "setTarget">;

const targetComponentCount = 3;

function assertFiniteCameraPoseField(field: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RangeError(`Camera pose ${field} must be a finite number, got ${String(value)}.`);
}

function assertWithinCameraLimits(field: "radius" | "beta", value: number, lowerLimitName: string, lowerLimit: number | null,
  upperLimitName: string, upperLimit: number | null): void {
  if (lowerLimit !== null && value < lowerLimit) throw new RangeError(`Camera pose ${field} ${value} is below ${lowerLimitName} ${lowerLimit}.`);
  if (upperLimit !== null && value > upperLimit) throw new RangeError(`Camera pose ${field} ${value} is above ${upperLimitName} ${upperLimit}.`);
}

export function assertNativeSliceCameraPoseWithinLimits(camera: NativeSliceCameraPoseCamera, pose: NativeSliceCameraPose): void {
  if (!Array.isArray(pose.target) || pose.target.length !== targetComponentCount) {
    throw new RangeError(`Camera pose target must hold exactly three components, got ${Array.isArray(pose.target) ? pose.target.length : String(pose.target)}.`);
  }
  pose.target.forEach((component, index) => assertFiniteCameraPoseField(`target[${index}]`, component));
  assertFiniteCameraPoseField("alpha", pose.alpha);
  assertFiniteCameraPoseField("beta", pose.beta);
  assertFiniteCameraPoseField("radius", pose.radius);
  assertWithinCameraLimits("radius", pose.radius, "lowerRadiusLimit", camera.lowerRadiusLimit, "upperRadiusLimit", camera.upperRadiusLimit);
  assertWithinCameraLimits("beta", pose.beta, "lowerBetaLimit", camera.lowerBetaLimit, "upperBetaLimit", camera.upperBetaLimit);
}

export function applyNativeSliceCameraPose(camera: NativeSliceCameraPoseCamera, pose: NativeSliceCameraPose): void {
  assertNativeSliceCameraPoseWithinLimits(camera, pose);
  camera.setTarget(Vector3.FromArray(pose.target), false, false, true);
  camera.alpha = pose.alpha;
  camera.beta = pose.beta;
  camera.radius = pose.radius;
}

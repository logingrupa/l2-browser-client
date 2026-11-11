import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { applyNativeSliceCameraPose, type NativeSliceCameraPose, type NativeSliceCameraPoseCamera } from "../../src/runtime/nativeSliceCameraPose";

interface RecordingCamera extends NativeSliceCameraPoseCamera {
  target: Vector3;
}

function recordingCamera(limits: Partial<Pick<NativeSliceCameraPoseCamera, "lowerRadiusLimit" | "upperRadiusLimit" | "lowerBetaLimit" | "upperBetaLimit">> = {}): RecordingCamera {
  const camera: RecordingCamera = {
    target: new Vector3(.6, .15, 0), alpha: -1.8, beta: 1.15, radius: 4.25,
    lowerRadiusLimit: .4, upperRadiusLimit: 60, lowerBetaLimit: .35, upperBetaLimit: 1.45, ...limits,
    setTarget(target) {
      if (!(target instanceof Vector3)) throw new TypeError("The recording camera only takes a Vector3 target.");
      camera.target = target;
    },
  };
  return camera;
}

function cameraReadOut(camera: RecordingCamera): NativeSliceCameraPose {
  return { target: camera.target.asArray(), alpha: camera.alpha, beta: camera.beta, radius: camera.radius };
}

describe("applyNativeSliceCameraPose", () => {
  it("applies a pose equal to an earlier read-out and reads it back equal", () => {
    const camera = recordingCamera();
    const recordedPose = { target: [12.5, -3, 40.25], alpha: .7, beta: 1.2, radius: 9 };
    applyNativeSliceCameraPose(camera, recordedPose);
    const readOut = cameraReadOut(camera);
    expect(readOut).toEqual(recordedPose);
    camera.alpha = 0; camera.radius = 2;
    applyNativeSliceCameraPose(camera, readOut);
    expect(cameraReadOut(camera)).toEqual(recordedPose);
  });

  it.each([
    ["target[0]", { target: [Number.NaN, 0, 0], alpha: 0, beta: 1, radius: 5 }],
    ["target[2]", { target: [0, 0, Number.POSITIVE_INFINITY], alpha: 0, beta: 1, radius: 5 }],
    ["alpha", { target: [0, 0, 0], alpha: Number.NaN, beta: 1, radius: 5 }],
    ["beta", { target: [0, 0, 0], alpha: 0, beta: Number.NEGATIVE_INFINITY, radius: 5 }],
    ["radius", { target: [0, 0, 0], alpha: 0, beta: 1, radius: Number.NaN }],
  ])("refuses a non-finite %s with a RangeError naming the field and leaves the camera unchanged", (field, pose) => {
    const camera = recordingCamera();
    const before = cameraReadOut(camera);
    expect(() => applyNativeSliceCameraPose(camera, pose)).toThrow(RangeError);
    expect(() => applyNativeSliceCameraPose(camera, pose)).toThrow(`Camera pose ${field} must be a finite number`);
    expect(cameraReadOut(camera)).toEqual(before);
  });

  it("refuses a target that is not three components", () => {
    const camera = recordingCamera();
    const before = cameraReadOut(camera);
    expect(() => applyNativeSliceCameraPose(camera, { target: [0, 0], alpha: 0, beta: 1, radius: 5 })).toThrow(new RangeError("Camera pose target must hold exactly three components, got 2."));
    expect(cameraReadOut(camera)).toEqual(before);
  });

  it.each([
    ["lowerRadiusLimit", { target: [0, 0, 0], alpha: 0, beta: 1, radius: .3 }, "Camera pose radius 0.3 is below lowerRadiusLimit 0.4."],
    ["upperRadiusLimit", { target: [0, 0, 0], alpha: 0, beta: 1, radius: 61 }, "Camera pose radius 61 is above upperRadiusLimit 60."],
    ["lowerBetaLimit", { target: [0, 0, 0], alpha: 0, beta: .2, radius: 5 }, "Camera pose beta 0.2 is below lowerBetaLimit 0.35."],
    ["upperBetaLimit", { target: [0, 0, 0], alpha: 0, beta: 1.5, radius: 5 }, "Camera pose beta 1.5 is above upperBetaLimit 1.45."],
  ])("refuses a pose outside %s with a RangeError naming the limit and never clamps", (_limit, pose, message) => {
    const camera = recordingCamera();
    const before = cameraReadOut(camera);
    expect(() => applyNativeSliceCameraPose(camera, pose)).toThrow(new RangeError(message));
    expect(cameraReadOut(camera)).toEqual(before);
  });

  it("treats a null limit as no bound", () => {
    const camera = recordingCamera({ lowerRadiusLimit: null, upperRadiusLimit: null, lowerBetaLimit: null, upperBetaLimit: null });
    const unboundedPose = { target: [1, 2, 3], alpha: 4, beta: 3, radius: 500 };
    applyNativeSliceCameraPose(camera, unboundedPose);
    expect(cameraReadOut(camera)).toEqual(unboundedPose);
  });
});

import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationState } from "../world/worldTypes";
import type { CharacterAnimationDriver } from "./CharacterAnimator";

export interface CharacterJoints {
  readonly body: TransformNode;
  readonly leftArm: TransformNode;
  readonly rightArm: TransformNode;
  readonly leftLeg: TransformNode;
  readonly rightLeg: TransformNode;
}

interface CharacterPose {
  readonly height: number;
  readonly lean: number;
  readonly twist: number;
  readonly leftArm: number;
  readonly rightArm: number;
  readonly rightArmSweep: number;
  readonly leftLeg: number;
  readonly rightLeg: number;
}

const restingPose: CharacterPose = {
  height: 0, lean: 0, twist: 0, leftArm: 0, rightArm: 0,
  rightArmSweep: 0, leftLeg: 0, rightLeg: 0,
};

function poseFor(state: AnimationState, elapsedSeconds: number): CharacterPose {
  if (state === "run") {
    const stride = Math.sin(elapsedSeconds * 10);
    return {
      height: Math.abs(stride) * 0.065, lean: 0.12, twist: stride * 0.06,
      leftArm: stride * 0.7, rightArm: -stride * 0.7, rightArmSweep: 0,
      leftLeg: -stride * 0.72, rightLeg: stride * 0.72,
    };
  }
  if (state === "attack") {
    const swing = Math.sin(elapsedSeconds * Math.PI * 2 / 0.9);
    return {
      height: 0.025, lean: 0.1, twist: swing * 0.32,
      leftArm: -0.45, rightArm: -1.45 + swing * 0.75,
      rightArmSweep: swing * 0.85, leftLeg: 0.16, rightLeg: -0.16,
    };
  }
  const breath = Math.sin(elapsedSeconds * 2.2);
  return { ...restingPose, height: breath * 0.018, leftArm: breath * 0.035, rightArm: -breath * 0.035 };
}

function blendPose(from: CharacterPose, to: CharacterPose, fraction: number): CharacterPose {
  const blend = (start: number, end: number): number => start + (end - start) * fraction;
  return {
    height: blend(from.height, to.height), lean: blend(from.lean, to.lean),
    twist: blend(from.twist, to.twist), leftArm: blend(from.leftArm, to.leftArm),
    rightArm: blend(from.rightArm, to.rightArm), rightArmSweep: blend(from.rightArmSweep, to.rightArmSweep),
    leftLeg: blend(from.leftLeg, to.leftLeg), rightLeg: blend(from.rightLeg, to.rightLeg),
  };
}

/** Small joint poses keep placeholders visibly animated without external assets. */
export class ProceduralAnimator implements CharacterAnimationDriver {
  private state: AnimationState = "idle";
  private elapsedSeconds = 0;
  private transitionSeconds = 1;
  private previousPose = restingPose;
  private currentPose = restingPose;
  private isDisposed = false;

  constructor(private readonly joints: CharacterJoints) {}

  setState(state: AnimationState): void {
    if (this.isDisposed || state === this.state) return;
    this.previousPose = this.currentPose;
    this.state = state;
    this.elapsedSeconds = 0;
    this.transitionSeconds = 0;
  }

  update(deltaTimeSeconds: number): void {
    if (this.isDisposed) return;
    this.elapsedSeconds += deltaTimeSeconds;
    this.transitionSeconds += deltaTimeSeconds;
    const progress = Math.min(1, this.transitionSeconds / 0.16);
    const easedProgress = progress * progress * (3 - 2 * progress);
    this.currentPose = blendPose(this.previousPose, poseFor(this.state, this.elapsedSeconds), easedProgress);
    const pose = this.currentPose;
    this.joints.body.position.y = pose.height;
    this.joints.body.rotation.set(pose.lean, pose.twist, 0);
    this.joints.leftArm.rotation.x = pose.leftArm;
    this.joints.rightArm.rotation.set(pose.rightArm, pose.rightArmSweep, 0);
    this.joints.leftLeg.rotation.x = pose.leftLeg;
    this.joints.rightLeg.rotation.x = pose.rightLeg;
  }

  dispose(): void {
    this.isDisposed = true;
  }
}

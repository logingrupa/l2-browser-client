import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator } from "../../src/animation/CharacterAnimator";
import { ProceduralAnimator } from "../../src/animation/ProceduralAnimator";
import { createProceduralCharacter } from "../../src/assets/createProceduralCharacter";
import { createInitialWorld } from "../../src/world/createInitialWorld";

describe("character animation presentation", () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  function createAnimatedCharacter() {
    const entity = createInitialWorld()[0];
    if (!entity) throw new Error("Initial world needs a local player.");
    const character = createProceduralCharacter(scene, entity);
    const animator = new CharacterAnimator(new ProceduralAnimator(character.joints));
    return { character, animator };
  }

  it("shows idle breathing, alternating running limbs and a distinct attack pose", () => {
    const { character, animator } = createAnimatedCharacter();
    animator.update(0.4);
    expect(character.joints.body.position.y).not.toBe(0);
    animator.setState("run");
    animator.update(0.3);
    expect(animator.state).toBe("run");
    expect(character.joints.leftLeg.rotation.x).not.toBe(0);
    expect(character.joints.leftLeg.rotation.x).toBeCloseTo(-character.joints.rightLeg.rotation.x);
    animator.setState("attack");
    animator.update(0.3);
    expect(animator.state).toBe("attack");
    expect(Math.abs(character.joints.rightArm.rotation.x)).toBeGreaterThan(0.7);
    expect(character.joints.rightArm.rotation.y).not.toBe(0);
    animator.setState("idle");
    animator.update(0.3);
    expect(character.joints.leftLeg.rotation.x).toBe(0);
    expect(character.joints.rightArm.rotation.y).toBe(0);
    expect(character.root.position.asArray()).toEqual([0, 0, 0]);
  });

  it("does not restart unchanged states and blends transitions from the displayed pose", () => {
    const first = createAnimatedCharacter();
    const second = createAnimatedCharacter();
    first.animator.setState("run");
    second.animator.setState("run");
    first.animator.update(0.2);
    first.animator.setState("run");
    first.animator.update(0.1);
    second.animator.update(0.3);
    expect(first.character.joints.leftLeg.rotation.x).toBeCloseTo(second.character.joints.leftLeg.rotation.x);
    const previousArm = first.character.joints.rightArm.rotation.x;
    first.animator.setState("attack");
    first.animator.update(0);
    expect(first.character.joints.rightArm.rotation.x).toBe(previousArm);
  });

  it("rejects invalid elapsed time and stops updates after disposal", () => {
    const { character, animator } = createAnimatedCharacter();
    expect(() => animator.update(Number.NaN)).toThrow(RangeError);
    expect(() => animator.update(-1)).toThrow(RangeError);
    animator.setState("run");
    animator.update(0.2);
    const displayedArm = character.joints.rightArm.rotation.x;
    animator.dispose();
    animator.setState("attack");
    animator.update(1);
    expect(animator.state).toBe("run");
    expect(character.joints.rightArm.rotation.x).toBe(displayedArm);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator } from "../../src/animation/CharacterAnimator";
import { findCharacterClips, ModelAnimator, type CharacterAnimationProfile } from "../../src/animation/ModelAnimator";
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

  function makeClip(name: string): AnimationGroup {
    const target = new TransformNode(`${name}-target`, scene);
    const animation = new Animation(name, "rotation.x", 30, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([{ frame: 0, value: 0 }, { frame: 30, value: 1 }]);
    const group = new AnimationGroup(name, scene);
    group.addTargetedAnimation(animation, target);
    return group;
  }

  const nativeProfile: CharacterAnimationProfile = {
    idle: { name: "wait_Hand", loop: true, transitionSeconds: 0.2 },
    run: { name: "run_Hand", loop: true, transitionSeconds: 0.12 },
    attack: { name: "Atk01_Hand", loop: false, transitionSeconds: 0.06 },
  };

  function nativeClips() {
    return { idle: makeClip("wait_Hand"), run: makeClip("run_Hand"), attack: makeClip("Atk01_Hand") };
  }

  function advance(animators: readonly CharacterAnimator[], seconds: number): void {
    // Step Babylon's actual animation engine as well as the presentation crossfade.
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.01) {
      scene._animate(10);
      animators.forEach(animator => animator.update(0.01));
    }
  }

  it("maps supported clip aliases and rejects incomplete model animation", () => {
    const idle = makeClip(" Idle ");
    const run = makeClip("walking");
    const attack = makeClip("Melee");
    expect(findCharacterClips([idle, run])).toBeUndefined();
    expect(findCharacterClips([idle, run, new AnimationGroup("attack", scene)])).toBeUndefined();
    expect(findCharacterClips([idle, run, attack])).toEqual({ idle, run, attack });
  });

  it("crossfades independent model groups and stops playback on disposal", () => {
    const clips = { idle: makeClip("idle"), run: makeClip("run"), attack: makeClip("attack") };
    const animator = new CharacterAnimator(new ModelAnimator(clips));
    expect(clips.idle.isPlaying).toBe(true);
    animator.setState("run");
    animator.update(0.08);
    expect(clips.idle.weight).toBeCloseTo(0.5);
    expect(clips.run.weight).toBeCloseTo(0.5);
    animator.update(0.08);
    expect(clips.idle.isPlaying).toBe(false);
    expect(clips.run.isPlaying).toBe(true);
    animator.setState("attack");
    animator.update(0.2);
    expect(clips.run.isPlaying).toBe(false);
    expect(clips.attack.isPlaying).toBe(true);
    animator.dispose();
    expect(Object.values(clips).every(group => !group.isPlaying)).toBe(true);
  });

  it("resolves exact native names from a profile without rewriting asset identifiers", () => {
    const clips = nativeClips();
    expect(findCharacterClips(Object.values(clips))).toBeUndefined();
    expect(findCharacterClips(Object.values(clips), nativeProfile)).toEqual(clips);
    expect(findCharacterClips([clips.idle, clips.run, makeClip("atk01_hand")], nativeProfile)).toBeUndefined();
    expect(Object.values(clips).map(group => group.name)).toEqual(["wait_Hand", "run_Hand", "Atk01_Hand"]);
  });

  it("plays one native attack, returns visually to idle, and replays only on an explicit trigger", () => {
    const clips = nativeClips();
    const animator = new CharacterAnimator(new ModelAnimator(clips, nativeProfile));
    animator.setState("attack");
    advance([animator], 0.3);
    expect(clips.attack.loopAnimation).toBe(false);
    const attackFrame = clips.attack.getCurrentFrame();
    expect(attackFrame).toBeGreaterThan(5);
    animator.setState("attack");
    expect(clips.attack.getCurrentFrame()).toBeCloseTo(attackFrame);
    advance([animator], 1.2);
    expect(animator.state).toBe("attack");
    expect(animator.playback?.activeClip).toBe("wait_Hand");
    expect(clips.idle.isPlaying).toBe(true);
    expect(clips.attack.isPlaying).toBe(false);
    animator.setState("attack");
    advance([animator], 0.2);
    expect(animator.playback?.activeClip).toBe("wait_Hand");
    animator.setState("attack", true);
    advance([animator], 0.2);
    expect(animator.playback?.activeClip).toBe("Atk01_Hand");
    expect(clips.attack.getCurrentFrame()).toBeLessThan(attackFrame);
  });

  it("keeps a complete pose through the one-shot ending, including a stalled frame", () => {
    const target = new TransformNode("shared-rig-joint", scene);
    const clips = nativeClips();
    for (const [state, group] of Object.entries(clips)) {
      const track = group.targetedAnimations[0];
      if (!track) throw new Error("Test clip needs a target.");
      track.target = target;
      track.animation.setKeys([{ frame: 0, value: state === "idle" ? 0.3 : 0.8 }, { frame: 30, value: state === "idle" ? 0.3 : 1.2 }]);
    }
    const animator = new CharacterAnimator(new ModelAnimator(clips, nativeProfile));
    animator.setState("attack");
    advance([animator], 0.2);
    scene._animate(2000);
    animator.update(0.1);
    expect(animator.playback?.activeClip).toBe("wait_Hand");
    scene._animate(10);
    expect(target.rotation.x).toBeCloseTo(0.3);
    expect(clips.idle.weight).toBe(1);
  });

  it("preserves blended weights during rapid changes and releases every outgoing group", () => {
    const clips = nativeClips();
    const animator = new CharacterAnimator(new ModelAnimator(clips, nativeProfile));
    animator.setState("run");
    animator.update(0.06);
    expect(clips.run.weight).toBeCloseTo(0.5);
    animator.setState("attack");
    expect(clips.run.weight).toBeCloseTo(0.5);
    expect(clips.idle.weight).toBeCloseTo(0.5);
    animator.update(0.03);
    expect(clips.idle.weight + clips.run.weight + clips.attack.weight).toBeCloseTo(1);
    animator.setState("run");
    animator.update(0.12);
    expect(clips.run.weight).toBe(1);
    expect(clips.idle.isPlaying).toBe(false);
    expect(clips.attack.isPlaying).toBe(false);
    animator.dispose();
    expect(scene.getAllAnimatablesByTarget(clips.run.targetedAnimations[0]?.target)).toHaveLength(0);
  });

  it("keeps separately loaded character groups independent and stops only the disposed driver", () => {
    const firstClips = nativeClips();
    const secondClips = nativeClips();
    const first = new CharacterAnimator(new ModelAnimator(firstClips, nativeProfile));
    const second = new CharacterAnimator(new ModelAnimator(secondClips, nativeProfile));
    first.setState("attack");
    second.setState("run");
    advance([first, second], 0.3);
    expect(first.playback?.activeClip).toBe("Atk01_Hand");
    expect(second.playback?.activeClip).toBe("run_Hand");
    first.dispose();
    advance([second], 0.3);
    expect(Object.values(firstClips).every(group => !group.isStarted)).toBe(true);
    expect(secondClips.run.isPlaying).toBe(true);
  });
});

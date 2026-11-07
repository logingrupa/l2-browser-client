import { describe, expect, it } from "vitest";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createNativeClipPlayback, sampleNativeLoop, sampleNativeOnce } from "../../src/assets/package/nativeClipPlayback";

describe("native UE2 animation time", () => {
  it("interpolates the last sparse translation key to key zero over the full source duration without modifying keys", () => {
    const animation = new Animation("Native position", "position", 60, Animation.ANIMATIONTYPE_VECTOR3);
    animation.setKeys([{ frame: 0, value: new Vector3(0, 0, 0) }, { frame: 90, value: new Vector3(6, 0, 0) }]);
    const before = animation.getKeys().map(key => ({ frame: key.frame, value: key.value.asArray() }));
    expect((sampleNativeLoop(animation, 1, 2) as Vector3).x).toBeCloseTo(4);
    expect((sampleNativeLoop(animation, 1.75, 2) as Vector3).x).toBeCloseTo(3);
    expect((sampleNativeLoop(animation, 2, 2) as Vector3).x).toBe(0);
    expect(animation.getKeys().map(key => ({ frame: key.frame, value: key.value.asArray() }))).toEqual(before);
  });
  it("uses quaternion slerp across the source wrap interval and holds one-key tracks", () => {
    const rotation = new Animation("Native rotation", "rotationQuaternion", 60, Animation.ANIMATIONTYPE_QUATERNION);
    const first = Quaternion.Identity(), last = Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2);
    rotation.setKeys([{ frame: 0, value: first }, { frame: 90, value: last }]);
    const actual = sampleNativeLoop(rotation, 1.75, 2) as Quaternion, expected = Quaternion.Slerp(last, first, .5);
    expect(actual.asArray()).toEqual(expected.asArray());
    const constant = new Animation("Native constant", "position", 60, Animation.ANIMATIONTYPE_VECTOR3);
    constant.setKeys([{ frame: 0, value: new Vector3(1, 2, 3) }]);
    expect((sampleNativeLoop(constant, 1.75, 2) as Vector3).asArray()).toEqual([1, 2, 3]);
  });
  it("pauses and resumes a source-duration clock independently from Babylon's last-key clamp", () => {
    const engine = new NullEngine(), scene = new Scene(engine), group = new AnimationGroup("Native", scene);
    try {
      const animation = new Animation("Position", "position", 60, Animation.ANIMATIONTYPE_VECTOR3);
      animation.setKeys([{ frame: 0, value: Vector3.Zero() }, { frame: 90, value: new Vector3(6, 0, 0) }]);
      const target = { position: Vector3.Zero() }; group.addTargetedAnimation(animation, target);
      const playback = createNativeClipPlayback(group, 2); playback.play(); playback.advance(1.75);
      expect(target.position.x).toBeCloseTo(3); expect(playback.loopCount).toBe(0);
      playback.pause(); playback.advance(10); expect(playback.timeSeconds).toBe(1.75);
      playback.play(); playback.advance(.25); expect(playback.timeSeconds).toBe(0); expect(playback.loopCount).toBe(1); expect(target.position.x).toBe(0);
      expect(group.targetedAnimations[0]!.animation.getKeys()).toHaveLength(2);
    } finally { scene.dispose(); engine.dispose(); }
  });
  it("plays death once, holds its final pose after a stall and restarts only explicitly", () => {
    const engine = new NullEngine(), scene = new Scene(engine), group = new AnimationGroup("death", scene);
    try {
      const animation = new Animation("Death", "position", 30, Animation.ANIMATIONTYPE_VECTOR3);
      animation.setKeys([{ frame: 0, value: new Vector3(0, 1, 0) }, { frame: 90, value: new Vector3(0, .1, 0) }]);
      const target = { position: Vector3.Zero() }; group.addTargetedAnimation(animation, target);
      const duration = 91 / 30, playback = createNativeClipPlayback(group, duration, "once");
      expect((sampleNativeOnce(animation, 90.5 / 30, duration) as Vector3).y).toBe(.1);
      playback.play(); playback.advance(10);
      expect(playback.timeSeconds).toBe(duration); expect(playback.elapsedSeconds).toBe(duration);
      expect(playback.loopCount).toBe(0); expect(playback.completed).toBe(true); expect(playback.playing).toBe(false);
      expect(target.position.y).toBe(.1);
      playback.play(); playback.advance(1); expect(target.position.y).toBe(.1);
      playback.restart(); expect(playback.completed).toBe(false); expect(playback.playing).toBe(true); expect(target.position.y).toBe(1);
      playback.advance(1.5); expect(target.position.y).toBeCloseTo(.55);
      playback.pause(); playback.seek(3); expect(target.position.y).toBe(.1); expect(playback.playing).toBe(false);
      target.position.y = 99;
      expect(animation.getKeys().at(-1)!.value.y).toBe(.1);
      expect(() => playback.seek(Number.NaN)).toThrow(); expect(() => playback.advance(-1)).toThrow();
    } finally { scene.dispose(); engine.dispose(); }
  });
});

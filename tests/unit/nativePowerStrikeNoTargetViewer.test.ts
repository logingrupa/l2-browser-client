import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EffectBundle } from "../../src/effects/nativeEffectComponents";
import { createNativeEffectShotPreview, type NativeShotEffectFrame } from "../../src/effects/nativeEffectShotPreview";
import { createNativePowerStrikePreview, type PowerStrikeSelection } from "../../src/effects/nativePowerStrikePreview";
import type { NativePowerStrikeShotSource } from "../../src/effects/nativePowerStrikeSource";
import type { EmitterActorPlayback } from "../../src/effects/particles/render/emitterActorPlayback";

const shotClip = "SpAtk01_1HS";
const shotSource = { clip: shotClip, durationSeconds: 1.5, eventSeconds: 0.5 } as unknown as NativePowerStrikeShotSource;
const shotBundle = { manifest: { actors: [{ object: "lineageeffect.p_u004_a", dispatchStages: ["shot"] }] } } as unknown as EffectBundle;
const casterPivotPosition = new Vector3(1.2, 0.3, -4);
const casterCollisionRadius = 0.09;

function readyToggle() {
  let enabled = false;
  return { setEnabled: vi.fn(async (value: boolean) => { enabled = value; }), snapshot: () => ({ enabled, status: enabled ? "armed" : "off", error: null }),
    armNoTargetViewer: vi.fn() };
}

describe("Power Strike no-target viewer start", () => {
  it("prepares both stages, arms the shot viewer and dispatches the special attack with no target and no selection", async () => {
    const init = readyToggle(), shot = readyToggle(), dispatched: (string | null)[] = [];
    shot.armNoTargetViewer.mockImplementation(() => expect(dispatched).toEqual([]));
    const preview = createNativePowerStrikePreview(init, shot, () => null, () => true, async () => undefined,
      targetId => dispatched.push(targetId), () => () => undefined);
    await preview.startNoTargetViewer();
    expect(dispatched).toEqual([null]);
    expect(shot.armNoTargetViewer).toHaveBeenCalledTimes(1);
    expect(preview.snapshot()).toMatchObject({ noTargetViewer: true, targetId: null, error: null, requested: 1, damageDispatched: false });
  });

  it("keeps the targeted start bound to a selection and never arms the viewer there", async () => {
    const init = readyToggle(), shot = readyToggle(), dispatched: (string | null)[] = [];
    const musveren: PowerStrikeSelection = { id: "native-musveren", name: "Greater Musveren", rootUniqueId: 7, isValid: () => true };
    let selection: PowerStrikeSelection | null = null;
    const preview = createNativePowerStrikePreview(init, shot, () => selection, () => true, async () => undefined,
      targetId => dispatched.push(targetId), () => () => undefined);
    await preview.start();
    expect(preview.snapshot().error).toBe("Select the living Greater Musveren before starting this preview.");
    selection = musveren;
    await preview.start();
    expect(dispatched).toEqual(["native-musveren"]);
    expect(shot.armNoTargetViewer).not.toHaveBeenCalled();
    expect(preview.snapshot().noTargetViewer).toBe(false);
  });
});

describe("shot preview no-target viewer run", () => {
  let engine: NullEngine | null = null;
  afterEach(() => { engine?.dispose(); engine = null; });

  function shotPreviewWithFrame() {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const casterRoot = new TransformNode("caster", scene), playbackRoot = new TransformNode("shot", scene);
    const playback = { root: playbackRoot, playing: true, start: vi.fn(), stop: vi.fn(), advance: vi.fn(), dispose: vi.fn(),
      inspect: () => null, bounds: () => null } as unknown as EmitterActorPlayback;
    const caster = { entityId: "local-player", root: casterRoot, isValid: () => true,
      getWorldPositionToRef: (out: Vector3) => { out.copyFrom(casterPivotPosition); return true; } };
    const frame: { current: NativeShotEffectFrame } = { current: { caster, casterCollisionRadius, target: null, targetId: null, clock: null,
      sequence: 0, action: null, animation: "idle", alive: true } };
    const shot = createNativeEffectShotPreview(scene, shotBundle, shotSource, () => frame.current, new AbortController().signal, async () => playback);
    const castAt = (sequence: number, elapsedSeconds: number) => {
      frame.current = { ...frame.current, sequence, action: "special-attack", animation: "attack",
        clock: { clip: shotClip, mode: "once", elapsedSeconds, durationSeconds: 1.5, playing: true, completed: false } };
      shot.update();
    };
    return { shot, playbackRoot, castAt };
  }

  it("fires at AttackShot on the caster with rotation 0 and half the caster radius back along source +X", async () => {
    const { shot, playbackRoot, castAt } = shotPreviewWithFrame();
    await shot.setEnabled(true);
    shot.armNoTargetViewer();
    castAt(1, 0.1);
    expect(shot.snapshot()).toMatchObject({ status: "waiting", noTargetViewer: true, targetId: null });
    castAt(1, 0.5);
    const placement = shot.snapshot().placement!;
    expect(placement.policy).toBe("pawnviewer-self-target-v1");
    expect(placement.position[0]).toBeCloseTo(casterPivotPosition.x - casterCollisionRadius / 2, 12);
    expect([placement.position[1], placement.position[2], ...placement.quaternion]).toEqual([casterPivotPosition.y, casterPivotPosition.z, 0, 0, 0, 1]);
    expect(playbackRoot.position.asArray()).toEqual(placement.position);
    expect(shot.snapshot()).toMatchObject({ status: "playing", shots: 1 });
  });

  it("ignores a no-target special attack that the viewer button did not arm", async () => {
    const { shot, castAt } = shotPreviewWithFrame();
    await shot.setEnabled(true);
    castAt(1, 0.5);
    expect(shot.snapshot()).toMatchObject({ status: "armed", shots: 0, noTargetViewer: false, placement: null });
  });
});

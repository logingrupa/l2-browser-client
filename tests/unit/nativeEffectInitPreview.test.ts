import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import { createNativeEffectInitPreview, type NativeInitEffectFrame } from "../../src/effects/nativeEffectInitPreview";
import { parseEffectManifest, type EffectBundle } from "../../src/effects/nativeEffectComponents";
import type { EmitterActorPlayback, loadEmitterActorPlayback } from "../../src/effects/particles/render/emitterActorPlayback";

const HASH = "82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd";
const manifest = parseEffectManifest(JSON.parse(readFileSync(`public/l2/effects/${HASH}/manifest.json`, "utf8")));
const CLIP = "SpAtk01_1HS";
const DURATION = 47 / 30;
type FakePlayback = Omit<EmitterActorPlayback, "dispose" | "setPins" | "start" | "advance"> & { dispose: Mock<EmitterActorPlayback["dispose"]>; setPins: Mock<EmitterActorPlayback["setPins"]>;
  start: Mock<EmitterActorPlayback["start"]>; advance: Mock<EmitterActorPlayback["advance"]>; finish(): void };
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); vi.restoreAllMocks(); });

function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine), lifetime = new AbortController();
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const rig = new TransformNode("original-rig", scene), hand = new TransformNode("qualified-hand", scene);
  hand.parent = rig;
  let valid = true;
  const state: NativeInitEffectFrame = { anchor: { root: hand, isValid: () => valid }, sequence: 0, action: null,
    animation: "idle", alive: true, clock: { clip: "Wait", mode: "loop", elapsedSeconds: 0,
      durationSeconds: 1, playing: true, completed: false } };
  const bundle: EffectBundle = { manifest: structuredClone(manifest), manifestSha256: HASH,
    readResource: vi.fn(async () => { throw new Error("manager must not read resources directly"); }) };
  function prepared(): FakePlayback {
    const root = new TransformNode("owned-init-playback", scene); root.setEnabled(false);
    let playing = false;
    return {
      root, components: [], get playing() { return playing; },
      start: vi.fn<EmitterActorPlayback["start"]>(() => { playing = true; root.setEnabled(true); }), stop: vi.fn(() => { playing = false; root.setEnabled(false); }),
      advance: vi.fn<EmitterActorPlayback["advance"]>(), setPins: vi.fn<EmitterActorPlayback["setPins"]>(), liveParticles: () => playing ? 5 : 0, bounds: () => null,
      applyNative: () => { throw new Error("the init preview applies no emitter native"); },
      inspect: () => ({ playing }) as unknown as ReturnType<EmitterActorPlayback["inspect"]>,
      dispose: vi.fn<EmitterActorPlayback["dispose"]>(() => root.dispose()), finish: () => { playing = false; root.setEnabled(false); },
    };
  }
  const prepare = vi.fn<typeof loadEmitterActorPlayback>(async () => prepared());
  const preview = createNativeEffectInitPreview(scene, bundle, CLIP, () => state, lifetime.signal, prepare);
  releases.push(preview.dispose);
  function clock(seconds: number, changes: Partial<NativeActorClock> = {}) {
    state.clock = { clip: CLIP, mode: "once", elapsedSeconds: seconds, durationSeconds: DURATION,
      playing: true, completed: false, ...changes };
  }
  function start(seconds = 0) { state.sequence++; state.action = "special-attack"; state.animation = "attack"; clock(seconds); preview.update(); }
  const playback = async (index = 0) => await prepare.mock.results[index]!.value as FakePlayback;
  return { engine, scene, lifetime, rig, hand, state, bundle, preview, prepare, prepared, clock, start, playback,
    invalidate: () => { valid = false; }, replace: () => { state.anchor = { root: new TransformNode("replacement-hand", scene), isValid: () => true }; } };
}

describe("simulated source-clock init preview lifecycle", () => {
  it("allocates nothing while off, then arms the init actor of the bundle on the hand without starting an action", async () => {
    const f = fixture(); f.preview.update(); expect(f.prepare).not.toHaveBeenCalled();
    expect(f.preview.snapshot()).toMatchObject({ status: "off", runs: 0, pending: false });
    await f.preview.setEnabled(true); const playback = await f.playback();
    expect(f.prepare.mock.calls[0]![2]).toMatchObject({ actorObject: "lineageeffect.s_u002_a", emitterObjects: null });
    expect(playback.root.parent).toBe(f.hand); expect(playback.start).not.toHaveBeenCalled();
    expect(f.preview.snapshot()).toMatchObject({ status: "armed", enabled: true, runs: 0, actorObject: "lineageeffect.s_u002_a" });
    expect(f.state.action).toBeNull(); expect(f.bundle.readResource).not.toHaveBeenCalled();
  });

  it("advances the simulator by the source clock, holds on pause and restarts the same playback on retrigger", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const playback = await f.playback();
    f.start(.2); expect(playback.start).toHaveBeenCalledOnce(); expect(playback.advance).toHaveBeenLastCalledWith(.2);
    f.clock(.7); f.preview.update(); expect(playback.advance.mock.lastCall![0]).toBeCloseTo(.5);
    f.clock(.7, { playing: false }); f.preview.update(); expect(playback.advance).toHaveBeenLastCalledWith(0);
    f.start(.1); expect(playback.start).toHaveBeenCalledTimes(2); expect(playback.advance).toHaveBeenLastCalledWith(.1);
    expect(f.preview.snapshot()).toMatchObject({ status: "playing", runs: 2, generation: 2, sourceSeconds: .1 });
    expect(f.prepare).toHaveBeenCalledOnce(); expect(playback.root.parent).toBe(f.hand);
  });

  it("does not join an action already playing when enabled", async () => {
    const f = fixture(); f.start(.2); await f.preview.setEnabled(true);
    f.clock(.6); f.preview.update(); expect(f.preview.snapshot()).toMatchObject({ status: "armed", runs: 0 });
    f.start(.1); expect(f.preview.snapshot()).toMatchObject({ status: "playing", runs: 1, sourceSeconds: .1 });
  });

  it("does not join a generation started while resources were loading", async () => {
    const f = fixture(); let resolve!: (playback: EmitterActorPlayback) => void;
    f.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const loading = f.preview.setEnabled(true); f.start(.2); resolve(f.prepared()); await loading;
    f.clock(.8); f.preview.update(); expect(f.preview.snapshot()).toMatchObject({ status: "armed", runs: 0 });
    f.start(); expect(f.preview.snapshot()).toMatchObject({ status: "playing", runs: 1 });
  });

  it("requires the explicit special action and qualified once clip, not an ordinary attack", async () => {
    const f = fixture(); await f.preview.setEnabled(true);
    f.state.sequence++; f.state.action = "attack"; f.state.animation = "attack"; f.clock(.2); f.preview.update();
    expect(f.preview.snapshot().runs).toBe(0);
    f.state.sequence++; f.state.action = "special-attack"; f.clock(.2, { clip: "Atck01" }); f.preview.update();
    expect(f.preview.snapshot().runs).toBe(0);
    f.start(); expect(f.preview.snapshot().runs).toBe(1);
  });

  it("completes when the simulator destroys the emitter actor, retaining the loaded resources", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const playback = await f.playback();
    f.start(.3); playback.finish(); f.clock(.9); f.preview.update(); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "completed", runs: 1 });
    expect(playback.root.isEnabled()).toBe(false); expect(playback.root.isDisposed()).toBe(false);
    f.start(.3); expect(f.preview.snapshot().runs).toBe(2); expect(f.prepare).toHaveBeenCalledOnce();
  });

  it("recognizes driver idle after completion of the same generation", async () => {
    const f = fixture(); await f.preview.setEnabled(true); f.start(1.4);
    f.clock(0, { clip: "Wait", mode: "loop", durationSeconds: 1 }); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "completed", generation: 1, interruption: null });
  });

  it("hides on action interruption and waits for a subsequent special generation", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const playback = await f.playback(); f.start(.3);
    f.state.sequence++; f.state.action = null; f.state.animation = "run"; f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "armed", interruption: "action-changed", runs: 1 });
    expect(playback.root.isEnabled()).toBe(false);
    f.state.action = "special-attack"; f.state.animation = "attack"; f.clock(.5); f.preview.update();
    expect(f.preview.snapshot().status).toBe("armed");
    f.start(); expect(f.preview.snapshot()).toMatchObject({ status: "playing", interruption: null, runs: 2 });
  });

  it("does not replay on revival or when an interrupted source clock returns", async () => {
    const f = fixture(); await f.preview.setEnabled(true); f.start(.3);
    f.state.alive = false; f.preview.update(); expect(f.preview.snapshot()).toMatchObject({ status: "armed", interruption: "fighter-dead" });
    f.state.alive = true; f.preview.update(); expect(f.preview.snapshot()).toMatchObject({ status: "armed", runs: 1 });
    f.start(.2); f.state.clock = null; f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "armed", interruption: "source-action-interrupted" });
    f.clock(.3); f.preview.update(); expect(f.preview.snapshot().runs).toBe(2);
  });

  it.each([NaN, -1, Infinity, DURATION + 1])("rejects invalid source time %s without escaping the render loop", async seconds => {
    const f = fixture(); await f.preview.setEnabled(true); f.start(seconds);
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", enabled: false, error: "The original action clock is invalid.", playback: null });
    expect(f.hand.isDisposed()).toBe(false);
  });

  it.each(["rewind", "duration"] as const)("rejects an unrequested %s within one generation", async change => {
    const f = fixture(); await f.preview.setEnabled(true); f.start(.5);
    f.clock(change === "rewind" ? .2 : .6, change === "duration" ? { durationSeconds: 2 } : {}); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", error: "The original action clock changed within a generation." });
  });

  it("disposes Off and an ignored-abort late result without touching the source rig", async () => {
    const f = fixture(); let resolve!: (playback: EmitterActorPlayback) => void;
    f.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const loading = f.preview.setEnabled(true), late = f.prepared(), signal = f.prepare.mock.calls[0]![3];
    await f.preview.setEnabled(false); resolve(late); await loading;
    expect(signal.aborted).toBe(true); expect(late.dispose).toHaveBeenCalledOnce();
    expect(f.preview.snapshot()).toMatchObject({ status: "off", playback: null, pending: false });
    await f.preview.setEnabled(true); f.start(.3); const second = await f.playback(1);
    await f.preview.setEnabled(false); expect(second.root.isDisposed()).toBe(true);
    expect(f.rig.isDisposed()).toBe(false); expect(f.hand.isDisposed()).toBe(false);
  });

  it("fails on borrowed-anchor replacement or ownership loss and never disposes that anchor", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const playback = await f.playback();
    f.start(); f.invalidate(); f.preview.update(); expect(f.preview.snapshot().status).toBe("failed");
    expect(playback.root.isDisposed()).toBe(true); expect(f.hand.isDisposed()).toBe(false);
    const g = fixture(); let resolve!: (playback: EmitterActorPlayback) => void;
    g.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const loading = g.preview.setEnabled(true), late = g.prepared(); g.replace(); resolve(late); await loading;
    expect(g.preview.snapshot().status).toBe("failed"); expect(late.dispose).toHaveBeenCalledOnce();
  });

  it("keeps optional preparation failures local and permits an explicit retry", async () => {
    const f = fixture(); f.prepare.mockRejectedValueOnce(new Error("Original texture hash mismatch"));
    await f.preview.setEnabled(true); expect(f.preview.snapshot()).toMatchObject({ status: "failed", error: "Original texture hash mismatch" });
    await f.preview.setEnabled(true); expect(f.preview.snapshot()).toMatchObject({ status: "armed", error: null });
    expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.rig.isDisposed()).toBe(false);
  });

  it.each(["abort", "scene"] as const)("lifetime %s prevents late resurrection", async reason => {
    const f = fixture(); let resolve!: (playback: EmitterActorPlayback) => void;
    f.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const loading = f.preview.setEnabled(true), late = f.prepared();
    if (reason === "abort") f.lifetime.abort(); else f.scene.dispose();
    f.preview.dispose(); resolve(late); await loading; await f.preview.setEnabled(true);
    expect(f.preview.snapshot()).toMatchObject({ status: "disposed", enabled: false, playback: null });
    expect(late.dispose).toHaveBeenCalledOnce(); expect(f.prepare).toHaveBeenCalledOnce();
  });
});

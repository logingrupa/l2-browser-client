import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import { createNativeEffectInitPreview, type NativeInitEffectFrame } from "../../src/effects/nativeEffectInitPreview";
import { createNativeEffectInitTimeline } from "../../src/effects/nativeEffectInitTimeline";
import type { createNativeEffectParticlePool, NativeEffectParticleState } from "../../src/effects/nativeEffectParticlePool";
import { parseEffectManifest, type EffectBundle } from "../../src/effects/nativeEffectComponents";

const HASH = "82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd";
const manifest = parseEffectManifest(JSON.parse(readFileSync(`public/l2/effects/${HASH}/manifest.json`, "utf8")));
const CLIP = "SpAtk01_1HS";
const DURATION = 47 / 30;
type Pool = Awaited<ReturnType<typeof createNativeEffectParticlePool>>;
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
  function prepared() {
    const root = new TransformNode("owned-init-pool", scene); root.setEnabled(false);
    let particles: readonly NativeEffectParticleState[] = [];
    const apply = vi.fn((states: readonly NativeEffectParticleState[]) => { particles = structuredClone(states); });
    const handle = { root, capacity: 19, capacities: {}, hasSlot: vi.fn(), apply, bounds: vi.fn(() => null),
      inspect: vi.fn(() => ({ particles, rootEnabled: root.isEnabled() })), dispose: vi.fn(() => root.dispose()) };
    return handle as unknown as Pool & { apply: typeof apply; dispose: ReturnType<typeof vi.fn> };
  }
  const prepare = vi.fn<typeof createNativeEffectParticlePool>(async () => prepared());
  const preview = createNativeEffectInitPreview(scene, bundle, CLIP, () => state, lifetime.signal, prepare);
  releases.push(preview.dispose);
  function clock(seconds: number, changes: Partial<NativeActorClock> = {}) {
    state.clock = { clip: CLIP, mode: "once", elapsedSeconds: seconds, durationSeconds: DURATION,
      playing: true, completed: false, ...changes };
  }
  function start(seconds = 0) { state.sequence++; state.action = "special-attack"; state.animation = "attack"; clock(seconds); preview.update(); }
  return { engine, scene, lifetime, rig, hand, state, bundle, preview, prepare, prepared, clock, start,
    invalidate: () => { valid = false; }, replace: () => { state.anchor = { root: new TransformNode("replacement-hand", scene), isValid: () => true }; } };
}

describe("source-clock init preview lifecycle", () => {
  it("allocates nothing while off, then arms an attached disabled pool without starting an action", async () => {
    const f = fixture(); f.preview.update(); expect(f.prepare).not.toHaveBeenCalled();
    expect(f.preview.snapshot()).toMatchObject({ status: "off", runs: 0, pending: false });
    await f.preview.setEnabled(true); const pool = await f.prepare.mock.results[0]!.value;
    expect(pool.root.parent).toBe(f.hand); expect(pool.root.isEnabled()).toBe(false);
    expect(f.preview.snapshot()).toMatchObject({ status: "armed", enabled: true, runs: 0 });
    expect(f.state.action).toBeNull(); expect(f.bundle.readResource).not.toHaveBeenCalled();
  });

  it("follows exact source-clock samples, holds on pause and reuses the same pool on retrigger", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const pool = await f.prepare.mock.results[0]!.value;
    const expected = createNativeEffectInitTimeline(f.bundle);
    f.start(.2); f.clock(.7); f.preview.update();
    expect(pool.apply).toHaveBeenLastCalledWith(expected.evaluate(.7).particles);
    const paused = f.preview.snapshot().sampled; f.clock(.7, { playing: false }); f.preview.update();
    expect(f.preview.snapshot().sampled).toEqual(paused);
    f.clock(1.2); f.preview.update(); expect(pool.apply).toHaveBeenLastCalledWith(expected.evaluate(1.2).particles);
    f.start(.2); expect(pool.apply).toHaveBeenLastCalledWith(expected.evaluate(.2).particles);
    expect(f.preview.snapshot()).toMatchObject({ status: "playing", runs: 2, generation: 2, sourceSeconds: .2 });
    expect(f.prepare).toHaveBeenCalledOnce(); expect(pool.root.parent).toBe(f.hand);
  });

  it("does not join an action already playing when enabled", async () => {
    const f = fixture(); f.start(.2); await f.preview.setEnabled(true);
    f.clock(.6); f.preview.update(); expect(f.preview.snapshot()).toMatchObject({ status: "armed", runs: 0, sampled: null });
    f.start(.1); expect(f.preview.snapshot()).toMatchObject({ status: "playing", runs: 1, sourceSeconds: .1 });
  });

  it("does not join a generation started while resources were loading", async () => {
    const f = fixture(); let resolve!: (pool: Pool) => void;
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

  it("finishes at the timeline end without replaying, retaining warmed resources", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const pool = await f.prepare.mock.results[0]!.value;
    f.start(.3); f.clock(DURATION); f.preview.update(); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "completed", runs: 1, sampled: { complete: true, born: 19, expired: 19, particles: [] } });
    expect(pool.root.isEnabled()).toBe(false); expect(pool.root.isDisposed()).toBe(false);
    f.start(.3); expect(f.preview.snapshot().runs).toBe(2); expect(f.prepare).toHaveBeenCalledOnce();
  });

  it("recognizes driver idle after completion of the same generation", async () => {
    const f = fixture(); await f.preview.setEnabled(true); f.start(1.4);
    f.clock(0, { clip: "Wait", mode: "loop", durationSeconds: 1 }); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "completed", sourceSeconds: DURATION,
      generation: 1, sampled: { complete: true, born: 19, expired: 19 } });
  });

  it("hides on action interruption and waits for a subsequent special generation", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const pool = await f.prepare.mock.results[0]!.value; f.start(.3);
    f.state.sequence++; f.state.action = null; f.state.animation = "run"; f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "armed", interruption: "action-changed", runs: 1 });
    expect(pool.root.isEnabled()).toBe(false);
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
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", enabled: false, error: "The original action clock is invalid.", pool: null });
    expect(f.hand.isDisposed()).toBe(false);
  });

  it("rejects a clock shorter than the prepared particle tail instead of reporting full completion", async () => {
    const f = fixture(); await f.preview.setEnabled(true);
    f.state.sequence++; f.state.action = "special-attack"; f.state.animation = "attack"; f.clock(0, { durationSeconds: 1 }); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", error: "The original action is shorter than the prepared init timeline." });
  });

  it.each(["rewind", "duration"] as const)("rejects an unrequested %s within one generation", async change => {
    const f = fixture(); await f.preview.setEnabled(true); f.start(.5);
    f.clock(change === "rewind" ? .2 : .6, change === "duration" ? { durationSeconds: 2 } : {}); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", error: "The original action clock changed within a generation." });
  });

  it("disposes Off and an ignored-abort late result without touching the source rig", async () => {
    const f = fixture(); let resolve!: (pool: Pool) => void;
    f.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const loading = f.preview.setEnabled(true), late = f.prepared(), signal = f.prepare.mock.calls[0]![3];
    await f.preview.setEnabled(false); resolve(late); await loading;
    expect(signal.aborted).toBe(true); expect(late.dispose).toHaveBeenCalledOnce();
    expect(f.preview.snapshot()).toMatchObject({ status: "off", pool: null, pending: false });
    await f.preview.setEnabled(true); f.start(.3); const second = await f.prepare.mock.results[1]!.value;
    await f.preview.setEnabled(false); expect(second.root.isDisposed()).toBe(true);
    expect(f.rig.isDisposed()).toBe(false); expect(f.hand.isDisposed()).toBe(false);
  });

  it("fails on borrowed-anchor replacement or ownership loss and never disposes that anchor", async () => {
    const f = fixture(); await f.preview.setEnabled(true); const pool = await f.prepare.mock.results[0]!.value;
    f.start(); f.invalidate(); f.preview.update(); expect(f.preview.snapshot().status).toBe("failed");
    expect(pool.root.isDisposed()).toBe(true); expect(f.hand.isDisposed()).toBe(false);
    const g = fixture(); let resolve!: (pool: Pool) => void;
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
    const f = fixture(); let resolve!: (pool: Pool) => void;
    f.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const loading = f.preview.setEnabled(true), late = f.prepared();
    if (reason === "abort") f.lifetime.abort(); else f.scene.dispose();
    f.preview.dispose(); resolve(late); await loading; await f.preview.setEnabled(true);
    expect(f.preview.snapshot()).toMatchObject({ status: "disposed", enabled: false, pool: null });
    expect(late.dispose).toHaveBeenCalledOnce(); expect(f.prepare).toHaveBeenCalledOnce();
  });
});

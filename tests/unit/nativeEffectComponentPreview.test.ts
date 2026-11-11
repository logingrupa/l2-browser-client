import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { createNativeEffectComponentPreview } from "../../src/effects/nativeEffectComponentPreview";
import type { EffectBundle, EffectComponent } from "../../src/effects/nativeEffectComponents";
import type { EmitterActorPlayback, loadEmitterActorPlayback } from "../../src/effects/particles/render/emitterActorPlayback";

type FakePlayback = Omit<EmitterActorPlayback, "dispose" | "setPins" | "start" | "advance"> & { dispose: Mock<EmitterActorPlayback["dispose"]>; setPins: Mock<EmitterActorPlayback["setPins"]>;
  start: Mock<EmitterActorPlayback["start"]>; advance: Mock<EmitterActorPlayback["advance"]> };
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); vi.restoreAllMocks(); });
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine), lifetime = new AbortController();
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const rig = new TransformNode("original-rig", scene), anchorRoot = new TransformNode("qualified-hand", scene);
  anchorRoot.parent = rig; anchorRoot.position.set(2, 3, 4);
  let valid = true, alive = true, anchor = { root: anchorRoot, isValid: () => valid };
  const resource = { assetId: "texture:source", object: "Package.Texture", source: {}, file: `resources/${"a".repeat(64)}.png`, sha256: "a".repeat(64), bytes: 1 };
  const source: EffectComponent = { object: "Effect.Component", actor: "Effect", class: "Engine.SpriteEmitter", emitterOrdinal: 0,
    sourcePointer: "/effects/0/children/0", properties: {}, effectiveProperties: { UseColorScale: true, ColorScale: [{ RelativeTime: 0, Color: { R: 255, G: 0, B: 0, A: 255 } }, {}] },
    bindings: { mesh: null, texture: resource, primitiveMaterials: [] } };
  const bundle: EffectBundle = { manifestSha256: "b".repeat(64), manifest: { schemaVersion: 1, kind: "native-effect-components",
    components: [source], resources: { [resource.assetId]: resource }, actors: [{ object: "Effect", effectiveProperties: {}, dispatchStages: ["init"] }], textureGraph: [] },
    readResource: vi.fn() };
  const loaded = (): FakePlayback => {
    const root = new TransformNode("owned-playback", scene);
    root.setEnabled(false);
    let playing = false;
    return {
      root, components: [], get playing() { return playing; },
      start: vi.fn<EmitterActorPlayback["start"]>(() => { playing = true; }), stop: vi.fn(() => { playing = false; }), advance: vi.fn<EmitterActorPlayback["advance"]>(), setPins: vi.fn<EmitterActorPlayback["setPins"]>(),
      liveParticles: () => playing ? 3 : 0, bounds: () => null,
      applyNative: () => { throw new Error("the component preview applies no emitter native"); },
      inspect: () => ({ actorObject: "Effect" }) as unknown as ReturnType<EmitterActorPlayback["inspect"]>,
      dispose: vi.fn<EmitterActorPlayback["dispose"]>(() => root.dispose()),
    };
  };
  const load = vi.fn<typeof loadEmitterActorPlayback>(async () => loaded());
  const preview = createNativeEffectComponentPreview(scene, bundle, () => anchor, () => alive, lifetime.signal, load);
  releases.push(preview.dispose);
  const handle = async () => await load.mock.results[0]!.value as FakePlayback;
  return { scene, rig, anchorRoot, preview, lifetime, load, loaded, handle,
    kill: () => { alive = false; }, revive: () => { alive = true; }, invalidate: () => { valid = false; },
    replaceAnchor: () => { anchor = { root: new TransformNode("different-hand", scene), isValid: () => true }; } };
}

describe("simulated source-component presentation", () => {
  it("starts off, then plays only the selected emitter of its actor through the simulator on the hand", async () => {
    const f = fixture(); expect(f.preview.snapshot()).toMatchObject({ status: "off", selection: { component: null }, pending: false });
    expect(f.load).not.toHaveBeenCalled();
    await f.preview.select("Effect.Component");
    expect(f.load.mock.calls[0]![2]).toMatchObject({ actorObject: "Effect", emitterObjects: ["Effect.Component"] });
    const handle = await f.handle();
    expect(handle.root.parent).toBe(f.anchorRoot); expect(handle.start).toHaveBeenCalledOnce();
    expect(handle.setPins).toHaveBeenCalledWith({ pinnedFrame: null, colourOverride: null });
    expect(f.preview.snapshot()).toMatchObject({ status: "ready", sourceComponent: "Effect.Component", stages: ["init"],
      selection: { frame: null, colorKey: null }, nativeSkillVerified: false, draws: 0 });
  });

  it("advances the simulator each frame, replays a finished burst and hides on death", async () => {
    const f = fixture(); await f.preview.select("Effect.Component"); const handle = await f.handle();
    f.preview.update(); expect(handle.advance).toHaveBeenCalledOnce(); expect(handle.root.isEnabled()).toBe(true);
    handle.stop(); f.preview.update(); expect(handle.start).toHaveBeenCalledTimes(2); expect(f.preview.snapshot().replays).toBe(1);
    f.kill(); f.preview.update(); expect(handle.root.isEnabled()).toBe(false); expect(f.preview.snapshot().status).toBe("hidden");
    f.revive(); f.preview.update(); expect(handle.root.isEnabled()).toBe(true); expect(f.preview.snapshot().status).toBe("ready");
    expect(f.load).toHaveBeenCalledTimes(1);
  });

  it("cleans up an invalidated anchor without disposing the original rig", async () => {
    const f = fixture(); await f.preview.select("Effect.Component"); const handle = await f.handle();
    f.invalidate(); f.preview.update(); expect(handle.root.isDisposed()).toBe(true);
    expect(f.anchorRoot.isDisposed()).toBe(false); expect(f.rig.isDisposed()).toBe(false);
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", playback: null });
  });

  it("discards an out-of-order load after Off, even when the loader ignores abort", async () => {
    const f = fixture(); let resolve!: (value: EmitterActorPlayback) => void;
    f.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = f.preview.select("Effect.Component"); expect(f.preview.snapshot().pending).toBe(true);
    const signal = f.load.mock.calls[0]![3]; await f.preview.select(null); expect(signal.aborted).toBe(true);
    const late = f.loaded(); resolve(late); await request;
    expect(late.dispose).toHaveBeenCalledOnce(); expect(f.preview.snapshot()).toMatchObject({ status: "off", playback: null, pending: false });
    expect(f.anchorRoot.getChildren()).toHaveLength(0);
  });

  it("does not attach completed data to a replacement character", async () => {
    const f = fixture(); let resolve!: (value: EmitterActorPlayback) => void;
    f.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = f.preview.select("Effect.Component"); f.replaceAnchor();
    const late = f.loaded(); resolve(late); await request;
    expect(late.dispose).toHaveBeenCalledOnce(); expect(f.preview.snapshot().status).toBe("failed");
  });

  it("lifetime abort and scene disposal reject late resurrection and are idempotent", async () => {
    const f = fixture(); let resolve!: (value: EmitterActorPlayback) => void;
    f.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = f.preview.select("Effect.Component"), late = f.loaded();
    f.lifetime.abort(); f.preview.dispose(); resolve(late); await request;
    expect(f.preview.snapshot().status).toBe("disposed"); expect(late.dispose).toHaveBeenCalledOnce();
    await f.preview.select("Effect.Component"); expect(f.load).toHaveBeenCalledOnce();
    expect(f.rig.isDisposed()).toBe(false);
  });

  it("retains load failure instead of adding a fallback effect or throwing through the render loop", async () => {
    const f = fixture(); f.load.mockRejectedValueOnce(new Error("Resource hash mismatch"));
    await f.preview.select("Effect.Component"); f.preview.update();
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", error: "Resource hash mismatch", playback: null, pending: false });
    expect(f.anchorRoot.getChildren()).toHaveLength(0);
  });

  it("pins a ColorScale key and a texture frame without reloading the emitter", async () => {
    const f = fixture(); await f.preview.select("Effect.Component", 0); const handle = await f.handle();
    expect(handle.setPins).toHaveBeenLastCalledWith(expect.objectContaining({ pinnedFrame: expect.objectContaining({ label: "Texture" }) }));
    f.preview.setColorKey(0); expect(handle.setPins).toHaveBeenLastCalledWith(expect.objectContaining({ colourOverride: [1, 0, 0, 1] }));
    expect(() => f.preview.setColorKey(1)).toThrow("ColorScale key 1");
    expect(f.preview.snapshot().selection.colorKey).toBe(0); expect(f.load).toHaveBeenCalledOnce();
    await f.preview.select(null); expect(handle.root.isDisposed()).toBe(true); expect(f.anchorRoot.isDisposed()).toBe(false);
  });
});

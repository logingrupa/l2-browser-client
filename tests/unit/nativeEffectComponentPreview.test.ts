import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { createNativeEffectComponentPreview } from "../../src/effects/nativeEffectComponentPreview";
import type { loadEffectComponent } from "../../src/effects/loadEffectComponent";
import type { EffectBundle, EffectComponent } from "../../src/effects/nativeEffectComponents";

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
    sourcePointer: "/effects/0/children/0", properties: {}, effectiveProperties: { UseColorScale: true, ColorScale: [{}, {}] },
    bindings: { mesh: null, texture: resource, primitiveMaterials: [] } };
  const bundle: EffectBundle = { manifestSha256: "b".repeat(64), manifest: { schemaVersion: 1, kind: "native-effect-components",
    components: [source], resources: { [resource.assetId]: resource }, actors: [{ object: "Effect", effectiveProperties: {}, dispatchStages: ["init"] }], textureGraph: [] },
    readResource: vi.fn() };
  type Loaded = Awaited<ReturnType<typeof loadEffectComponent>>;
  const loaded = () => {
    const root = new TransformNode("owned-component", scene), mesh = MeshBuilder.CreatePlane("owned-component-mesh", {}, scene);
    root.setEnabled(false); mesh.parent = root;
    const handle = { root, meshes: [mesh], setColorKey: vi.fn(), inspection: () => ({ rootLocalMatrix: Array.from(root.computeWorldMatrix(true).asArray()) }),
      dispose: vi.fn(() => root.dispose()) };
    return handle as unknown as Loaded & { dispose: ReturnType<typeof vi.fn>; setColorKey: ReturnType<typeof vi.fn> };
  };
  const load = vi.fn<typeof loadEffectComponent>(async () => loaded());
  const preview = createNativeEffectComponentPreview(scene, bundle, () => anchor, () => alive, lifetime.signal, load);
  releases.push(preview.dispose);
  return { scene, rig, anchorRoot, preview, lifetime, load, loaded,
    kill: () => { alive = false; }, revive: () => { alive = true; }, invalidate: () => { valid = false; },
    replaceAnchor: () => { anchor = { root: new TransformNode("different-hand", scene), isValid: () => true }; } };
}

describe("owned source-component presentation", () => {
  it("starts off without allocating effect geometry, then attaches with identity local transform", async () => {
    const f = fixture(); expect(f.preview.snapshot()).toMatchObject({ status: "off", selection: { component: null }, pending: false });
    expect(f.load).not.toHaveBeenCalled(); const matrix = Array.from(f.anchorRoot.computeWorldMatrix(true).asArray());
    await f.preview.select("Effect.Component");
    const handle = await f.load.mock.results[0]!.value;
    expect(handle.root.parent).toBe(f.anchorRoot); expect(handle.root.position.asArray()).toEqual([0, 0, 0]);
    expect(handle.root.scaling.asArray()).toEqual([1, 1, 1]); expect(handle.root.isEnabled()).toBe(true);
    expect(Array.from(f.anchorRoot.computeWorldMatrix(true).asArray())).toEqual(matrix);
    expect(f.preview.snapshot()).toMatchObject({ status: "ready", sourceComponent: "Effect.Component", stages: ["init"],
      selection: { colorKey: 0 }, nativeSkillVerified: false, draws: 0 });
  });

  it("hides on death and restores the same component on revival without restarting anything", async () => {
    const f = fixture(); await f.preview.select("Effect.Component"); const handle = await f.load.mock.results[0]!.value;
    f.kill(); f.preview.update(); expect(handle.root.isEnabled()).toBe(false); expect(f.preview.snapshot().status).toBe("hidden");
    f.revive(); f.preview.update(); expect(handle.root.isEnabled()).toBe(true); expect(f.preview.snapshot().status).toBe("ready");
    expect(f.load).toHaveBeenCalledTimes(1);
  });

  it("cleans up an invalidated anchor without disposing the original rig", async () => {
    const f = fixture(); await f.preview.select("Effect.Component"); const handle = await f.load.mock.results[0]!.value;
    f.invalidate(); f.preview.update(); expect(handle.root.isDisposed()).toBe(true);
    expect(f.anchorRoot.isDisposed()).toBe(false); expect(f.rig.isDisposed()).toBe(false);
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", loaded: null });
  });

  it("discards an out-of-order load after Off, even when the loader ignores abort", async () => {
    const f = fixture(); let resolve!: (value: Awaited<ReturnType<typeof loadEffectComponent>>) => void;
    f.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = f.preview.select("Effect.Component"); expect(f.preview.snapshot().pending).toBe(true);
    const signal = f.load.mock.calls[0]![4]; await f.preview.select(null); expect(signal.aborted).toBe(true);
    const late = f.loaded(); resolve(late); await request;
    expect(late.dispose).toHaveBeenCalledOnce(); expect(f.preview.snapshot()).toMatchObject({ status: "off", loaded: null, pending: false });
    expect(f.anchorRoot.getChildren()).toHaveLength(0);
  });

  it("does not attach completed data to a replacement character", async () => {
    const f = fixture(); let resolve!: (value: Awaited<ReturnType<typeof loadEffectComponent>>) => void;
    f.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = f.preview.select("Effect.Component"); f.replaceAnchor();
    const late = f.loaded(); resolve(late); await request;
    expect(late.dispose).toHaveBeenCalledOnce(); expect(f.preview.snapshot().status).toBe("failed");
  });

  it("lifetime abort and scene disposal reject late resurrection and are idempotent", async () => {
    const f = fixture(); let resolve!: (value: Awaited<ReturnType<typeof loadEffectComponent>>) => void;
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
    expect(f.preview.snapshot()).toMatchObject({ status: "failed", error: "Resource hash mismatch", loaded: null, pending: false });
    expect(f.anchorRoot.getChildren()).toHaveLength(0);
  });

  it("updates a manual color key without reloading geometry or changing the anchor", async () => {
    const f = fixture(); await f.preview.select("Effect.Component"); const handle = await f.load.mock.results[0]!.value;
    f.preview.setColorKey(1); expect(handle.setColorKey).toHaveBeenCalledWith(1);
    expect(f.preview.snapshot().selection.colorKey).toBe(1); expect(f.load).toHaveBeenCalledOnce();
    await f.preview.select(null); expect(handle.root.isDisposed()).toBe(true); expect(f.anchorRoot.isDisposed()).toBe(false);
  });
});

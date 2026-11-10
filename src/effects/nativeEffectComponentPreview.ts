import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { effectFrames, effectObject, type EffectBundle, type EffectComponent, type EffectFrame } from "./nativeEffectComponents";
import { drawEffectSessionSeed, loadEmitterActorPlayback, type EmitterActorPlayback } from "./particles/render/emitterActorPlayback";

export interface EffectAnchorView { readonly root: TransformNode; isValid(): boolean }
export interface EffectSelection { component: string | null; frame: number | null; colorKey: number | null }

function colourKeyOverride(component: EffectComponent, index: number | null): readonly [number, number, number, number] | null {
  if (index === null) return null;
  const keys = component.effectiveProperties.ColorScale, key: unknown = Array.isArray(keys) ? keys[index] : undefined;
  if (component.effectiveProperties.UseColorScale !== true || !effectObject(key) || !effectObject(key.Color)) throw new Error(`The component has no ColorScale key ${index}.`);
  const channels = [key.Color.R, key.Color.G, key.Color.B, key.Color.A];
  if (!channels.every(channel => Number.isInteger(channel) && Number(channel) >= 0 && Number(channel) <= 255)) throw new Error(`ColorScale key ${index} is not RGBA bytes.`);
  return channels.map(channel => Number(channel) / 255) as unknown as readonly [number, number, number, number];
}

export function createNativeEffectComponentPreview(scene: Scene, bundle: EffectBundle,
  anchor: () => EffectAnchorView | null, alive: () => boolean, signal: AbortSignal,
  prepare: typeof loadEmitterActorPlayback = loadEmitterActorPlayback) {
  let disposed = false, generation = 0, loading: AbortController | null = null;
  let current: EmitterActorPlayback | null = null, attached: EffectAnchorView | null = null;
  let state: "off" | "loading" | "ready" | "hidden" | "failed" | "disposed" = "off";
  let error: string | null = null, selection: EffectSelection = { component: null, frame: null, colorKey: null };
  let draws = 0, lastDrawFrame: number | null = null, replays = 0;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const clear = () => { current?.dispose(); current = null; attached = null; draws = 0; lastDrawFrame = null; replays = 0; };
  const component = () => bundle.manifest.components.find(row => row.object === selection.component) ?? null;
  const framesFor = (row: EffectComponent): EffectFrame[] => {
    const texture = row.class === "Engine.SpriteEmitter" ? row.bindings.texture :
      bundle.manifest.resources[row.bindings.primitiveMaterials[0]?.textureResourceKey ?? ""];
    if (!texture) throw new Error("The effect component has no qualified original texture.");
    return effectFrames(bundle.manifest, row, texture);
  };
  const applyPins = () => {
    const selected = component();
    if (!current || !selected) return;
    current.setPins({ pinnedFrame: selection.frame === null ? null : framesFor(selected)[selection.frame] ?? null, colourOverride: colourKeyOverride(selected, selection.colorKey) });
  };
  const dispose = () => {
    if (disposed) return; disposed = true; generation++; loading?.abort(); loading = null; clear(); state = "disposed";
    signal.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(sceneObserver);
    publish(); listeners.clear();
  };
  const sceneObserver = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted || scene.isDisposed) dispose();

  return {
    components: bundle.manifest.components,
    framesFor,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    async select(object: string | null, frame?: number): Promise<void> {
      if (disposed) return;
      const request = ++generation; loading?.abort(); loading = null; clear(); error = null;
      selection = { component: object, frame: frame ?? null, colorKey: null };
      if (object === null) { state = "off"; publish(); return; }
      state = "loading"; publish();
      const controller = new AbortController(); loading = controller;
      let candidate: EmitterActorPlayback | null = null;
      try {
        const selected = component();
        if (!selected) throw new Error("Unknown source effect component.");
        if (selection.frame !== null && framesFor(selected)[selection.frame] === undefined) throw new Error(`The component has no texture frame ${selection.frame}.`);
        const origin = anchor();
        if (!origin?.isValid() || !alive()) throw new Error("The fighter's source hand attachment is unavailable.");
        candidate = await prepare(scene, bundle, { actorObject: selected.actor, emitterObjects: [selected.object], sessionSeed: drawEffectSessionSeed() }, controller.signal);
        if (disposed || request !== generation || controller.signal.aborted) { candidate.dispose(); return; }
        const latest = anchor();
        if (!latest?.isValid() || latest.root !== origin.root || !alive()) throw new Error("The source attachment changed while loading the component.");
        current = candidate; candidate = null; attached = latest;
        current.root.parent = latest.root;
        applyPins();
        current.start(); state = "ready";
        for (const mesh of current.components.flatMap(loaded => loaded.meshes)) mesh.onBeforeRenderObservable.add(() => {
          if (!disposed && state === "ready") { draws++; lastDrawFrame = scene.getEngine().frameId; }
        });
      } catch (failure) {
        candidate?.dispose();
        if (disposed || request !== generation || controller.signal.aborted) return;
        clear(); state = "failed"; error = failure instanceof Error ? failure.message : "Effect component loading failed.";
      } finally {
        if (!disposed && request === generation) { loading = null; publish(); }
      }
    },
    setColorKey(index: number | null) {
      const selected = component();
      if (!current || disposed || !selected) return;
      colourKeyOverride(selected, index);
      selection.colorKey = index; applyPins(); publish();
    },
    update() {
      if (!current || disposed) return;
      const latest = anchor();
      if (!attached?.isValid() || !latest?.isValid() || latest.root !== attached.root || current.root.isDisposed()) {
        clear(); state = "failed"; error = "The effect's source attachment is no longer owned by this character."; publish(); return;
      }
      const visible = alive(), next = visible ? "ready" : "hidden";
      if (!current.playing) { current.start(); replays++; }
      current.advance(scene.getEngine().getDeltaTime() / 1000);
      current.root.setEnabled(visible && current.liveParticles() > 0);
      if (state !== next) { state = next; publish(); }
    },
    bounds() { return current && state === "ready" ? current.bounds() : null; },
    snapshot() {
      const selected = component();
      if (attached?.isValid()) attached.root.computeWorldMatrix(true);
      return { policy: "simulated-source-component" as const, status: state, error, selection: { ...selection },
        manifestSha256: bundle.manifestSha256, manifestId: bundle.manifest.id ?? null,
        components: bundle.manifest.components.map(row => ({ object: row.object, class: row.class, actor: row.actor })), sourceActor: selected?.actor ?? null,
        sourceComponent: selected?.object ?? null, sourcePointer: selected?.sourcePointer ?? null,
        stages: bundle.manifest.actors.find(row => row.object === selected?.actor)?.dispatchStages ?? [],
        anchorId: attached?.root.id ?? null, anchorUniqueId: attached?.root.uniqueId ?? null,
        anchorWorldMatrix: attached?.isValid() ? Array.from(attached.root.getWorldMatrix().asArray()) : null,
        playback: current?.inspect() ?? null, draws, lastDrawFrame, replays, pending: loading !== null,
        nativeSkillVerified: false, nativeCompositionVerified: false };
    },
    dispose,
  };
}

export type NativeEffectComponentPreview = ReturnType<typeof createNativeEffectComponentPreview>;

import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { effectFrames, type EffectBundle, type EffectComponent } from "./nativeEffectComponents";
import { loadEffectComponent } from "./loadEffectComponent";

export interface EffectAnchorView { readonly root: TransformNode; isValid(): boolean }
export interface EffectSelection { component: string | null; frame: number; colorKey: number | null }
type Loaded = Awaited<ReturnType<typeof loadEffectComponent>>;

export function createNativeEffectComponentPreview(scene: Scene, bundle: EffectBundle,
  anchor: () => EffectAnchorView | null, alive: () => boolean, signal: AbortSignal,
  load: typeof loadEffectComponent = loadEffectComponent) {
  let disposed = false, generation = 0, loading: AbortController | null = null;
  let current: Loaded | null = null, attached: EffectAnchorView | null = null;
  let state: "off" | "loading" | "ready" | "hidden" | "failed" | "disposed" = "off";
  let error: string | null = null, selection: EffectSelection = { component: null, frame: 0, colorKey: null };
  let draws = 0, lastDrawFrame: number | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const clear = () => { current?.dispose(); current = null; attached = null; draws = 0; lastDrawFrame = null; };
  const component = () => bundle.manifest.components.find(row => row.object === selection.component) ?? null;
  const framesFor = (row: EffectComponent) => {
    const texture = row.class === "Engine.SpriteEmitter" ? row.bindings.texture :
      bundle.manifest.resources[row.bindings.primitiveMaterials[0]?.textureResourceKey ?? ""];
    if (!texture) throw new Error("The effect component has no qualified original texture.");
    return effectFrames(bundle.manifest, row, texture);
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
    async select(object: string | null, frame = 0): Promise<void> {
      if (disposed) return;
      const request = ++generation; loading?.abort(); loading = null; clear(); error = null;
      selection = { component: object, frame, colorKey: null };
      if (object === null) { state = "off"; publish(); return; }
      state = "loading"; publish();
      const controller = new AbortController(); loading = controller;
      let candidate: Loaded | null = null;
      try {
        const selected = component();
        if (!selected) throw new Error("Unknown source effect component.");
        const origin = anchor();
        if (!origin?.isValid() || !alive()) throw new Error("The fighter's source hand attachment is unavailable.");
        selection.colorKey = selected.effectiveProperties.UseColorScale === true ? 0 : null;
        candidate = await load(scene, bundle, selected, { frameIndex: frame, colorKey: selection.colorKey }, controller.signal);
        if (disposed || request !== generation || controller.signal.aborted) { candidate.dispose(); return; }
        const latest = anchor();
        if (!latest?.isValid() || latest.root !== origin.root || !alive()) throw new Error("The source attachment changed while loading the component.");
        current = candidate; candidate = null; attached = latest;
        current.root.parent = latest.root;
        current.root.setEnabled(true); state = "ready";
        for (const mesh of current.meshes) mesh.onBeforeRenderObservable.add(() => {
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
      if (!current || disposed) return;
      current.setColorKey(index); selection.colorKey = index; publish();
    },
    update() {
      if (!current || disposed) return;
      const latest = anchor();
      if (!attached?.isValid() || !latest?.isValid() || latest.root !== attached.root || current.root.isDisposed()) {
        clear(); state = "failed"; error = "The effect's source attachment is no longer owned by this character."; publish(); return;
      }
      const visible = alive();
      const next = visible ? "ready" : "hidden";
      current.root.setEnabled(visible);
      if (state !== next) { state = next; publish(); }
    },
    bounds() {
      if (!current || state !== "ready") return null;
      let minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of current.meshes) {
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo().boundingBox;
        minimum = Vector3.Minimize(minimum, bounds.minimumWorld); maximum = Vector3.Maximize(maximum, bounds.maximumWorld);
      }
      return { minimum, maximum };
    },
    snapshot() {
      const selected = component();
      if (attached?.isValid()) attached.root.computeWorldMatrix(true);
      return { policy: "manual-source-component" as const, status: state, error, selection: { ...selection },
        manifestSha256: bundle.manifestSha256, manifestId: bundle.manifest.id ?? null,
        components: bundle.manifest.components.map(row => ({ object: row.object, class: row.class, actor: row.actor })), sourceActor: selected?.actor ?? null,
        sourceComponent: selected?.object ?? null, sourcePointer: selected?.sourcePointer ?? null,
        stages: bundle.manifest.actors.find(row => row.object === selected?.actor)?.dispatchStages ?? [],
        anchorId: attached?.root.id ?? null, anchorUniqueId: attached?.root.uniqueId ?? null,
        anchorWorldMatrix: attached?.isValid() ? Array.from(attached.root.getWorldMatrix().asArray()) : null,
        loaded: current?.inspection() ?? null, draws, lastDrawFrame, pending: loading !== null,
        nativeSkillVerified: false, nativeCompositionVerified: false,
        limits: ["One original component at a time on the source hand reference; shot objects are inspected here without native shot placement.",
          "No emission, randomness, dispatch, adjusted lifetime, actor DrawScale or automatic texture timeline is inferred.",
          "Original animation and direct sound cues remain controlled by the existing character preview."] };
    },
    dispose,
  };
}

export type NativeEffectComponentPreview = ReturnType<typeof createNativeEffectComponentPreview>;

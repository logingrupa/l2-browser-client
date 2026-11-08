import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator, type CharacterAnimationDriver, type CharacterPlayback } from "../../animation/CharacterAnimator";
import type { AnimationState, WorldEntity } from "../../world/worldTypes";
import { createCharacterVisual, type CharacterVisual, type CharacterVisualFactory } from "../CharacterVisual";
import type { CharacterBounds } from "../characterBounds";
import type { AssetPackage } from "../package/readAssetPackage";
import { nativeAppearanceProfileId, nativeAppearanceProfiles } from "../characterProfiles";
import { loadNativePlayerPackages } from "./loadNativeCatalog";
import type { NativePlayerProfile } from "./loadNativePlayerProfiles";
import { nativeCharacterFactory, type NativeCharacterProfile } from "./NativeCharacterVisual";

export function nativePlayerCharacterProfile(profile: NativePlayerProfile, models: ReadonlyMap<string, AssetPackage>): NativeCharacterProfile {
  const asset = models.get(profile.catalogId);
  if (!asset) throw new Error(`Native player package ${profile.catalogId} is not loaded.`);
  return { asset, clips: profile.clips,
    upperItems: new Map(profile.upperItems.map(item => {
      const part = models.get(item.catalogId);
      if (!part) throw new Error(`Native equipment package ${item.catalogId} is not loaded.`);
      return [item.itemId, part] as const;
    })),
    forwardAxis: Vector3.FromArray(profile.forwardAxis), actorScale: Vector3.FromArray(profile.actorScale) };
}

export interface NativeAppearanceSet {
  readonly profiles: ReadonlyMap<string, NativeCharacterProfile>;
  readonly failures: ReadonlyMap<string, string>;
}

export async function loadNativeAppearanceSet(signal: AbortSignal): Promise<NativeAppearanceSet> {
  const loaded = await loadNativePlayerPackages(signal, Object.values(nativeAppearanceProfiles));
  const profiles = new Map<string, NativeCharacterProfile>(), failures = new Map<string, string>();
  for (const [appearance, id] of Object.entries(nativeAppearanceProfiles)) {
    const profile = loaded.profiles.get(id);
    if (profile) profiles.set(appearance, nativePlayerCharacterProfile(profile, loaded.models));
    else failures.set(appearance, loaded.failures.get(id) ?? `Native player profile ${id} is not staged.`);
  }
  return { profiles, failures };
}

const idlePlayback: CharacterPlayback = { activeClip: "", frame: 0, looping: true, playing: false, weights: [] };

class CurrentPresentationForwardingDriver implements CharacterAnimationDriver {
  requested: AnimationState;
  target: CharacterVisual | undefined;
  constructor(initial: AnimationState) { this.requested = initial; }
  get playback(): CharacterPlayback { return this.target?.animation.playback ?? idlePlayback; }
  setState(state: AnimationState, retrigger = false): void { this.requested = state; this.target?.animation.setState(state, retrigger); }
  update(seconds: number): void { this.target?.animation.update(seconds); }
  dispose(): void { this.target = undefined; }
}

export function nativeOrProceduralCharacterFactory(appearances: Promise<NativeAppearanceSet>,
  procedural: CharacterVisualFactory = createCharacterVisual): CharacterVisualFactory {
  void appearances.catch(() => undefined);
  return (scene: Scene, initial: WorldEntity, status?: (message: string) => void): CharacterVisual => {
    if (!nativeAppearanceProfileId(initial)) return procedural(scene, initial, status);
    const root = new TransformNode(`entity:${initial.id}`, scene);
    const driver = new CurrentPresentationForwardingDriver(initial.animation), animation = new CharacterAnimator(driver);
    animation.setState(initial.animation);
    let current = initial, inner: CharacterVisual | undefined, pending: CharacterVisual | undefined, disposed = false, settled = false;
    let resolveReady!: () => void, rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => undefined);
    const loadingBounds: CharacterBounds = { minimum: new Vector3(-.2, 0, -.2), maximum: new Vector3(.2, .45, .2),
      labelHeight: .6, selectionRadius: .25, pickingHeight: .25 };
    const adopt = (visual: CharacterVisual) => {
      visual.root.parent = root;
      visual.setEntity?.(current);
      inner = visual; pending = undefined; driver.target = visual;
      visual.animation.setState(driver.requested);
      if (!settled) { settled = true; resolveReady(); }
    };
    const fallBack = (reason: string) => {
      if (disposed) return;
      pending?.dispose(); pending = undefined;
      adopt(procedural(scene, current, status));
      status?.(`${current.displayName}: ${reason} Animated placeholder retained.`);
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (!settled) { settled = true; rejectReady(new DOMException("Character loading was cancelled.", "AbortError")); }
      animation.dispose(); pending?.dispose(); inner?.dispose(); root.dispose();
      pending = undefined; inner = undefined;
      scene.onDisposeObservable.remove(observer);
    };
    const observer = scene.onDisposeObservable.add(dispose);
    appearances.then(set => {
      if (disposed) return;
      const appearance = current.appearanceId ?? "", profile = set.profiles.get(appearance);
      if (!profile) { fallBack(set.failures.get(appearance) ?? "No staged native package for this appearance."); return; }
      const native = nativeCharacterFactory(new Map([[appearance, profile]]))(scene, current, status);
      native.root.parent = root; pending = native;
      void (native.ready ?? Promise.resolve()).then(() => { if (!disposed && pending === native) adopt(native); },
        (error: unknown) => {
          if (disposed || pending !== native) return;
          fallBack(error instanceof Error ? error.message : "The native model could not be loaded.");
        });
    }, (error: unknown) => fallBack(error instanceof Error ? error.message : "The native package catalog could not be loaded."));
    return {
      root, animation, ready,
      get isFallback() { return inner === undefined || inner.isFallback; },
      get bounds() { return inner?.bounds ?? loadingBounds; },
      get modelId() { return inner?.modelId ?? null; },
      get groundClearance() { return inner?.groundClearance ?? 0; },
      get forwardDirection() { return inner?.forwardDirection ?? null; },
      attachmentSnapshot: () => inner?.attachmentSnapshot?.() ?? [],
      attachmentAnchor: id => inner?.attachmentAnchor?.(id) ?? null,
      sourceClock: () => inner?.sourceClock?.() ?? null,
      setEntity(entity) { current = entity; pending?.setEntity?.(entity); inner?.setEntity?.(entity); },
      dispose,
    };
  };
}

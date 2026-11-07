import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldEntity, AnimationState, LocomotionMode, SourceActionPreview } from "../../world/worldTypes";
import { CharacterAnimator, type CharacterAnimationDriver, type CharacterPlayback } from "../../animation/CharacterAnimator";
import type { CharacterVisual } from "../CharacterVisual";
import type { CharacterBounds } from "../prepareCharacterModel";
import type { AssetPackage } from "../package/readAssetPackage";
import { NativeActor, type NativeBoneAnchor } from "./NativeActor";
import type { NativeActionCuePlayer, NativeActionCuePreview } from "../../audio/nativeActionCuePreview";

export interface NativeCharacterProfile {
  readonly asset: AssetPackage;
  readonly clips: Readonly<Record<AnimationState | "death", string> & { walk?: string; specialAttack?: string }>;
  readonly upperItems?: ReadonlyMap<number, AssetPackage>;
  /** Native actor collision half-height in metres, when established for this
   * reference/profile. Independent of the mesh's idle bounds and animation. */
  readonly collisionHalfHeight?: number;
  /** Presentation-owned actor scale outside the complete native mesh transform.
   * Does not change collision half-height or rewrite any imported node/key. */
  readonly actorScale?: Vector3;
  /** Facing axis after the complete imported mesh transform, before semantic
   * entity heading. Profiles supply this only when established from the asset. */
  readonly forwardAxis?: Vector3;
  /** Qualified exact base-part joints. Identity children preserve imported
   * transforms; this is not a native effect/equipment attachment equation. */
  readonly boneAnchors?: readonly { id: string; sourceObject: string; boneName: string }[];
}

class NativeActorDriver implements CharacterAnimationDriver {
  private requested: AnimationState = "idle";
  private locomotion: LocomotionMode = "run";
  private actionPreview: SourceActionPreview | undefined;
  private dead = false;
  private showing: AnimationState | "walk" | "death" | "specialAttack" = "idle";
  constructor(private readonly actor: NativeActor, private readonly clips: NativeCharacterProfile["clips"],
    private readonly cuePlayers: readonly NativeActionCuePlayer[] = []) { this.show("idle"); }
  private show(state: AnimationState | "death") {
    const displayed = state === "run" && this.locomotion === "walk" ? "walk" :
      state === "attack" && this.actionPreview === "special-attack" ? "specialAttack" : state;
    const clip = this.clips[displayed];
    if (!clip) throw new Error(displayed === "walk" ? "Native walking requires an explicit verified source clip." :
      "Native special attack preview requires an explicit verified source clip.");
    this.showing = displayed; this.actor.play(clip, state === "attack" || state === "death" ? "once" : "loop");
    for (const cues of this.cuePlayers) cues.start(this.actor.clock());
  }
  setActionPreview(action: SourceActionPreview | undefined): void {
    if (action !== undefined && (action !== "special-attack" || !this.clips.specialAttack)) {
      throw new Error("Native special attack preview requires an explicit verified source clip.");
    }
    // Selection alone never restarts a clip. Explicit animationSequence changes
    // still own retriggering through GameWorldAdapter and CharacterAnimator.
    this.actionPreview = action;
  }
  setLocomotion(mode: LocomotionMode): void {
    if (mode === this.locomotion) return;
    if (mode === "walk" && !this.clips.walk) throw new Error("Native walking requires an explicit verified source clip.");
    this.locomotion = mode;
    if (!this.dead && this.requested === "run") this.show("run");
  }
  setState(state: AnimationState, retrigger = false): void {
    if (state === this.requested && !retrigger) return;
    this.requested = state; if (!this.dead) this.show(state);
  }
  setDead(dead: boolean): void {
    if (this.dead === dead) return;
    this.dead = dead;
    // Revival resumes locomotion, but does not issue a new one-shot attack.
    // A completed/interrupted action needs another explicit animation sequence.
    if (!dead && this.requested === "attack") this.requested = "idle";
    this.show(dead ? "death" : this.requested);
  }
  update(seconds: number): void {
    const previous = this.actor.clock();
    this.actor.update(seconds);
    const current = this.actor.clock();
    for (const cues of this.cuePlayers) cues.advance(previous, current);
    if ((this.showing === "attack" || this.showing === "specialAttack") && current.completed) this.show("idle");
  }
  get playback(): CharacterPlayback {
    const state = this.actor.snapshot();
    return { activeClip: state.clip ?? "", frame: state.timeSeconds * 60, looping: state.mode === "loop", playing: state.playing,
      weights: state.clip ? [{ name: state.clip, weight: 1 }] : [] };
  }
  dispose(): void { for (const cues of this.cuePlayers) cues.dispose(); this.actor.pause(); }
}

export function nativeCharacterFactory(profiles: ReadonlyMap<string, NativeCharacterProfile>, actionCuePreview?: NativeActionCuePreview,
  footstepPreview?: Pick<NativeActionCuePreview, "bindActor">) {
  return (scene: Scene, initial: WorldEntity, status?: (message: string) => void): CharacterVisual => {
    const root = new TransformNode(`entity:${initial.id}`, scene);
    root.setEnabled(false);
    // Native startup has no procedural stand-in. Keep the semantic animation
    // request while the complete assembly is unavailable, without making meshes.
    const animation = new CharacterAnimator({ setState() {}, update() {}, dispose() {} });
    animation.setState(initial.animation);
    const lifetime = new AbortController();
    let current = initial, actor: NativeActor | undefined, driver: NativeActorDriver | undefined, disposed = false;
    let pendingDriver: NativeActorDriver | undefined;
    const anchors: { id: string; handle: NativeBoneAnchor }[] = [];
    let placement: TransformNode | undefined, initialized = false, readySettled = false;
    let resolveReady!: () => void, rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Editor previews may not await startup; failures still belong to ready and
    // must remain observable to the browser owner without an unhandled promise.
    void ready.catch(() => undefined);
    let upper: number | undefined, committedUpper: number | undefined, replacedObject: string | undefined, equipmentRequest = 0;
    let equipmentTask = Promise.resolve();
    let bounds: CharacterBounds = { minimum: new Vector3(-.2, 0, -.2), maximum: new Vector3(.2, .45, .2),
      labelHeight: .6, selectionRadius: .25, pickingHeight: .25 };
    const profile = profiles.get(initial.appearanceId ?? "");
    const tagMeshes = (owner: NativeActor) => {
      for (const mesh of owner.ownedMeshes()) { mesh.isPickable = mesh.getTotalVertices() > 0; mesh.metadata = { ...mesh.metadata, clientEntityId: initial.id }; }
    };
    const updateEquipment = (): Promise<void> => {
      if (!actor || !profile || upper === current.equipment?.upper) return equipmentTask;
      const item = current.equipment?.upper, owner = actor;
      const replacement = item === undefined ? undefined : profile.upperItems?.get(item);
      const sourceObject = replacement?.manifest.source.object ?? replacedObject;
      upper = item;
      const request = ++equipmentRequest;
      equipmentTask = Promise.resolve().then(async () => {
        lifetime.signal.throwIfAborted();
        if (request !== equipmentRequest) return;
        if (item !== undefined && !replacement) throw new Error(`Native item ${item} has no verified upper-body binding.`);
        if (sourceObject) {
          replacedObject = sourceObject;
          await owner.replacePart(sourceObject, replacement ?? null);
        }
        if (!disposed && request === equipmentRequest) { committedUpper = item; tagMeshes(owner); }
      }).catch((error: unknown) => {
        if (!disposed && request === equipmentRequest) {
          upper = committedUpper;
          if (initialized && !(error instanceof DOMException && error.name === "AbortError")) {
            status?.(`${error instanceof Error ? error.message : "Equipment could not be loaded."} Previous appearance retained.`);
          }
        }
        throw error;
      });
      void equipmentTask.catch(() => undefined);
      return equipmentTask;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true; lifetime.abort();
      if (!readySettled) { readySettled = true; rejectReady(new DOMException("Native character loading was cancelled.", "AbortError")); }
      animation.dispose(); pendingDriver?.dispose();
      for (const anchor of anchors) anchor.handle.dispose();
      actor?.dispose(); placement?.dispose(); root.dispose();
      actor = undefined; driver = undefined; pendingDriver = undefined; initialized = false;
      scene.onDisposeObservable.remove(observer);
    };
    const observer = scene.onDisposeObservable.add(dispose);
    const initialize = async (): Promise<void> => {
      if (!profile) throw new Error(`${initial.displayName}: native profile unavailable.`);
      const loaded = await NativeActor.create(scene, profile.asset, lifetime.signal);
      if (disposed) { loaded.dispose(); lifetime.signal.throwIfAborted(); }
      actor = loaded;
      loaded.root.setEnabled(false);
      const anchorIds = new Set<string>();
      for (const binding of profile.boneAnchors ?? []) {
        if (!binding.id || anchorIds.has(binding.id)) throw new Error("Native rig anchor ID is missing or duplicated.");
        anchorIds.add(binding.id);
        anchors.push({ id: binding.id, handle: loaded.createBoneAnchor(binding.sourceObject, binding.boneName) });
      }
      if (profile.collisionHalfHeight !== undefined && (!Number.isFinite(profile.collisionHalfHeight) || profile.collisionHalfHeight <= 0)) {
        throw new Error("Native profile collision half-height must be finite and positive.");
      }
      if (profile.actorScale && !profile.actorScale.asArray().every(value => Number.isFinite(value) && value > 0)) {
        throw new Error("Native profile actor scale must be finite and positive.");
      }
      if (profile.forwardAxis && (!profile.forwardAxis.asArray().every(Number.isFinite) || profile.forwardAxis.y !== 0 || profile.forwardAxis.lengthSquared() === 0)) {
        throw new Error("Native profile forward axis must be finite, horizontal and nonzero.");
      }
      placement = new TransformNode(`${initial.id}:native-actor-placement`, scene);
      placement.scaling.copyFrom(profile.actorScale ?? Vector3.OneReadOnly);
      // Adapter heading zero means +Z. Apply the asset-basis correction outside
      // the complete assembly so body parts, equipment, rigs and clips agree.
      const forward = profile.forwardAxis ?? Vector3.Forward();
      placement.rotation.y = -Math.atan2(forward.x, forward.z);
      loaded.root.parent = placement;
      for (const name of Object.values(profile.clips)) if (!loaded.clips.some(clip => clip.name === name)) throw new Error(`Native profile clip ${name} is missing.`);
      const cuePlayers = [actionCuePreview?.bindActor(initial.id, profile.asset), footstepPreview?.bindActor(initial.id, profile.asset)]
        .filter((player): player is NativeActionCuePlayer => player !== undefined);
      const candidateDriver = new NativeActorDriver(loaded, profile.clips, cuePlayers);
      // Own cleanup before equipment awaits; failed startup must release audio.
      pendingDriver = candidateDriver;
      // Equipment events can arrive while either the base or a previous part is
      // pending. Startup belongs to the latest request, never a superseded one.
      for (;;) {
        const task = updateEquipment();
        try { await task; } catch (error) { if (task === equipmentTask) throw error; }
        lifetime.signal.throwIfAborted();
        if (task === equipmentTask && upper === current.equipment?.upper) break;
      }
      // Measure the idle reference datum once; do not cancel animated vertical
      // motion or recenter native meshes, bones, roots or keys every frame.
      const measured = loaded.measureBounds(), size = measured.max.subtract(measured.min);
      if (![...measured.min.asArray(), ...measured.max.asArray()].every(Number.isFinite) || size.y <= 0) throw new Error("Native model has no finite visible bounds.");
      bounds = { minimum: measured.min, maximum: measured.max,
        labelHeight: measured.max.y + Math.max(.06, size.y * .12), selectionRadius: Math.max(size.x, size.z) / 2 + .04,
        pickingHeight: measured.min.y + size.y * .55 };
      candidateDriver.setLocomotion(current.locomotion ?? "run");
      candidateDriver.setActionPreview(current.actionPreview);
      candidateDriver.setState(current.animation); candidateDriver.setDead(current.health <= 0);
      driver = candidateDriver; animation.replaceDriver(driver); pendingDriver = undefined;
      placement.parent = root; tagMeshes(actor);
      initialized = true; loaded.root.setEnabled(true); root.setEnabled(true);
      readySettled = true; resolveReady(); status?.(`${initial.displayName}: native model loaded.`);
    };
    void initialize().catch((error: unknown) => {
      if (disposed) return;
      readySettled = true; rejectReady(error);
      status?.(error instanceof Error ? error.message : "Native model could not be loaded.");
      dispose();
    });
    return { root, animation, ready, get isFallback() { return !initialized; }, get bounds() { return bounds; },
      get modelId() { return initialized ? profile!.asset.manifest.id : null; },
      attachmentSnapshot: () => anchors.map(({ id, handle }) => ({ id, ...handle.inspection() })),
      attachmentAnchor: id => {
        const handle = anchors.find(row => row.id === id)?.handle;
        return handle?.isValid() ? handle : null;
      },
      sourceClock: () => initialized && actor && !disposed ? actor.clock() : null,
      get forwardDirection() {
        if (!initialized || !actor || !profile!.forwardAxis) return null;
        root.computeWorldMatrix(true);
        actor?.root.parent?.computeWorldMatrix(true);
        actor?.root.computeWorldMatrix(true);
        return actor.root.getDirection(profile!.forwardAxis).normalize();
      },
      get groundClearance() { return initialized ? profile!.collisionHalfHeight ?? -bounds.minimum.y : 0; },
      setEntity(entity) {
        current = entity;
        driver?.setActionPreview(entity.actionPreview);
        driver?.setDead(entity.health <= 0);
        driver?.setLocomotion(entity.locomotion ?? "run");
        updateEquipment();
      }, dispose };
  };
}

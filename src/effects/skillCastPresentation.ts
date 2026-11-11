import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { skillCatalogKey, type NativeCatalogIndex, type NativeCatalogLookup } from "../assets/native/nativeCatalogIndex";
import { drawNativeSessionSeed } from "../assets/native/nativeSessionSeed";
import type { WorldEvent } from "../world/worldTypes";
import { lookupCastSkill, type CastSkillIndex } from "./castSkillIndex";
import { loadCastSkillEffectBundle, simulatedEffectEmitterClasses, type EffectBundle, type EffectComponent } from "./nativeEffectComponents";
import { loadEmitterActorPlayback, type EmitterActorPlayback } from "./particles/render/emitterActorPlayback";
import { recordedSkillEffectPlacements, type SkillEffectPlacement } from "./skillEffectPlacements";

export type SkillCastEvent = Extract<WorldEvent, { readonly type: "skill-cast" }>;

export interface SkillCastPresentationContext {
  readonly scene: Scene;
  readonly catalogIndex: NativeCatalogIndex;
  readonly castSkillIndex: CastSkillIndex;
  readonly anchors: (entityId: string) => TransformNode | null;
  readonly signal: AbortSignal;
}

export interface SkillCastNotDrawn { readonly object: string; readonly reason: string }

export interface SkillCastInspection {
  readonly key: string;
  readonly casterId: string;
  readonly targetId: string | null;
  readonly catalogStatus: NativeCatalogLookup["status"];
  readonly reason: string | null;
  readonly emitterActors: number;
  readonly placements: readonly SkillEffectPlacement[];
  readonly notDrawn: readonly SkillCastNotDrawn[];
  readonly featureGaps: readonly string[];
}

export interface SkillCastPresentation {
  present(event: SkillCastEvent): Promise<SkillCastInspection>;
  advance(elapsedSeconds: number): void;
  dispose(): void;
}

interface CasterPresentation { readonly controller: AbortController; readonly playbacks: EmitterActorPlayback[] }

export const skillEffectPlacementUnresolvedReason = "skill-effect-placement-unresolved";
export const skillCastSupersededReason = "skill-cast-superseded";

function unportedEmitterClassReason(emitterClass: string): string {
  return `emitter-class-unported:${emitterClass}`;
}

function anchorUnavailableReason(placement: SkillEffectPlacement): string {
  return `skill-effect-anchor-unavailable:${placement.side}`;
}

function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function createSkillCastPresentation(context: SkillCastPresentationContext): SkillCastPresentation {
  const { scene, catalogIndex, castSkillIndex, anchors, signal } = context;
  const presentationsByCaster = new Map<string, CasterPresentation>();
  let disposed = false;

  const releaseCaster = (casterId: string) => {
    const presentation = presentationsByCaster.get(casterId);
    if (!presentation) return;
    presentationsByCaster.delete(casterId);
    presentation.controller.abort();
    for (const playback of presentation.playbacks.splice(0)) playback.dispose();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    for (const casterId of [...presentationsByCaster.keys()]) releaseCaster(casterId);
  };
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();

  async function startPlacements(bundle: EffectBundle, event: SkillCastEvent, presentation: CasterPresentation,
    placements: readonly SkillEffectPlacement[], notDrawn: SkillCastNotDrawn[]) {
    for (const actor of bundle.manifest.actors) {
      const components = bundle.manifest.components.filter(component => component.actor === actor.object);
      const actorPlacements = placements.filter(placement => placement.actorObject === actor.object);
      if (actorPlacements.length === 0) {
        for (const component of components) notDrawn.push({ object: component.object, reason: skillEffectPlacementUnresolvedReason });
        continue;
      }
      const simulated: EffectComponent[] = [];
      for (const component of components) {
        if (simulatedEffectEmitterClasses.has(component.class)) simulated.push(component);
        else notDrawn.push({ object: component.object, reason: unportedEmitterClassReason(component.class) });
      }
      if (simulated.length === 0) continue;
      for (const placement of actorPlacements) {
        const anchorEntityId = placement.side === "caster" ? event.casterId : event.targetId ?? null;
        const anchor = anchorEntityId === null ? null : anchors(anchorEntityId);
        if (!anchor) { notDrawn.push({ object: actor.object, reason: anchorUnavailableReason(placement) }); continue; }
        let playback: EmitterActorPlayback;
        try {
          playback = await loadEmitterActorPlayback(scene, bundle,
            { actorObject: actor.object, emitterObjects: simulated.map(component => component.object), sessionSeed: drawNativeSessionSeed() },
            presentation.controller.signal);
        } catch (failure) {
          presentation.controller.signal.throwIfAborted();
          notDrawn.push({ object: actor.object, reason: failureMessage(failure) });
          continue;
        }
        if (presentation.controller.signal.aborted) { playback.dispose(); presentation.controller.signal.throwIfAborted(); }
        presentation.playbacks.push(playback);
        playback.root.parent = anchor;
        playback.start();
      }
    }
  }

  return {
    async present(event) {
      if (disposed) throw new Error("Skill cast presentation: the presentation is disposed.");
      const key = skillCatalogKey(event.skillId, event.level);
      const lookup = catalogIndex.lookup(key);
      const answered = { key, casterId: event.casterId, targetId: event.targetId ?? null, catalogStatus: lookup.status };
      if (lookup.status !== "converted") {
        return { ...answered, reason: lookup.reason, emitterActors: 0, placements: [], notDrawn: [], featureGaps: [] };
      }
      const record = lookupCastSkill(castSkillIndex, event.skillId, event.level);
      if (!record) throw new Error(`Skill cast presentation: ${key} is converted in the catalog index but has no effect component record.`);
      releaseCaster(event.casterId);
      const presentation: CasterPresentation = { controller: new AbortController(), playbacks: [] };
      presentationsByCaster.set(event.casterId, presentation);
      const notDrawn: SkillCastNotDrawn[] = [];
      let placements: readonly SkillEffectPlacement[] = [];
      try {
        const bundle = await loadCastSkillEffectBundle(record, presentation.controller.signal);
        presentation.controller.signal.throwIfAborted();
        placements = recordedSkillEffectPlacements(bundle.manifest);
        await startPlacements(bundle, event, presentation, placements, notDrawn);
      } catch (failure) {
        if (!presentation.controller.signal.aborted) {
          if (presentationsByCaster.get(event.casterId) === presentation) releaseCaster(event.casterId);
          throw failure;
        }
        return { ...answered, reason: skillCastSupersededReason, emitterActors: 0, placements, notDrawn, featureGaps: [] };
      }
      const featureGaps = [...new Set(presentation.playbacks.flatMap(playback => playback.inspect().featureGaps))].sort();
      return { ...answered, reason: null, emitterActors: presentation.playbacks.length, placements, notDrawn, featureGaps };
    },
    advance(elapsedSeconds) {
      if (disposed) return;
      for (const presentation of presentationsByCaster.values()) {
        for (const playback of presentation.playbacks) playback.advance(elapsedSeconds);
      }
    },
    dispose,
  };
}

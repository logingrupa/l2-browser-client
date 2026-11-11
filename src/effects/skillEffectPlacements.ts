import type { EffectManifest } from "./nativeEffectComponents";

export type SkillEffectAnchorSide = "caster" | "target";

export interface SkillEffectPlacement {
  readonly actorObject: string;
  readonly side: SkillEffectAnchorSide;
  readonly sourceStage: string;
  readonly unappliedFields: readonly string[];
}

const locateEffectActionClass = "Engine.SkillAction_LocateEffect";
const placementFields: ReadonlySet<string> = new Set(["EffectClass", "bSpawnOnTarget"]);

export function recordedSkillEffectPlacements(manifest: EffectManifest): readonly SkillEffectPlacement[] {
  const placements: SkillEffectPlacement[] = [];
  for (const actor of manifest.actors) {
    const actorKey = actor.object.toLowerCase();
    for (const stage of manifest.stages ?? []) {
      if (stage.class !== locateEffectActionClass || stage.effectObject.toLowerCase() !== actorKey) continue;
      placements.push({
        actorObject: actor.object,
        side: stage.effectiveProperties.bSpawnOnTarget === true ? "target" : "caster",
        sourceStage: stage.stage,
        unappliedFields: Object.keys(stage.effectiveProperties).filter(field => !placementFields.has(field)).sort(),
      });
    }
  }
  return placements;
}
